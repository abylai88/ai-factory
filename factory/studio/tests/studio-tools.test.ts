import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { StudioBridge } from "../bridge.js";
import {
  inspectInstance,
  createInstance,
  modifyInstance,
  executeLuau,
  readOutput,
  captureScreenshot,
  startPlay,
  stopPlay,
} from "../tools.js";
import {
  runStudioPlaytest,
  runPlaytestLifecycle,
  classifyPlaytestStartFailure,
  type PlaytestLifecycleOps,
  type PlaytestInspect,
} from "../playtest.js";
import { ToolRegistry } from "../../tools/registry.js";
import { registerBuiltinTools } from "../../tools/builtin.js";
import { capturePlaytestScreenshot } from "../../roblox/screenshot.js";

/**
 * Stub Studio HTTP bridge (Chrrxs-compatible surface: /health, /status,
 * /mcp/<tool>). Behavior switches let tests drive PASS / FAIL / BLOCKED
 * without a real Studio install.
 */
const behavior = {
  connected: true,
  evalOk: true,
  outputText: "Studio log line 1\n",
  runtime: { phase: "edit", peers: { edit: "peer:edit" } as Record<string, string> },
};

function resetRuntime(): void {
  behavior.runtime = { phase: "edit", peers: { edit: "peer:edit" } };
}

