import { promises as fs } from "node:fs";
import path from "node:path";
import type { StudioBridgeClient } from "../studio/bridge.js";
import { createStudioBridge } from "../studio/mcp-bridge.js";
import { executeLuau, readOutput } from "../studio/tools.js";
import { capturePlaytestScreenshot, evaluateScreenshot, assessVisualState, describeVisualState, type ScreenshotResult, type VisionEvaluator, type VisualQaState, type VisionVerdict } from "./screenshot.js";
import { emitToolEvent } from "../tools/observability.js";
import { validateRobloxProject } from "./validation.js";
import { classifyPlaytestStartFailure } from "../studio/playtest.js";

/**
 * Visual / runtime QA — FIRST-CLASS requirement.
 *
 * ROJO BUILD PASS does NOT mean GAMEPLAY PASS. This module runs the full
 * runtime gate:
 *
 *   BUILD (rojo validation) → OPEN/CONNECT STUDIO → PLAY → OBSERVE →
 *   SCREENSHOT → READ OUTPUT → PLAYER STATE → EVALUATE → FAIL? → repair
 *   context → PLAY AGAIN
 *
 * Outcomes: PASS / FAIL / BLOCKED. Infrastructure failures (Studio down,
 * Rojo missing) are BLOCKED and never routed to code repair as game bugs.
 */

export type RuntimeQaStatus = "PASS" | "FAIL" | "BLOCKED";

export interface RuntimeCheck {
  name: string;
  passed: boolean;
  message?: string;
  infra?: boolean;
  /**
   * "required" (default) checks gate the verdict. "advisory" checks are
   * supplemental evidence (e.g. vision when no evaluator is configured):
   * a false advisory never flips PASS→FAIL, but it is surfaced as
   * `unverified` so a PASS is never silently incomplete.
   */
  severity?: "required" | "advisory";
}

export interface RuntimeQaResult {
  status: RuntimeQaStatus;
  reason: string;
  command: string;
  checks: RuntimeCheck[];
  stdout: string;
  stderr: string;
  durationMs: number;
  screenshotPath?: string;
  affectedFiles: string[];
  /** Advisory evidence that could not be verified (e.g. no vision model). */
  unverified?: string[];
  /** Four-state visual QA model (see screenshot.ts). */
  visualState?: VisualQaState;
  /** Structured repair context for the repair loop (§17). */
  repairContext?: RobloxRepairContext;
}

export interface RobloxRepairContext {
  platform: "roblox";
  engine: "roblox";
  stack: string;
  affectedFiles: string[];
  affectedInstances: string[];
  toolName: string;
  command: string;
  stdout: string;
  stderr: string;
  screenshotPath?: string;
  runtimeState?: Record<string, unknown>;
  attemptNumber: number;
  failureType: string;
  observation: string;
  suggestedRoute: string;
}

export interface RuntimeQaOptions {
  bridge?: StudioBridgeClient;
  runRojoBuild?: boolean;
  playtestSettleMs?: number;
  screenshotLabel?: string;
  vision?: VisionEvaluator;
  attemptNumber?: number;
}

/**
 * Deterministic server-side assertions evaluated on the playtest server peer.
 *
 * IMPORTANT (eval-sandbox quirk): class-filtered traversal
 * (FindFirstChildOfClass / FindFirstChildWhichIsA) returns nil inside the
 * eval sandbox even for valid instances — IsA("SpawnLocation") is true but
 * `workspace:FindFirstChildOfClass('SpawnLocation')` is nil. All instance
 * lookups must therefore use name/position traversal with IsA guards.
 */
