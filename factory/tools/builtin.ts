import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "./types.js";
import { blocked, fail, pass, type ToolResult } from "./types.js";
import { ToolRegistry } from "./registry.js";
import { ROLE_TOOLS } from "./roles.js";
import { checkLuauPath, checkProjectScope } from "./safety.js";
import type { StudioBridgeClient } from "../studio/bridge.js";
import { createStudioBridge } from "../studio/mcp-bridge.js";
import {
  STUDIO_TOOL_DEFS,
  inspectInstance,
  createInstance,
  modifyInstance,
  deleteCloneMove,
  readScript,
  editScript,
  executeLuau,
  startPlay,
  stopPlay,
  readOutput,
  captureScreenshot,
} from "../studio/tools.js";
import {
  SCENE_TOOL_DEFS,
  sceneInspect,
  scenePlan,
  sceneCreate,
  sceneClone,
  sceneSet,
  sceneMove,
  sceneRename,
  sceneDestroy,
  sceneTypedCreate,
} from "../studio/scene-editing.js";
import { runStudioPlaytest } from "../studio/playtest.js";
import { validateRobloxProject } from "../roblox/validation.js";
import { runRojo } from "../roblox/rojo.js";
import { probeBinary, runTool } from "../roblox/toolchain.js";
import { searchAssets, validateAssetInsert, writeAssetQuarantineNote } from "../roblox/asset-search.js";
import { listGameSystems, loadGameSystemSource, installGameSystem } from "../roblox/game-systems/index.js";
import { createGameplay, supportedGameplayKinds } from "../roblox/gameplay-tools.js";
import { runRobloxRuntimeQa } from "../roblox/visual-qa.js";
import { heuristicStyleFromText, renderStyleIntent } from "../roblox/reference-style.js";

/**
 * Register every built-in factory tool into a registry.
 *
 * Two families:
 *   1. Studio-bridge tools (STUDIO_TOOL_DEFS) — live DataModel/playtest.
 *      Without Studio they return BLOCKED (infrastructure).
 *   2. Local tools — filesystem/local-exec/http-allowlisted tools that work
 *      without Studio (script validation, rojo build, toolchain, asset
 *      metadata search, game systems, gameplay helpers, runtime QA static
 *      gates, reference-style analysis).
 */

