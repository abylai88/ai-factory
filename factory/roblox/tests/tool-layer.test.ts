import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { validateRobloxProject } from "../validation.js";
import { staticSpawnSafetyChecks, runRobloxRuntimeQa, RUNTIME_ASSERTIONS } from "../visual-qa.js";
import { listGameSystems, loadGameSystemSource, installGameSystem, getGameSystem, describeGameSystemsForPrompt } from "../game-systems/index.js";
import { createGameplay, supportedGameplayKinds } from "../gameplay-tools.js";
import { searchAssets, validateAssetInsert, writeAssetQuarantineNote, isAllowedAssetUrl } from "../asset-search.js";
import { probeBinary, runTool, probeToolchain } from "../toolchain.js";
import { heuristicStyleFromText, renderStyleIntent, analyzeReferenceImage } from "../reference-style.js";
import { ensureSmokeGeometry, runStudioSmoke } from "../smoke-studio.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { StudioBridge } from "../../studio/bridge.js";
import type { StudioCallResult } from "../../studio/bridge.js";
import { registerBuiltinTools } from "../../tools/builtin.js";
import { classifyFailure } from "../../mission/failure-triage.js";
import { evaluateRobloxRuntime } from "../../mission/diagnosis.js";
import { ValidationGate } from "../../mission/validation-gate.js";
import {
  selectPipeline,
  createFullGamePipeline,
  createGameImprovementPipeline,
  createEngineeringPipeline,
} from "../../pipeline/pipeline.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(HERE, "../../../templates/roblox-rojo-template");

let workdir = "";

async function freshProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-layer-"));
  await fs.cp(TEMPLATE, dir, { recursive: true });
  return dir;
}

beforeAll(async () => {
  workdir = await freshProject();
});

afterAll(async () => {
  if (workdir) await fs.rm(workdir, { recursive: true, force: true });
});

// ─── 16. reusable game systems ────────────────────────────────────