export const RUNTIME_ASSERTIONS: Array<{ expr: string; name: string; instance: string }> = [
  { expr: "#game:GetService('Players'):GetPlayers() > 0", name: "player-present", instance: "Players" },
  { expr: "(function() for _, v in ipairs(game:GetService('Workspace'):GetDescendants()) do if v:IsA('SpawnLocation') then return true end end return false end)()", name: "spawn-present-runtime", instance: "Workspace.SpawnLocation" },
  { expr: "(function() local p = game:GetService('Players'):GetPlayers()[1] local c = p and p.Character local r = c and c:FindFirstChild('HumanoidRootPart') return r ~= nil end)()", name: "character-spawned", instance: "Workspace.PlayerCharacter" },
  // Void-fall guard: a spawned character below the floor plane (Y <= -5)
  // means the player is falling into the void even though the server has
  // them. This is the runtime equivalent of the static floor check.
  { expr: "(function() local p = game:GetService('Players'):GetPlayers()[1] local c = p and p.Character local r = c and c:FindFirstChild('HumanoidRootPart') if not r then return false end return r.Position.Y > -5 end)()", name: "character-not-falling", instance: "Workspace.PlayerCharacter" },
];

/** Static pre-checks that catch the "player falls into void" class early. */
export async function staticSpawnSafetyChecks(projectDir: string): Promise<RuntimeCheck[]> {
  const checks: RuntimeCheck[] = [];
  // 1. At least one BasePlate/floor-like Part must exist in the project
  //    sources. Geometry may be authored as Luau, as Rojo `.model.json`
  //    instances, or as rbxmx — all three shapes are inspected.
  const floorHits = await grepProject(projectDir, [
    /BasePlate|Baseplate/i,
    /SpawnLocation/i,
    /Size\s*=\s*Vector3\.new\s*\(\s*\d{2,}/,
    /Anchored\s*=\s*true/,
    /"ClassName"\s*:\s*"(Part|SpawnLocation|TrussPart|WedgePart)"/,
    /"Size"\s*:\s*\[\s*\d{2,}/,
    /"Anchored"\s*:\s*true/,
  ]);
  checks.push({
    name: "spawn-floor-authored",
    passed: floorHits.found,
    message: floorHits.found
      ? `floor/spawn authoring found (${floorHits.matchedPattern})`
      : "no floor/BasePlate/SpawnLocation authoring found in src/ — player will fall into void",
  });
  // 2. A SpawnLocation must exist somewhere in sources.
  const spawnHits = await grepProject(projectDir, [/SpawnLocation/]);
  checks.push({
    name: "spawn-location-present",
    passed: spawnHits.found,
    message: spawnHits.found ? "SpawnLocation referenced in src/" : "no SpawnLocation in src/ — default spawn is undefined",
  });
  return checks;
}

async function grepProject(
  projectDir: string,
  patterns: RegExp[]
): Promise<{ found: boolean; matchedPattern?: string }> {
  const files = await collectLuau(projectDir);
  for (const f of files) {
    let src = "";
    try {
      src = await fs.readFile(f, "utf8");
    } catch {
      continue;
    }
    for (const re of patterns) {
      if (re.test(src)) return { found: true, matchedPattern: String(re) };
    }
  }
  return { found: false };
}

const SOURCE_FILE_SUFFIXES = [
  ".lua",
  ".luau",
  ".model.json",
  ".rbxmx",
  ".rbxm",
  ".project.json",
];

async function collectLuau(projectDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (SOURCE_FILE_SUFFIXES.some((s) => e.name.endsWith(s))) out.push(full);
    }
  }
  await walk(path.join(projectDir, "src"));
  // Rojo project mapping also carries class/name hints.
  await walk(projectDir);
  return [...new Set(out)];
}