function setRunning(): void {
  behavior.runtime = { phase: "running", peers: { edit: "peer:edit", server: "peer:server", "client-1": "peer:client-1" } };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
  });
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (req.method === "GET" && url === "/health") return json(res, 200, { ok: true });
    if (req.method === "GET" && url === "/status") {
      return json(res, 200, {
        plugin_connected: behavior.connected,
        instances: behavior.connected ? [{ id: "place-1", placeName: "Test", mode: "edit" }] : [],
      });
    }
    if (req.method === "POST" && url.startsWith("/mcp/")) {
      const tool = decodeURIComponent(url.slice("/mcp/".length));
      const raw = await readBody(req);
      let payload: { action?: string; [k: string]: unknown } = {};
      try {
        payload = JSON.parse(raw) as { action?: string; [k: string]: unknown };
      } catch {
        /* ignore non-json body */
      }
      switch (tool) {
        case "get_datamodel":
          return json(res, 200, { ok: true, data: { root: "game", children: ["Workspace"] } });
        case "create_instance":
        case "set_properties":
        case "start_playtest":
        case "stop_playtest":
          return json(res, 200, { ok: true, message: `${tool} ok` });
        case "get_connected_instances":
          return json(res, 200, {
            ok: true,
            message: "connected instances read",
            instances: [{ id: "place-1", placeName: "Test", peers: behavior.runtime.peers }],
            multiplayerGroups: [],
            phase: behavior.runtime.phase,
          });
        case "multiplayer_playtest": {
          const action = String(payload.action ?? "");
          if (action === "start") {
            setRunning();
            return json(res, 200, { ok: true, message: "multiplayer started", success: true });
          }
          if (action === "end") {
            resetRuntime();
            return json(res, 200, { ok: true, message: "multiplayer ended", success: true });
          }
          return json(res, 200, { ok: false, error: `unknown multiplayer action ${action}` });
        }
        case "solo_playtest": {
          const action = String(payload.action ?? "");
          if (action === "start") {
            setRunning();
            return json(res, 200, { ok: true, message: "solo started", success: true });
          }
          if (action === "stop") {
            resetRuntime();
            return json(res, 200, { ok: true, message: "solo stopped", success: true });
          }
          return json(res, 200, { ok: false, error: `unknown solo action ${action}` });
        }
        case "get_output":
          return json(res, 200, { ok: true, output: behavior.outputText });
        case "capture_screenshot":
          return json(res, 200, { ok: true, path: "shot-stub-1" });
        case "eval_luau":
          if (behavior.evalOk) return json(res, 200, { ok: true, result: true, output: "true" });
          return json(res, 200, { ok: false, error: "game assertion evaluated to false" });
        case "boom":
          return json(res, 200, { ok: false, error: "runtime error: attempt to index nil" });
        default:
          return json(res, 404, { error: `no tool "${tool}"` });
      }
    }
    return json(res, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function bridge(): StudioBridge {
  return new StudioBridge({ baseUrl, timeoutMs: 8000 });
}

// ─── 7. studio unavailable → BLOCKED ──────────────────────────────

describe("studio unavailable → BLOCKED", () => {
  it("discover reports disconnected when nothing listens", async () => {
    const b = new StudioBridge({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
    const d = await b.discover();
    expect(d.bridgeAlive).toBe(false);
    expect(d.pluginConnected).toBe(false);
  });

  it("callTool to a dead bridge is infra (BLOCKED), never FAIL", async () => {
    const b = new StudioBridge({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
    const r = await b.callTool("get_datamodel", {});
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(true);
    expect(r.message).toMatch(/roblox_toolchain/);
  });

  it("registry maps dead Studio to BLOCKED (not permission, not code bug)", async () => {
    const reg = new ToolRegistry();
    registerBuiltinTools(reg);
    const res = await reg.execute(
      "studio.inspect",
      { bridgeUrl: "http://127.0.0.1:1", path: "game.Workspace" },
      { role: "programmer" }
    );
    expect(res.status).toBe("BLOCKED");
    expect(res.message).toMatch(/roblox_toolchain|Studio not connected|unreachable/i);
  });

  it("playtest without Studio is BLOCKED infrastructure", async () => {
    const b = new StudioBridge({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
    const r = await runStudioPlaytest(b, { settleMs: 10, captureScreenshot: false });
    expect(r.status).toBe("BLOCKED");
    expect(r.infraReason).toMatch(/roblox_toolchain/);
  });
});

// ─── 8. studio runtime error → FAIL ───────────────────────────────

describe("studio runtime error → FAIL", () => {
  it("bridge tool reporting a game error is FAIL (infra=false)", async () => {
    const r = await bridge().callTool("boom", {});
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(false);
    expect(r.message).toMatch(/attempt to index nil/);
  });

  it("playtest with failing assertions is FAIL (not BLOCKED)", async () => {
    behavior.evalOk = false;
    try {
      const r = await runStudioPlaytest(bridge(), {
        settleMs: 10,
        captureScreenshot: false,
        assertions: [{ name: "player-present", expression: "#game:GetService('Players'):GetPlayers() > 0", message: "player" }],
        config: { runtimeTimeoutMs: 60, startupTimeoutMs: 250, teardownTimeoutMs: 250, pollIntervalMs: 10 },
      });
      expect(r.status).toBe("FAIL");
      expect(r.assertions.some((a) => !a.passed)).toBe(true);
    } finally {
      behavior.evalOk = true;
    }
  });
});

// ─── studio tools validation ──────────────────────────────────────

describe("studio tools", () => {
  it("discovers the stub bridge as connected", async () => {
    const d = await bridge().discover();
    expect(d.bridgeAlive).toBe(true);
    expect(d.pluginConnected).toBe(true);
    expect(d.instances.length).toBe(1);
  });

  it("inspect/create/modify validate before any bridge call", async () => {
    const b = bridge();
    expect((await inspectInstance(b, { depth: 99 })).ok).toBe(false);
    expect((await createInstance(b, { className: "Nope", name: "X", parent: "Workspace" })).ok).toBe(false);
    expect((await modifyInstance(b, { path: "game.Workspace.X", properties: {} })).ok).toBe(false);
    expect((await executeLuau(b, { source: "" })).ok).toBe(false);
  });

  it("inspect against the stub passes", async () => {
    const r = await inspectInstance(bridge(), { path: "game.Workspace", depth: 1 });
    expect(r.ok).toBe(true);
  });

  it("play/stop/output round-trip", async () => {
    const b = bridge();
    expect((await startPlay(b)).ok).toBe(true);
    expect((await readOutput(b, { limit: 10 })).ok).toBe(true);
    expect((await stopPlay(b)).ok).toBe(true);
  });

  it("unknown bridge tool is infra 404 (version skew is visible)", async () => {
    const r = await bridge().callTool("future_tool_xyz", {});
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(true);
  });
});

// ─── 11. screenshot output ────────────────────────────────────────

describe("screenshot output", () => {
  it("captureScreenshot returns a bridge reference", async () => {
    const r = await captureScreenshot(bridge(), { label: "qa-check" });
    expect(r.ok).toBe(true);
  });

  it("capturePlaytestScreenshot emits screenshot.created with a path", async () => {
    const r = await capturePlaytestScreenshot(bridge(), { label: "t", role: "qa" });
    expect(r.status).toBe("PASS");
    expect(r.screenshotPath).toBe("shot-stub-1");
  });

  it("screenshot without Studio is BLOCKED", async () => {
    const b = new StudioBridge({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
    const r = await capturePlaytestScreenshot(b, { role: "qa" });
    expect(r.status).toBe("BLOCKED");
    expect(r.infraReason).toMatch(/roblox_toolchain/);
  });
});

// ─── 12. playtest output ──────────────────────────────────────────

describe("playtest output", () => {
  it("full playtest passes against the healthy stub", async () => {
    const r = await runStudioPlaytest(bridge(), {
      settleMs: 10,
      captureScreenshot: true,
      config: { runtimeTimeoutMs: 500, startupTimeoutMs: 500, teardownTimeoutMs: 500, pollIntervalMs: 10 },
    });
    expect(r.status).toBe("PASS");
    expect(r.assertions.length).toBeGreaterThan(0);
    expect(r.screenshot).toBeDefined();
  });

  it("runtime errors in output fail the playtest", async () => {
    behavior.outputText = "12:00:01 ERROR attempt to index nil with 'Position'\nstack begin\n";
    try {
      const r = await runStudioPlaytest(bridge(), {
        settleMs: 10,
        captureScreenshot: false,
        config: { runtimeTimeoutMs: 500, startupTimeoutMs: 500, teardownTimeoutMs: 500, pollIntervalMs: 10 },
      });
      expect(r.status).toBe("FAIL");
      expect(r.message).toMatch(/runtime error/i);
    } finally {
      behavior.outputText = "Studio log line 1\n";
    }
  });
});

// ─── 13. playtest lifecycle / wedged session classification ───────

function ok(extra: Partial<{ stdout: string; data: unknown }> = {}): {
  ok: true; infra: false; message: string; stdout: string; stderr: string; data?: unknown;
} {
  return {
    ok: true,
    infra: false,
    message: "ok",
    stdout: extra.stdout ?? "",
    stderr: "",
    ...(extra.data !== undefined ? { data: extra.data } : {}),
  };
}

interface OpsHarness {
  ops: PlaytestLifecycleOps;
  calls: { startMp: number; startSolo: number; stopMp: number; stopSolo: number; readOutput: number; screenshot: number; execute: number; inspect: number };
  set: (state: PlaytestInspect["state"]) => void;
}

/** Builds lifecycle ops backed by a mutable edit/running stub session. */
function makeOps(overrides: Partial<PlaytestLifecycleOps> = {}, failExecute = false): OpsHarness {
  const calls = { startMp: 0, startSolo: 0, stopMp: 0, stopSolo: 0, readOutput: 0, screenshot: 0, execute: 0, inspect: 0 };
  let current: PlaytestInspect["state"] = "EDIT";
  const set = (state: PlaytestInspect["state"]): void => {
    current = state;
  };
  const running = (): boolean => current === "RUNNING" || current === "STUCK";
  const ops: PlaytestLifecycleOps = {
    inspect: async () => {
      calls.inspect++;
      const live = running();
      return {
        state: current,
        phase: live ? "running" : "edit",
        connected: true,
        editModeReady: !live,
        roles: live ? ["server", "client-1"] : ["edit"],
        serverPeerId: live ? "peer:server" : undefined,
        clientPeerIds: live ? ["peer:client-1"] : [],
        multiplayerGroupId: undefined,
        message: "fake inspect",
      };
    },
    startMultiplayer: async () => {
      calls.startMp++;
      current = "RUNNING";
      return { ok: true, message: "mp ok", mode: "multiplayer", infra: false };
    },
    startSolo: async () => {
      calls.startSolo++;
      current = "RUNNING";
      return { ok: true, message: "solo ok", mode: "solo", infra: false };
    },
    stopMultiplayer: async () => {
      calls.stopMp++;
      current = "EDIT";
      return { ok: true, message: "mp stopped", unconfirmed: false };
    },
    stopSolo: async () => {
      calls.stopSolo++;
      current = "EDIT";
      return { ok: true, message: "solo stopped", unconfirmed: false };
    },
    readOutput: async () => {
      calls.readOutput++;
      return ok({ stdout: "log line\n" });
    },
    execute: async () => {
      calls.execute++;
      if (failExecute) return { ok: false, infra: false, message: "game assertion evaluated to false", stdout: "false", stderr: "false" };
      return ok({ stdout: "true" });
    },
    screenshot: async () => {
      calls.screenshot++;
      return ok({ data: { path: "shot" } });
    },
    ...overrides,
  };
  return { ops, calls, set };
}

describe("playtest lifecycle (mockable)", () => {
  it("classifies a wedged 'already running' session as infrastructure, not FAIL", () => {
    const c = classifyPlaytestStartFailure(
      "Wait for Studio to finish its current playtest transition before starting another"
    );
    expect(c.infra).toBe(true);
    expect(c.wedged).toBe(true);
    expect(c.message).toMatch(/roblox_toolchain/);
  });

  it("classifies a disconnected Studio start as infrastructure", () => {
    const c = classifyPlaytestStartFailure("Studio not connected");
    expect(c.infra).toBe(true);
    expect(c.wedged).toBe(false);
  });

  it("recovers a wedged (STUCK) session before starting", async () => {
    const harness = makeOps();
    harness.set("STUCK");
    const r = await runPlaytestLifecycle(harness.ops, {
      settleMs: 1,
      captureScreenshot: false,
      config: { runtimeTimeoutMs: 250, startupTimeoutMs: 250, teardownTimeoutMs: 250, pollIntervalMs: 10 },
    });
    expect(r.status).toBe("PASS");
    expect(harness.calls.stopMp).toBeGreaterThanOrEqual(1);
    expect(harness.calls.stopSolo).toBeGreaterThanOrEqual(1);
    expect(harness.calls.startMp).toBe(1);
  });

  it("returns BLOCKED and stops both modes when start itself is wedged infra", async () => {
    let stopMp = 0;
    let stopSolo = 0;
    const harness = makeOps({
      startMultiplayer: async () => ({ ok: false, message: "StopPlayMonitor is not running in the server DataModel", mode: "multiplayer", infra: true }),
      startSolo: async () => ({ ok: false, message: "StopPlayMonitor is not running in the server DataModel", mode: "solo", infra: true }),
      stopMultiplayer: async () => { stopMp++; return { ok: true, message: "mp stopped", unconfirmed: false }; },
      stopSolo: async () => { stopSolo++; return { ok: true, message: "solo stopped", unconfirmed: false }; },
    });
    const r = await runPlaytestLifecycle(harness.ops, {
      settleMs: 1,
      captureScreenshot: false,
      config: { runtimeTimeoutMs: 100, startupTimeoutMs: 100, teardownTimeoutMs: 250, pollIntervalMs: 10 },
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.infraReason).toMatch(/roblox_toolchain|wedged|StopPlayMonitor/i);
    expect(stopMp).toBe(1);
    expect(stopSolo).toBe(1);
  });

  it("stops the session (both modes) once after a successful run", async () => {
    const harness = makeOps();
    const r = await runPlaytestLifecycle(harness.ops, {
      settleMs: 1,
      captureScreenshot: false,
      config: { runtimeTimeoutMs: 250, startupTimeoutMs: 250, teardownTimeoutMs: 250, pollIntervalMs: 10 },
    });
    expect(r.status).toBe("PASS");
    expect(harness.calls.startMp).toBe(1);
    expect(harness.calls.stopMp).toBe(1);
    expect(harness.calls.stopSolo).toBe(1);
    expect(r.assertions.every((a) => a.passed)).toBe(true);
  });

  it("stops the session even when the run produces a PASS with stopAfter default", async () => {
    const harness = makeOps();
    const r = await runPlaytestLifecycle(harness.ops, {
      settleMs: 1,
      captureScreenshot: true,
      config: { runtimeTimeoutMs: 250, startupTimeoutMs: 250, teardownTimeoutMs: 250, pollIntervalMs: 10 },
    });
    expect(r.status).toBe("PASS");
    expect(r.screenshot).toBeDefined();
    expect(harness.calls.stopMp).toBe(1);
    expect(harness.calls.stopSolo).toBe(1);
  });

  it("a start failure that is a real game error (not infra) is FAIL and cleans up", async () => {
    let stopMp = 0;
    let stopSolo = 0;
    const harness = makeOps({
      startMultiplayer: async () => ({ ok: false, message: "game failed to load", mode: "multiplayer", infra: false }),
      startSolo: async () => ({ ok: false, message: "game failed to load", mode: "solo", infra: false }),
      stopMultiplayer: async () => { stopMp++; return { ok: true, message: "mp stopped", unconfirmed: false }; },
      stopSolo: async () => { stopSolo++; return { ok: true, message: "solo stopped", unconfirmed: false }; },
    });
    const r = await runPlaytestLifecycle(harness.ops, {
      settleMs: 1,
      captureScreenshot: false,
      config: { runtimeTimeoutMs: 250, startupTimeoutMs: 250, teardownTimeoutMs: 250, pollIntervalMs: 10 },
    });
    expect(r.status).toBe("FAIL");
    expect(stopMp).toBe(1);
    expect(stopSolo).toBe(1);
  });
});