describe("reusable game systems", () => {
  it("lists 11 documented systems", () => {
    expect(listGameSystems().length).toBe(11);
    expect(describeGameSystemsForPrompt()).toMatch(/collectible/);
  });

  it("loads luau sources with server-authoritative content", async () => {
    const src = await loadGameSystemSource("currency");
    expect(src).toMatch(/leaderstats/);
    const shop = await loadGameSystemSource("shop");
    expect(shop).toMatch(/OnServerInvoke/);
    const save = await loadGameSystemSource("saveload");
    expect(save).toMatch(/pcall/);
  });

  it("rejects unknown systems (no fake components)", async () => {
    expect(getGameSystem("starship")).toBeUndefined();
    await expect(loadGameSystemSource("starship")).rejects.toThrow(/unknown game system/);
  });

  it("installs systems into the correct Rojo containers", async () => {
    const dir = await freshProject();
    try {
      const shared = await installGameSystem(dir, "collectible");
      expect(shared.path).toBe("src/ReplicatedStorage/Shared/GameSystems/Collectible.lua");
      const server = await installGameSystem(dir, "saveload");
      expect(server.path).toBe("src/ServerScriptService/GameSystems/SaveLoad.lua");
      await expect(fs.access(path.join(dir, shared.path))).resolves.toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── gameplay tools ───────────────────────────────────────────────

describe("gameplay tools", () => {
  it("supports the 8 highest-value kinds", () => {
    expect(supportedGameplayKinds()).toEqual(
      expect.arrayContaining(["collectible", "upgrade", "shop", "zone", "checkpoint", "interaction", "npc", "quest"])
    );
  });

  it("creates transparent, inspectable luau for collectibles", async () => {
    const dir = await freshProject();
    try {
      const spec = await createGameplay(dir, { kind: "collectible", name: "Coins", options: { count: 10, value: 1 } });
      expect(spec.files.some((f) => f.endsWith(".server.lua"))).toBe(true);
      expect(spec.instances.length).toBeGreaterThan(0);
      const wiring = await fs.readFile(path.join(dir, spec.files.find((f) => f.endsWith(".server.lua"))!), "utf8");
      expect(wiring).toMatch(/Collectible/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects bad kinds and names", async () => {
    await expect(createGameplay(workdir, { kind: "starship" as never, name: "X" })).rejects.toThrow(/unsupported/);
    await expect(createGameplay(workdir, { kind: "quest", name: "" })).rejects.toThrow();
  });
});

// ─── visual QA static gates ───────────────────────────────────────

describe("runtime QA static gates", () => {
  it("bare template fails spawn safety (honest void-fall detection)", async () => {
    const checks = await staticSpawnSafetyChecks(workdir);
    const failed = checks.filter((c) => !c.passed);
    // The template genuinely ships no floor/spawn geometry: this must FAIL,
    // proving the gate is real (rojo build alone would PASS).
    expect(failed.length).toBeGreaterThan(0);
  });

  it("smoke geometry satisfies spawn safety", async () => {
    const dir = await freshProject();
    try {
      await ensureSmokeGeometry(dir, 10);
      const validation = await validateRobloxProject(dir, { runRojoBuild: false });
      expect(validation.status).toBe("PASS");
      const checks = await staticSpawnSafetyChecks(dir);
      expect(checks.every((c) => c.passed)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("runtime QA on bare template fails with visual/gameplay route (static, no Studio)", async () => {
    const r = await runRobloxRuntimeQa(workdir, { runRojoBuild: false });
    expect(r.status).toBe("FAIL");
    expect(r.repairContext?.failureType).toBe("roblox_runtime");
    expect(r.repairContext?.suggestedRoute).toMatch(/visual\/gameplay/);
    expect(r.repairContext?.affectedInstances).toContain("Workspace.SpawnLocation");
  });

  it("runtime QA on smoke project without Studio is BLOCKED (static passed)", async () => {
    const dir = await freshProject();
    try {
      await ensureSmokeGeometry(dir, 10);
      const r = await runRobloxRuntimeQa(dir, { runRojoBuild: false });
      expect(r.status).toBe("BLOCKED");
      expect(r.reason).toMatch(/Studio not connected/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("recognizes floor/spawn authored as Rojo .model.json (no false void-fall FAIL)", async () => {
    const dir = await freshProject();
    try {
      const mapDir = path.join(dir, "src", "Workspace", "Map");
      await fs.mkdir(mapDir, { recursive: true });
      await fs.writeFile(
        path.join(mapDir, "Baseplate.model.json"),
        JSON.stringify({ ClassName: "Part", Properties: { Name: "Baseplate", Size: [120, 2, 120], Position: [0, -1, 0], Anchored: true } })
      );
      await fs.writeFile(
        path.join(mapDir, "Spawn.model.json"),
        JSON.stringify({ ClassName: "SpawnLocation", Properties: { Name: "Spawn", Size: [6, 1, 6], Position: [0, 0.5, 0], Anchored: true } })
      );
      const checks = await staticSpawnSafetyChecks(dir);
      expect(checks.every((c) => c.passed)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── runtime QA live-stage classification (mockable bridge) ───────

describe("runtime QA live-stage classification", () => {
  function fakeBridge(
    callTool: (tool: string) => StudioCallResult,
    opts: { connected?: boolean } = {}
  ): StudioBridge {
    const connected = opts.connected ?? true;
    return {
      discover: async () => ({
        bridgeAlive: true,
        pluginConnected: connected,
        instances: connected ? [{ id: "place-1" }] : [],
        message: connected ? "studio connected" : "no plugin",
      }),
      isStudioConnected: async () => connected,
      callTool: async (name: string) => callTool(name),
    } as unknown as StudioBridge;
  }

  function res(overrides: Partial<StudioCallResult>): StudioCallResult {
    return { ok: true, infra: false, message: "ok", stdout: "", stderr: "", ...overrides };
  }

  it("a wedged playtest start is BLOCKED infrastructure, not a game FAIL", async () => {
    const dir = await freshProject();
    try {
      await ensureSmokeGeometry(dir, 3);
      const bridge = fakeBridge((tool) => {
        if (tool === "start_playtest") {
          return res({ ok: false, message: "Wait for Studio to finish its current playtest transition before starting another", stderr: "wedged" });
        }
        return res({});
      });
      const r = await runRobloxRuntimeQa(dir, { runRojoBuild: false, bridge });
      expect(r.status).toBe("BLOCKED");
      expect(r.reason).toMatch(/wedged|roblox_toolchain/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("missing screenshot evidence is advisory: PASS is not silently incomplete", async () => {
    const dir = await freshProject();
    try {
      await ensureSmokeGeometry(dir, 3);
      const bridge = fakeBridge((tool) => {
        switch (tool) {
          case "start_playtest":
          case "stop_playtest":
            return res({});
          case "get_output":
            return res({ stdout: "clean runtime log\n" });
          case "eval_luau":
            return res({ stdout: "true" });
          case "capture_screenshot":
            return res({ data: {} }); // no path/base64 => unverified
          default:
            return res({});
        }
      });
      const r = await runRobloxRuntimeQa(dir, { runRojoBuild: false, bridge, playtestSettleMs: 1 });
      expect(r.status).toBe("PASS");
      expect(r.unverified && r.unverified.length).toBeGreaterThan(0);
      expect(r.reason).toMatch(/advisory|unverified/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── 13. repair context propagation ───────────────────────────────

describe("repair context propagation", () => {
  function delegation() {
    return {
      id: "del-1",
      missionId: "m-1",
      objectiveId: "o-1",
      title: "Fix spawn",
      description: "Add floor",
      pipelineType: "game" as const,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [],
      status: "failed" as const,
      createdAt: new Date().toISOString(),
    };
  }

  it("buildRepairContext carries instances, screenshot, runtime state, route", () => {
    const gate = new ValidationGate();
    const ctx = gate.buildRepairContext(
      delegation(),
      { passed: false, command: "roblox-runtime-qa", exitCode: 1, stdout: "o", stderr: "void fall", durationMs: 5 },
      2,
      3,
      ["first failed"],
      {
        platform: "roblox",
        affectedFiles: ["src/ServerScriptService/SmokeGeometry.server.lua"],
        affectedInstances: ["Workspace.SpawnLocation"],
        failureType: "roblox_runtime",
        observation: "player spawned 80 studs above floor",
        screenshotPath: "docs/qa/shot.png",
        runtimeState: { "player-present": "false" },
        suggestedRoute: "visual/gameplay repair",
      }
    );
    for (const needle of [
      "AFFECTED INSTANCES:",
      "Workspace.SpawnLocation",
      "FAILURE TYPE: roblox_runtime",
      "OBSERVATION: player spawned 80 studs above floor",
      "SCREENSHOT: docs/qa/shot.png",
      "RUNTIME STATE:",
      "SUGGESTED ROUTE: visual/gameplay repair",
      "ATTEMPT: 2/3",
    ]) {
      expect(ctx).toContain(needle);
    }
  });

  it("triage routes roblox_runtime to builder repair (never architect)", () => {
    const t = classifyFailure({
      delegation: delegation(),
      validationResult: { passed: false, command: "roblox-runtime-qa", exitCode: 1, stdout: "runtime QA FAIL: no floor beneath", stderr: "roblox_runtime void fall", durationMs: 1 },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });
    expect(t.category).toBe("roblox_runtime");
    expect(t.action).toBe("repair");
    expect(t.targetRole).not.toBe("architect");
  });

  it("triage routes studio-down to tool_unavailable research", () => {
    const t = classifyFailure({
      delegation: delegation(),
      validationResult: { passed: false, command: "studio.play", exitCode: 127, stdout: "", stderr: "Studio not connected", durationMs: 1 },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });
    expect(t.category).toBe("tool_unavailable");
  });

  it("diagnosis flags roblox runtime for visual/gameplay repair", () => {
    const d = evaluateRobloxRuntime({
      missionId: "m",
      projectId: "p",
      projectPath: "/tmp/p",
      acceptanceCriteria: [],
      buildFailed: false,
      buildError: "roblox_runtime: player falls into void",
      runtimeErrors: [],
      visualQaStatus: "failed",
      failedChecks: [{ name: "runtime:spawn-present-runtime", viewport: "studio", message: "FAILED" }],
      artifactMetadata: [],
      affectedFiles: ["src/ServerScriptService/SmokeGeometry.server.lua"],
      engine: "roblox",
    });
    expect(d.matched).toBe(true);
    expect(d.category).toBe("runtime-error");
    expect(d.summary).toMatch(/visual\/gameplay/);
  });
});

// ─── 14/15. web + roblox pipelines unchanged ──────────────────────

describe("platform pipelines unchanged", () => {
  it("web pipeline still targets Phaser/TS", () => {
    const p = createFullGamePipeline("build a web platformer game");
    expect(p.name).toBe("Game Production Pipeline");
    expect(p.steps.find((s) => s.id === "implementation")?.description).toMatch(/TypeScript\/Phaser/);
  });

  it("roblox pipeline still targets Luau/Rojo", () => {
    const p = createFullGamePipeline("build a roblox simulator game");
    expect(p.name).toBe("Roblox Game Production Pipeline");
    expect(p.steps.find((s) => s.id === "implementation")?.description).toMatch(/Luau/);
  });

  it("selectPipeline routing preserved for both platforms", () => {
    expect(selectPipeline("create a new roblox tycoon game").name).toMatch(/Roblox/);
    expect(selectPipeline("create a new arcade game").name).not.toMatch(/Roblox/);
    expect(createGameImprovementPipeline("fix roblox coin bug").name).toMatch(/Roblox/);
    expect(createEngineeringPipeline("fix roblox spawn bug").name).toMatch(/Roblox/);
  });
});

// ─── toolchain / assets / reference ───────────────────────────────

describe("toolchain wrappers", () => {
  it("missing binaries degrade to unavailable (no throw)", async () => {
    const probe = await probeBinary("definitely-not-a-real-binary-xyz");
    expect(probe.available).toBe(false);
    const run = await runTool("definitely-not-a-real-binary-xyz", ["--version"], { timeoutMs: 5000 });
    expect(run.ok).toBe(false);
    expect(run.exitCode).toBe(127);
    expect(run.stderr).toMatch(/roblox_toolchain/);
  });

  it("probes the full toolchain without throwing", async () => {
    const all = await probeToolchain();
    expect(all.map((a) => a.name)).toEqual(
      expect.arrayContaining(["stylua", "selene", "lune", "wally"])
    );
  });
});

describe("asset search safety", () => {
  it("empty query is rejected", async () => {
    const r = await searchAssets("");
    expect(r.status).toBe("BLOCKED");
  });

  it("search never fabricates assets offline", async () => {
    const r = await searchAssets("sci-fi crate");
    expect(r.status).toBe("PASS");
    expect(r.candidates).toEqual([]);
  });

  it("insert validation rejects non-numeric ids", () => {
    expect(validateAssetInsert({ assetId: "abc", parent: "Workspace" }).ok).toBe(false);
    expect(validateAssetInsert({ assetId: "123456", parent: "Workspace" }).ok).toBe(true);
    expect(validateAssetInsert({ assetId: "123", parent: "Workspace" }).ok).toBe(false);
  });

  it("only roblox https hosts allowed", () => {
    expect(isAllowedAssetUrl("https://create.roblox.com/x")).toBe(true);
    expect(isAllowedAssetUrl("http://create.roblox.com/x")).toBe(false);
    expect(isAllowedAssetUrl("https://evil.example/payload.rbxm")).toBe(false);
  });

  it("quarantine note is written for inserts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "asset-"));
    try {
      const rel = await writeAssetQuarantineNote(dir, "123456", "Workspace");
      const body = await fs.readFile(path.join(dir, rel), "utf8");
      expect(body).toMatch(/QUARANTINED/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("reference style intent", () => {
  it("derives sci-fi intent from caption text", () => {
    const intent = heuristicStyleFromText("sci-fi space mining reference");
    expect(intent.environment).toMatch(/sci-fi/);
    expect(renderStyleIntent(intent)).toMatch(/REFERENCE STYLE ANALYSIS/);
  });

  it("analyzeReferenceImage works without a vision model", async () => {
    const intent = await analyzeReferenceImage("dark dungeon concept", { caption: "dark dungeon" });
    expect(intent.source).toBe("heuristic");
    expect(intent.lighting).toMatch(/moody/);
  });
});

// ─── 25. smoke test ───────────────────────────────────────────────

describe("studio smoke", () => {
  it("file-mode smoke on bare template validates then fails spawn safety honestly", async () => {
    const dir = await freshProject();
    try {
      const r = await runStudioSmoke(dir, { skipRojoBuild: true, coinCount: 10 });
      // Geometry written + validation pass, but static spawn-safety... note:
      // smoke writes SmokeGeometry which SATISFIES spawn safety, so without
      // Studio the tail is BLOCKED (static passed, live pending).
      expect(r.status).toBe("BLOCKED");
      expect(r.steps.find((s) => s.name === "geometry-files")?.status).toBe("PASS");
      expect(r.steps.find((s) => s.name === "validate")?.status).toBe("PASS");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("smoke rejects non-roblox directories (no fake pass)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "not-roblox-"));
    try {
      const r = await runStudioSmoke(dir, { skipRojoBuild: true });
      expect(r.status).toBe("FAIL");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── registry runtime.assert end-to-end (static) ──────────────────

describe("registry runtime.assert", () => {
  it("bare template fails via registry with repair context (no Studio needed)", async () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const res = await reg.execute(
      "runtime.assert",
      { projectDir: workdir, runRojoBuild: false },
      { role: "qa" }
    );
    expect(res.status).toBe("FAIL");
    expect(res.message).toMatch(/floor|spawn|void/i);
  });
});

// ─── runtime assertions sandbox-safety ───────────────────────────

describe("runtime assertions sandbox safety", () => {
  it("never relies on class-filtered traversal (nil in the eval sandbox)", () => {
    const spawn = RUNTIME_ASSERTIONS.find((a) => a.name === "spawn-present-runtime");
    expect(spawn).toBeDefined();
    expect(spawn!.expr).toContain("GetDescendants");
    expect(spawn!.expr).toContain("IsA('SpawnLocation')");
    expect(spawn!.expr).not.toMatch(/FindFirstChildOfClass|FindFirstChildWhichIsA/);
  });

  it("covers the full runtime gate", () => {
    const names = RUNTIME_ASSERTIONS.map((a) => a.name);
    expect(names).toContain("player-present");
    expect(names).toContain("character-spawned");
    expect(names).toContain("character-not-falling");
  });
});