export async function runRobloxRuntimeQa(
  projectDir: string,
  opts: RuntimeQaOptions = {}
): Promise<RuntimeQaResult> {
  const start = Date.now();
  const checks: RuntimeCheck[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const affectedFiles = ["default.project.json"];
  const attemptNumber = opts.attemptNumber ?? 1;

  // Stage 1: structural + rojo build (static gate).
  const structural = await validateRobloxProject(projectDir, { runRojoBuild: opts.runRojoBuild });
  for (const c of structural.checks) {
    checks.push({ name: `static:${c.name}`, passed: c.passed, message: c.message, infra: c.infra });
  }
  stdout.push(structural.stdout);
  if (structural.stderr) stderr.push(structural.stderr);
  for (const f of structural.affectedFiles) if (!affectedFiles.includes(f)) affectedFiles.push(f);
  if (structural.status === "BLOCKED") {
    return {
      status: "BLOCKED",
      reason: structural.reason,
      command: structural.command,
      checks,
      stdout: stdout.join("\n").slice(0, 4000),
      stderr: stderr.join("\n").slice(0, 4000),
      durationMs: Date.now() - start,
      affectedFiles,
    };
  }
  if (structural.status === "FAIL") {
    return {
      status: "FAIL",
      reason: structural.reason,
      command: structural.command,
      checks,
      stdout: stdout.join("\n").slice(0, 4000),
      stderr: stderr.join("\n").slice(0, 4000),
      durationMs: Date.now() - start,
      affectedFiles,
      repairContext: {
        platform: "roblox",
        engine: "roblox",
        stack: structural.stderr.slice(0, 1000),
        affectedFiles: [...affectedFiles],
        affectedInstances: [],
        toolName: "rojo.build",
        command: structural.command,
        stdout: stdout.join("\n").slice(0, 2000),
        stderr: stderr.join("\n").slice(0, 2000),
        attemptNumber,
        failureType: "roblox_structure",
        observation: structural.reason,
        suggestedRoute: "builder repair (structure/Luau)",
      },
    };
  }

  // Stage 2: static spawn-safety (catches void-fall WITHOUT Studio).
  const spawnChecks = await staticSpawnSafetyChecks(projectDir);
  for (const c of spawnChecks) checks.push(c);
  const spawnFailed = spawnChecks.filter((c) => !c.passed);
  if (spawnFailed.length > 0) {
    const reason = `runtime QA FAIL: ${spawnFailed.map((c) => c.message).join("; ")}`;
    stderr.push(reason);
    emitToolEvent({ type: "tool.failed", toolId: "runtime.assert", projectDir, message: reason });
    return {
      status: "FAIL",
      reason,
      command: "roblox-runtime-qa (static spawn safety)",
      checks,
      stdout: stdout.join("\n").slice(0, 4000),
      stderr: stderr.join("\n").slice(0, 4000),
      durationMs: Date.now() - start,
      affectedFiles,
      repairContext: {
        platform: "roblox",
        engine: "roblox",
        stack: reason,
        affectedFiles: [...affectedFiles],
        affectedInstances: ["Workspace.SpawnLocation", "Workspace.BasePlate"],
        toolName: "runtime.assert",
        command: "roblox-runtime-qa (static spawn safety)",
        stdout: stdout.join("\n").slice(0, 2000),
        stderr: stderr.join("\n").slice(0, 2000),
        attemptNumber,
        failureType: "roblox_runtime",
        observation: "player would spawn with no floor beneath them (void fall)",
        suggestedRoute: "visual/gameplay repair (add floor + SpawnLocation)",
      },
    };
  }

  // Stage 3: live Studio runtime (requires connection; else BLOCKED).
  const bridge: StudioBridgeClient = opts.bridge ?? createStudioBridge();
  const discovery = await bridge.discover();
  if (!discovery.pluginConnected) {
    const reason = `roblox_toolchain: Studio not connected — runtime QA BLOCKED (${discovery.message}). Static gates passed; live playtest pending.`;
    checks.push({ name: "studio-connected", passed: false, message: discovery.message, infra: true });
    emitToolEvent({ type: "tool.blocked", toolId: "studio.play", projectDir, message: reason });
    return {
      status: "BLOCKED",
      reason,
      command: "roblox-runtime-qa (studio playtest)",
      checks,
      stdout: stdout.join("\n").slice(0, 4000),
      stderr: reason.slice(0, 4000),
      durationMs: Date.now() - start,
      affectedFiles,
    };
  }
  checks.push({ name: "studio-connected", passed: true, message: discovery.message });

  const started = await bridge.callTool("start_playtest", {});
  if (!started.ok) {
    const classified = classifyPlaytestStartFailure(started.message);
    if (started.infra || classified.infra) {
      const reason = classified.infra ? classified.message : `roblox_toolchain: could not start playtest: ${started.message}`;
      checks.push({ name: "playtest-start", passed: false, message: started.message, infra: true });
      emitToolEvent({ type: "tool.blocked", toolId: "studio.play", projectDir, message: reason });
      return { status: "BLOCKED", reason, command: "studio.play", checks, stdout: stdout.join("\n").slice(0, 4000), stderr: reason.slice(0, 4000), durationMs: Date.now() - start, affectedFiles };
    }
    const reason = `playtest failed to start: ${started.message}`;
    checks.push({ name: "playtest-start", passed: false, message: started.message });
    return { status: "FAIL", reason, command: "studio.play", checks, stdout: stdout.join("\n").slice(0, 4000), stderr: reason.slice(0, 4000), durationMs: Date.now() - start, affectedFiles };
  }
  checks.push({ name: "playtest-start", passed: true });
  try {
    return await evaluateLiveRuntimeQa(bridge, projectDir, { checks, stdout, stderr, affectedFiles, attemptNumber, opts, start });
  } finally {
    await bestEffortStop(bridge);
  }
}

async function evaluateLiveRuntimeQa(
  bridge: StudioBridgeClient,
  projectDir: string,
  ctx: {
    checks: RuntimeCheck[];
    stdout: string[];
    stderr: string[];
    affectedFiles: string[];
    attemptNumber: number;
    opts: RuntimeQaOptions;
    start: number;
  }
): Promise<RuntimeQaResult> {
  const { checks, stdout, stderr, affectedFiles, attemptNumber, opts, start } = ctx;
  const unverified: string[] = [];
  await sleep(opts.playtestSettleMs ?? 3000);

  // Player-state assertions on the server peer. These are the deterministic
  // runtime gate — they must hold for a PASS regardless of vision.
  const assertions: Array<{ expr: string; name: string; instance: string }> = RUNTIME_ASSERTIONS;
  const failedInstances: string[] = [];
  const runtimeState: Record<string, unknown> = {};
  for (const a of assertions) {
    const r = await executeLuau(bridge, { source: `return (${a.expr})`, peer: "server" });
    const passed = r.ok && /true/i.test(r.stdout.slice(0, 2000));
    runtimeState[a.name] = r.stdout.slice(0, 500);
    checks.push({ name: `runtime:${a.name}`, passed, message: passed ? "ok" : `FAILED: ${r.message.slice(0, 300)}` });
    if (!passed) failedInstances.push(a.instance);
  }

  const out = await readOutput(bridge, { limit: 200 });
  const outputText = out.ok ? out.stdout : "";
  stdout.push(outputText.slice(0, 2000));
  const runtimeErrors = outputText.split("\n").filter((l) => /error|attempt to|stack/i.test(l)).slice(0, 5);
  for (const e of runtimeErrors) {
    checks.push({ name: "runtime:output-error", passed: false, message: e.slice(0, 300) });
  }

  const shot = await capturePlaytestScreenshot(bridge, {
    label: opts.screenshotLabel ?? "runtime-qa",
    projectDir,
    role: "qa",
  });
  let screenshotPath: string | undefined;
  if (shot.status === "PASS" && shot.screenshotPath) {
    screenshotPath = shot.screenshotPath;
    checks.push({ name: "screenshot", passed: true, message: shot.screenshotPath });
  } else {
    // Missing screenshot is evidence loss, not a game bug: advisory only.
    const why = shot.infraReason ?? shot.message;
    checks.push({ name: "screenshot", passed: false, message: why, infra: shot.status === "BLOCKED", severity: "advisory" });
    unverified.push(`screenshot unavailable: ${why}`);
  }

  let visionNote = "";
  let visionVerdict: VisionVerdict | undefined;
  if (screenshotPath) {
    const v = await evaluateScreenshot(
      screenshotPath,
      "Does the player have a floor beneath them? Is the spawn area visible and sane?",
      opts.vision
    );
    visionVerdict = v;
    visionNote = v.observation;
    if (v.verdict === "FAIL") {
      // A real vision failure is a required gate failure.
      checks.push({ name: "visual:floor-visible", passed: false, message: v.observation.slice(0, 300) });
      failedInstances.push("Workspace.BasePlate");
    } else if (v.verdict === "NEEDS_HUMAN") {
      // No vision model configured: record honestly, never fabricate a PASS.
      checks.push({ name: "visual:floor-visible", passed: false, message: v.observation.slice(0, 300), severity: "advisory" });
      unverified.push(`visual verification pending: ${v.observation.slice(0, 200)}`);
    } else {
      checks.push({ name: "visual:floor-visible", passed: true, message: v.observation.slice(0, 300) });
    }
  }
  const visual = assessVisualState(shot as ScreenshotResult, visionVerdict);
  checks.push({ name: `visual:state`, passed: visual.state !== "VISUAL_FAIL", message: `VISUAL state: ${visual.state}` });
  if (visual.state === "VISUAL_UNVERIFIED" || visual.state === "VISUAL_UNAVAILABLE") {
    unverified.push(describeVisualState(visual.state));
  }

  const failed = checks.filter((c) => !c.passed && !c.infra && c.severity !== "advisory");
  const durationMs = Date.now() - start;
  if (failed.length > 0) {
    const reason = `runtime QA FAIL: ${failed.map((c) => `${c.name}: ${c.message ?? ""}`).join("; ").slice(0, 800)}`;
    stderr.push(reason);
    emitToolEvent({ type: "tool.failed", toolId: "runtime.assert", projectDir, message: reason, durationMs });
    return {
      status: "FAIL",
      reason,
      command: "roblox-runtime-qa (studio playtest)",
      checks,
      stdout: stdout.join("\n").slice(0, 4000),
      stderr: [...stderr, visionNote].join("\n").slice(0, 4000),
      durationMs,
      screenshotPath,
      affectedFiles,
      unverified,
      visualState: visual.state,
      repairContext: {
        platform: "roblox",
        engine: "roblox",
        stack: runtimeErrors.join("\n").slice(0, 1000),
        affectedFiles: [...affectedFiles],
        affectedInstances: [...new Set(failedInstances)],
        toolName: "studio.play",
        command: "roblox-runtime-qa (studio playtest)",
        stdout: stdout.join("\n").slice(0, 2000),
        stderr: stderr.join("\n").slice(0, 2000),
        screenshotPath,
        runtimeState,
        attemptNumber,
        failureType: "roblox_runtime",
        observation: [reason, visionNote].filter(Boolean).join(" ").slice(0, 1000),
        suggestedRoute: failed.some((f) => f.name.includes("spawn") || f.name.includes("floor") || f.name.includes("character"))
          ? "visual/gameplay repair (NOT architect)"
          : "programmer repair",
      },
    };
  }
  const passReason =
    unverified.length > 0
      ? `roblox runtime QA PASS (static + live assertions held; ${unverified.length} advisory item(s) unverified: ${unverified.join("; ").slice(0, 400)})`
      : "roblox runtime QA PASS (static + live assertions held)";
  emitToolEvent({ type: "playtest.completed", projectDir, message: passReason, durationMs });
  return {
    status: "PASS",
    reason: passReason,
    command: "roblox-runtime-qa (studio playtest)",
    checks,
    stdout: stdout.join("\n").slice(0, 4000),
    stderr: "",
    durationMs,
    screenshotPath,
    affectedFiles,
    unverified,
    visualState: visual.state,
  };
}

async function bestEffortStop(bridge: StudioBridgeClient): Promise<void> {
  try {
    await bridge.callTool("stop_playtest", {});
  } catch {
    // best effort
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