export const LOCAL_TOOL_DEFS: ToolDefinition[] = [
  { id: "luau.validate", name: "Validate Luau project", description: "Structural + Luau + rojo build validation (PASS/FAIL/BLOCKED).", capability: "luau_validate", platform: "roblox", executionMethod: "local-exec", allowedRoles: ["programmer", "builder", "qa", "tester", "designer", "architect", "reviewer"], timeoutMs: 90_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "rojo.build", name: "Rojo build", description: "Run rojo build on the project.", capability: "rojo_build", platform: "roblox", executionMethod: "local-exec", allowedRoles: ["programmer", "builder", "qa", "tester", "architect"], timeoutMs: 90_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "toolchain.stylua", name: "StyLua check", description: "Luau formatting check (read-only).", capability: "toolchain", platform: "roblox", executionMethod: "local-exec", allowedRoles: ["programmer", "builder"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "toolchain.selene", name: "Selene lint", description: "Luau lint via Selene when installed.", capability: "toolchain", platform: "roblox", executionMethod: "local-exec", allowedRoles: ["programmer"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "toolchain.lune", name: "Lune run", description: "Run a Lune script/test.", capability: "toolchain", platform: "roblox", executionMethod: "local-exec", allowedRoles: ["programmer", "builder"], timeoutMs: 60_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "runtime.assert", name: "Runtime assertions", description: "Static + live runtime QA (PASS/FAIL/BLOCKED).", capability: "runtime_assertion", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["qa", "tester", "programmer"], timeoutMs: 120_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "asset.search", name: "Asset search", description: "Metadata-only Creator Store search (no blind downloads).", capability: "asset_search", platform: "roblox", executionMethod: "http", allowedRoles: ["visual", "researcher", "content"], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: false },
  { id: "asset.insert", name: "Asset insert", description: "Validated asset insert (quarantined for QA review).", capability: "asset_insert", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual", "content"], timeoutMs: 60_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "gamesystem.use", name: "Use game system", description: "List/load/install reusable Luau game systems.", capability: "gamesystem", platform: "roblox", executionMethod: "filesystem", allowedRoles: ["programmer", "builder", "gameplay", "content", "monetization"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "gameplay.create", name: "Create gameplay element", description: "Deterministic collectible/shop/quest/zone/checkpoint/npc helper.", capability: "gameplay_create", platform: "roblox", executionMethod: "filesystem", allowedRoles: ["programmer", "builder", "gameplay", "content"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: false },
  { id: "research.web", name: "Web research", description: "Research reference (read-only guidance).", capability: "research", platform: "shared", executionMethod: "stub", allowedRoles: ["researcher", "market", "competitor", "idea", "director", "designer", "monetization", "reviewer"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
  { id: "research.reference", name: "Reference style analysis", description: "Reference image/text → structured style intent.", capability: "reference", platform: "shared", executionMethod: "filesystem", allowedRoles: ["researcher", "market", "competitor", "idea", "director", "reviewer"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: false, requiresStudio: false },
];

import type { SceneOp } from "../studio/scene-editing.js";

function needProject(args: Record<string, unknown>): string | undefined {
  const p = args.projectDir;
  if (typeof p !== "string" || !p) return undefined;
  return p;
}

function bridgeFrom(args: Record<string, unknown>): StudioBridgeClient {
  const baseUrl = typeof args.bridgeUrl === "string" && args.bridgeUrl ? args.bridgeUrl : undefined;
  return createStudioBridge(baseUrl ? { baseUrl } : undefined);
}

function toBlocked(toolId: string, msg: string, extra?: Partial<ToolResult>): ToolResult {
  return blocked(toolId, msg, extra);
}

/** Register all built-in tools. Idempotent per registry instance. */
export function registerBuiltinTools(registry: ToolRegistry): void {
  // ── Studio-bridge tools ──────────────────────────────────────────
  const studioHandlers: Record<string, (bridge: StudioBridgeClient, args: Record<string, unknown>) => Promise<{ ok: boolean; infra: boolean; message: string; stdout: string; stderr: string; data?: unknown }>> = {
    "studio.inspect": (b, a) => inspectInstance(b, { path: a.path as string | undefined, depth: a.depth as number | undefined }),
    "studio.create": (b, a) => createInstance(b, { className: a.className as string, name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "studio.modify": (b, a) => modifyInstance(b, { path: a.path as string, properties: a.properties as Record<string, unknown> }),
    "studio.delete": (b, a) => deleteCloneMove(b, { op: (a.op as "delete" | "clone" | "move") ?? "delete", path: a.path as string, newParent: a.newParent as string | undefined }),
    "script.read": (b, a) => readScript(b, { path: a.path as string }),
    "script.edit": (b, a) => editScript(b, { path: a.path as string, source: a.source as string }),
    "luau.execute": (b, a) => executeLuau(b, { source: a.source as string, peer: (a.peer as "server" | "client" | undefined) ?? "server" }),
    "studio.play": async (b) => startPlay(b),
    "studio.stop": async (b) => stopPlay(b),
    "studio.output": (b, a) => readOutput(b, { limit: a.limit as number | undefined }),
    "screenshot.capture": (b, a) => captureScreenshot(b, { label: a.label as string | undefined }),
    "studio.terrain": (b, a) => b.callTool("terrain_edit", { ...(a as Record<string, unknown>) }),
    "studio.lighting": (b, a) => b.callTool("lighting_edit", { ...(a as Record<string, unknown>) }),
    "studio.material": (b, a) => b.callTool("material_edit", { ...(a as Record<string, unknown>) }),
    "studio.ui.create": (b, a) => createInstance(b, { className: a.className as string, name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "studio.ui.modify": (b, a) => modifyInstance(b, { path: a.path as string, properties: a.properties as Record<string, unknown> }),
    "studio.ui.inspect": (b, a) => inspectInstance(b, { path: (a.path as string | undefined) ?? "game.StarterGui", depth: a.depth as number | undefined }),
  };
  for (const def of STUDIO_TOOL_DEFS) {
    const handler = studioHandlers[def.id];
    if (!handler) continue;
    registry.register(def, async (args, ctx) => {
      const bridge = bridgeFrom(args);
      const r = await handler(bridge, args);
      if (r.ok) return pass(def.id, r.message || "ok", { stdout: r.stdout, data: (r.data as Record<string, unknown> | undefined) });
      if (r.infra) return toBlocked(def.id, r.message, { stdout: r.stdout, stderr: r.stderr });
      return fail(def.id, r.message, { stdout: r.stdout, stderr: r.stderr });
    });
  }

  // ── Scene Editing Tool Layer ─────────────────────────────────────
  const sceneHandlers: Record<string, (bridge: StudioBridgeClient, args: Record<string, unknown>) => ReturnType<typeof sceneInspect>> = {
    "scene.inspect": (b, a) => sceneInspect(b, { path: a.path as string | undefined, depth: a.depth as number | undefined }),
    "scene.plan": (b, a) => scenePlan(b, { op: (a.op as SceneOp) ?? "create", path: a.path as string, newParent: a.newParent as string | undefined, newName: a.newName as string | undefined, confirm: a.confirm as boolean | undefined }),
    "scene.create": (b, a) => sceneCreate(b, { className: a.className as string, name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "scene.clone": (b, a) => sceneClone(b, { path: a.path as string, newName: a.newName as string | undefined, newParent: a.newParent as string }),
    "scene.set": (b, a) => sceneSet(b, { path: a.path as string, properties: a.properties as Record<string, unknown> }),
    "scene.move": (b, a) => sceneMove(b, { path: a.path as string, newParent: a.newParent as string }),
    "scene.rename": (b, a) => sceneRename(b, { path: a.path as string, newName: a.newName as string }),
    "scene.destroy": (b, a) => sceneDestroy(b, { path: a.path as string, confirm: a.confirm as boolean | undefined }),
    "scene.part": (b, a) => sceneTypedCreate(b, "part", { name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "scene.spawn": (b, a) => sceneTypedCreate(b, "spawn", { name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "scene.folder": (b, a) => sceneTypedCreate(b, "folder", { name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "scene.model": (b, a) => sceneTypedCreate(b, "model", { name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "scene.attachment": (b, a) => sceneTypedCreate(b, "attachment", { name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
    "scene.ui": (b, a) => sceneTypedCreate(b, "ui", { name: a.name as string, parent: a.parent as string, properties: a.properties as Record<string, unknown> | undefined }),
  };
  registerSceneLayer(registry, sceneHandlers);

  // studio.play with full playtest assertions lives behind the same id via
  // a dedicated "playtest" arg shape; keep raw start above. Add explicit
  // full-playtest as part of runtime.assert instead (no id clash).

  // ── Local tools ──────────────────────────────────────────────────
  registry.register(
    mustDef("luau.validate"),
    async (args) => {
      const projectDir = needProject(args);
      if (!projectDir) return fail("luau.validate", "projectDir is required");
      const r = await validateRobloxProject(projectDir, { runRojoBuild: args.runRojoBuild !== false });
      if (r.status === "PASS") return pass("luau.validate", r.reason, { stdout: r.stdout, durationMs: r.durationMs, affectedFiles: r.affectedFiles, data: { checks: r.checks } });
      if (r.status === "BLOCKED") return toBlocked("luau.validate", r.reason, { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, affectedFiles: r.affectedFiles });
      return fail("luau.validate", r.reason, { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, affectedFiles: r.affectedFiles });
    }
  );

  registry.register(
    mustDef("rojo.build"),
    async (args) => {
      const projectDir = needProject(args);
      if (!projectDir) return fail("rojo.build", "projectDir is required");
      const out = typeof args.output === "string" && args.output ? args.output : "build.rbxlx";
      const scope = checkProjectScope(projectDir, out);
      if (!scope.ok) return fail("rojo.build", scope.reason!);
      const r = await runRojo(["build", "default.project.json", "--output", out], { cwd: projectDir, timeoutMs: 90_000 });
      try {
        await fs.rm(path.join(projectDir, out), { force: true });
      } catch {
        // cleanup best-effort
      }
      if (r.ok) return pass("rojo.build", "rojo build succeeded", { stdout: r.stdout, durationMs: r.durationMs });
      if (r.infraError || r.exitCode === 127) return toBlocked("rojo.build", r.stderr || "rojo toolchain missing", { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs });
      return fail("rojo.build", r.stderr.slice(0, 1000) || "rojo build failed", { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs });
    }
  );

  for (const id of ["toolchain.stylua", "toolchain.selene", "toolchain.lune"] as const) {
    registry.register(mustDef(id), async (args) => {
      const bin = id === "toolchain.stylua" ? "stylua" : id === "toolchain.selene" ? "selene" : "lune";
      const projectDir = needProject(args);
      if (id === "toolchain.lune" && typeof args.script === "string") {
        const scope = checkProjectScope(projectDir ?? ".", args.script);
        if (!scope.ok) return fail(id, scope.reason!);
        const r = await runTool("lune", ["run", args.script], { cwd: projectDir, timeoutMs: 60_000 });
        if (!r.ok && r.exitCode === 127) return toBlocked(id, r.stderr, { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs });
        return r.ok ? pass(id, "lune run succeeded", { stdout: r.stdout, durationMs: r.durationMs }) : fail(id, r.stderr.slice(0, 800), { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs });
      }
      const file = args.file;
      if (typeof file !== "string" || !file) {
        const probe = await probeBinary(bin);
        if (!probe.available) return toBlocked(id, `roblox_toolchain: ${bin} not installed (optional)`);
        return pass(id, probe.message, { stdout: probe.message });
      }
      const scope = checkLuauPath(file);
      if (!scope.ok) return fail(id, scope.reason!);
      const toolArgs = bin === "stylua" ? ["--check", file] : bin === "selene" ? [file] : ["check", file];
      const r = await runTool(bin, toolArgs, { cwd: projectDir, timeoutMs: 30_000 });
      if (!r.ok && r.exitCode === 127) return toBlocked(id, r.stderr, { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs });
      return r.ok ? pass(id, `${bin} passed for ${file}`, { stdout: r.stdout, durationMs: r.durationMs }) : fail(id, r.stderr.slice(0, 800), { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, affectedFiles: [file] });
    });
  }

  registry.register(
    mustDef("runtime.assert"),
    async (args, ctx) => {
      const projectDir = needProject(args);
      if (!projectDir) return fail("runtime.assert", "projectDir is required");
      // Support the critical-test shape: "create floor + SpawnLocation +
      // 10 coins then verify" runs through project-file helpers first when
      // requested via args.setup=true.
      const r = await runRobloxRuntimeQa(projectDir, {
        bridge: args.bridgeUrl ? createStudioBridge({ baseUrl: args.bridgeUrl as string }) : undefined,
        runRojoBuild: args.runRojoBuild !== false,
        attemptNumber: ctx.attempt ?? 1,
      });
      if (r.status === "PASS") return pass("runtime.assert", r.reason, { stdout: r.stdout, durationMs: r.durationMs, affectedFiles: r.affectedFiles, screenshotPath: r.screenshotPath, data: { checks: r.checks } });
      if (r.status === "BLOCKED") return toBlocked("runtime.assert", r.reason, { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, affectedFiles: r.affectedFiles });
      return fail("runtime.assert", r.reason, { stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, affectedFiles: r.affectedFiles, screenshotPath: r.screenshotPath, data: { repairContext: r.repairContext, checks: r.checks } });
    }
  );

  registry.register(
    mustDef("asset.search"),
    async (args) => {
      const r = await searchAssets(String(args.query ?? ""), { limit: args.limit as number | undefined });
      return pass("asset.search", r.message, { data: { candidates: r.candidates } });
    }
  );

  registry.register(
    mustDef("asset.insert"),
    async (args, ctx) => {
      const v = validateAssetInsert({ assetId: String(args.assetId ?? ""), parent: String(args.parent ?? ""), assetType: String(args.assetType ?? "model") });
      if (!v.ok) return fail("asset.insert", v.reason!);
      const projectDir = needProject(args) ?? ctx.projectDir;
      if (projectDir) {
        const note = await writeAssetQuarantineNote(projectDir, String(args.assetId), String(args.parent));
        return pass("asset.insert", `asset ${args.assetId} validated; insert via Studio bridge then QA-review ${note}. Untrusted scripts quarantined.`, {
          data: { quarantineNote: note },
          affectedFiles: [note],
        });
      }
      return pass("asset.insert", `asset ${args.assetId} validated (no project dir for quarantine note). Insert via Studio bridge; QA must review scripts.`);
    }
  );

  registry.register(
    mustDef("gamesystem.use"),
    async (args) => {
      const op = String(args.op ?? "list");
      if (op === "list") {
        return pass("gamesystem.use", "game systems listed", { data: { systems: listGameSystems() }, stdout: listGameSystems().map((s) => s.id).join(",") });
      }
      if (op === "load") {
        const id = String(args.id ?? "");
        try {
          const src = await loadGameSystemSource(id);
          return pass("gamesystem.use", `game system loaded: ${id}`, { stdout: src.slice(0, 4000), data: { id, bytes: src.length } });
        } catch (e) {
          return fail("gamesystem.use", e instanceof Error ? e.message : String(e));
        }
      }
      if (op === "install") {
const projectDir = needProject(args) ?? undefined;
        if (!projectDir) return fail("gamesystem.use", "projectDir is required for install");
        const id = String(args.id ?? "");
        try {
          const r = await installGameSystem(projectDir, id);
          return pass("gamesystem.use", `installed ${id} at ${r.path}`, { affectedFiles: [r.path], data: { ...r } });
        } catch (e) {
          return fail("gamesystem.use", e instanceof Error ? e.message : String(e));
        }
      }
      return fail("gamesystem.use", `unknown op: ${op} (list|load|install)`);
    }
  );

  registry.register(
    mustDef("gameplay.create"),
    async (args) => {
      const projectDir = needProject(args);
      if (!projectDir) return fail("gameplay.create", "projectDir is required");
      const kind = String(args.kind ?? "");
      if (!(supportedGameplayKinds() as string[]).includes(kind)) {
        return fail("gameplay.create", `unsupported kind: ${kind} (supported: ${supportedGameplayKinds().join(", ")})`);
      }
      const name = String(args.name ?? "");
      if (!name) return fail("gameplay.create", "name is required");
      try {
        const spec = await createGameplay(projectDir, { kind: kind as never, name, options: (args.options as Record<string, unknown>) ?? {} });
        return pass("gameplay.create", `gameplay created: ${kind} "${name}" (${spec.files.join(", ")})`, {
          affectedFiles: spec.files,
          data: { ...(spec as unknown as Record<string, unknown>) },
        });
      } catch (e) {
        return fail("gameplay.create", e instanceof Error ? e.message : String(e));
      }
    }
  );

  registry.register(
    mustDef("research.web"),
    async (args) => {
      const topic = String(args.topic ?? "").slice(0, 500);
      if (!topic) return fail("research.web", "topic is required");
      return pass("research.web", `research guidance recorded for: ${topic} (research agents synthesize project-local docs; no destructive Studio permissions granted)`, {
        data: { topic },
      });
    }
  );

  registry.register(
    mustDef("research.reference"),
    async (args) => {
      const caption = String(args.caption ?? args.text ?? "");
      const intent = heuristicStyleFromText(caption);
      return pass("research.reference", "reference style intent derived (style direction only — never copy copyrighted designs)", {
        stdout: renderStyleIntent(intent),
        data: { ...(intent as unknown as Record<string, unknown>) },
      });
    }
  );

  // Full playtest runner (explicit id kept OUT of ROLE_TOOLS; QA reaches it
  // via studio.play + runtime.assert; registered here for completeness of
  // the playtest flow when callers need assertions in one call).
  void runStudioPlaytest;
}

function mustDef(id: string): ToolDefinition {
  const def = LOCAL_TOOL_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`local tool def missing: ${id}`);
  return def;
}

type SceneHandler = (bridge: StudioBridgeClient, args: Record<string, unknown>) => Promise<{ ok: boolean; infra: boolean; message: string; stdout: string; stderr: string; data?: unknown }>;

/**
 * Register every scene.* tool with the same PASS/FAIL/BLOCKED mapping as the
 * studio-bridge tools (ScenarioResult → registry ToolResult).
 */
function registerSceneLayer(
  registry: ToolRegistry,
  handlers: Record<string, SceneHandler>
): void {
  for (const def of SCENE_TOOL_DEFS) {
    const handler = handlers[def.id];
    if (!handler) continue;
    registry.register(def, async (args, _ctx) => {
      const bridge = bridgeFrom(args);
      const r = await handler(bridge, args);
      if (r.ok) return pass(def.id, r.message || "ok", { stdout: r.stdout, data: (r.data as Record<string, unknown> | undefined) });
      if (r.infra) return toBlocked(def.id, r.message, { stdout: r.stdout, stderr: r.stderr });
      return fail(def.id, r.message, { stdout: r.stdout, stderr: r.stderr });
    });
  }
}

/** Every role-referenced tool id must resolve to a registered tool. */
export function builtinCoverage(): { referenced: string[]; registered: string[]; missing: string[] } {
  const referenced = [...new Set(Object.values(ROLE_TOOLS).flat())];
  const registered = [...STUDIO_TOOL_DEFS.map((d) => d.id), ...LOCAL_TOOL_DEFS.map((d) => d.id), ...SCENE_TOOL_DEFS.map((d) => d.id)];
  // runtime extras resolved dynamically:
  const extra = ["studio.delete", "script.read", "script.edit", "luau.execute", "studio.play", "studio.stop", "studio.output"];
  const all = new Set([...registered, ...extra]);
  return { referenced, registered, missing: referenced.filter((r) => !all.has(r)) };
}
