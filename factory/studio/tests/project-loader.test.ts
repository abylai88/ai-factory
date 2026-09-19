import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadProject,
  createProjectLoaderOps,
  resolveProjectLoadConfig,
  placeNameFromPath,
  type ProjectLoadConfig,
  type StudioProjectLoaderOps,
  type ProjectLoadState,
} from "../project-loader.js";
import { createStudioBridge } from "../mcp-bridge.js";

/**
 * Stub Studio HTTP bridge with manage_instance support for testing
 * project loading without real Studio.
 */
let behavior: {
  connected: boolean;
  instances: Array<{ id: string; placeName: string; peers: Record<string, string> }>;
  multiplayerGroups: unknown[];
  phase: string;
  projectStructure: { root: string; children: string[] };
  runtimeLogs: string;
  manageInstanceCalls: Array<{ action: string; source?: string; local_place_file?: string }>;
} = {
  connected: false,
  instances: [],
  multiplayerGroups: [],
  phase: "",
  projectStructure: { root: "", children: [] },
  runtimeLogs: "",
  manageInstanceCalls: [],
};

function resetBehavior(): void {
  behavior.instances = [];
  behavior.multiplayerGroups = [];
  behavior.phase = "edit";
  behavior.manageInstanceCalls = [];
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
  behavior.connected = true;
  behavior.instances = [];
  behavior.multiplayerGroups = [];
  behavior.phase = "edit";
  behavior.projectStructure = { root: "game", children: ["Workspace"] };
  behavior.runtimeLogs = "Studio log line 1\n";
  behavior.manageInstanceCalls = [];

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
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
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
            instances: behavior.instances,
            multiplayerGroups: behavior.multiplayerGroups,
            phase: behavior.phase,
          });
        case "manage_instance": {
          const action = String(payload.action ?? "");
          const source = String(payload.source ?? "");
          behavior.manageInstanceCalls.push({ action, source, local_place_file: payload.local_place_file as string });
          if (action === "launch" && source === "local_file") {
            // Simulate launch - instances will be added by test via behavior
            return json(res, 200, { ok: true, message: "launch requested", instance_id: "instance:test-123" });
          }
          if (action === "close") {
            resetBehavior();
            return json(res, 200, { ok: true, message: "closed" });
          }
          return json(res, 200, { ok: true, message: `${tool} ${action} ok` });
        }
        case "get_project_structure":
          return json(res, 200, { ok: true, data: behavior.projectStructure });
        case "get_output":
          return json(res, 200, { ok: true, output: behavior.runtimeLogs });
        case "get_runtime_logs":
          return json(res, 200, { ok: true, entries: [{ message: behavior.runtimeLogs, level: "OUT" }] });
        case "capture_screenshot":
          return json(res, 200, { ok: true, path: "shot-stub-1" });
        case "eval_luau":
          return json(res, 200, { ok: true, result: true, output: "true" });
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

function bridge(): ReturnType<typeof createStudioBridge> {
  return createStudioBridge({ baseUrl, timeoutMs: 8000 });
}

/** Helper to create a temp .rbxlx file for testing. */
async function createTempPlace(name: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-load-test-"));
  const placePath = path.join(tmpDir, `${name}.rbxlx`);
  // Minimal valid .rbxlx (XML) content
  await fs.writeFile(placePath, `<?xml version="1.0"?><roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4"><Item class="DataModel"><Properties><string name="Name">Game</string></Properties></Item></roblox>`, "utf8");
  return placePath;
}

describe("project-loader config", () => {
  it("resolves defaults when no overrides", () => {
    const cfg = resolveProjectLoadConfig({});
    expect(cfg.studioStartupTimeoutMs).toBe(120_000);
    expect(cfg.pluginConnectTimeoutMs).toBe(60_000);
    expect(cfg.placeLoadTimeoutMs).toBe(180_000);
    expect(cfg.slowLoadThresholdMs).toBe(60_000);
    expect(cfg.maxTotalTimeoutMs).toBe(600_000);
    expect(cfg.pollIntervalMs).toBe(5_000);
  });

  it("applies explicit overrides", () => {
    const cfg = resolveProjectLoadConfig({
      studioStartupTimeoutMs: 30_000,
      placeLoadTimeoutMs: 60_000,
    });
    expect(cfg.studioStartupTimeoutMs).toBe(30_000);
    expect(cfg.placeLoadTimeoutMs).toBe(60_000);
    expect(cfg.pluginConnectTimeoutMs).toBe(60_000); // default
  });

  it("reads from environment", () => {
    const originalEnv = process.env.AI_FACTORY_STUDIO_LOAD_STARTUP_MS;
    process.env.AI_FACTORY_STUDIO_LOAD_STARTUP_MS = "45000";
    try {
      const cfg = resolveProjectLoadConfig({}, process.env);
      expect(cfg.studioStartupTimeoutMs).toBe(45_000);
    } finally {
      if (originalEnv === undefined) delete process.env.AI_FACTORY_STUDIO_LOAD_STARTUP_MS;
      else process.env.AI_FACTORY_STUDIO_LOAD_STARTUP_MS = originalEnv;
    }
  });
});

describe("isStructurePayloadReady", () => {
  it("accepts known structural shapes and rejects empty ones", async () => {
    const { isStructurePayloadReady } = await import("../project-loader.js");
    expect(isStructurePayloadReady({ root: "game", children: ["Workspace"] })).toBe(true);
    expect(isStructurePayloadReady({ name: "game" })).toBe(true);
    expect(isStructurePayloadReady({ children: [] })).toBe(false);
    expect(isStructurePayloadReady({ children: ["Workspace"] })).toBe(false);
    expect(isStructurePayloadReady({ tree: { name: "game" } })).toBe(true);
    expect(isStructurePayloadReady({ type: "service_overview", services: [{ path: "game.Workspace", name: "Workspace" }] })).toBe(true);
    expect(isStructurePayloadReady({ type: "service_overview", services: [] })).toBe(false);
    expect(isStructurePayloadReady({ ok: true })).toBe(false);
    expect(isStructurePayloadReady(null)).toBe(false);
    expect(isStructurePayloadReady("game")).toBe(false);
  });
});

describe("placeNameFromPath", () => {
  it("extracts name from .rbxlx", () => {
    expect(placeNameFromPath("/path/to/MyPlace.rbxlx")).toBe("MyPlace");
  });
  it("extracts name from .rbxl", () => {
    expect(placeNameFromPath("/path/to/MyPlace.rbxl")).toBe("MyPlace");
  });
  it("handles windows paths", () => {
    expect(placeNameFromPath("C:\\Projects\\MyPlace.rbxlx")).toBe("MyPlace");
  });
});

interface MockOpsState {
  currentInstances: Array<{ id: string; placeName: string; peers: Record<string, string> }>;
  currentPhase: string;
  projectReady: boolean;
  /** Managed processes reported by manageStatus. */
  statusProcesses: Array<{
    launchId?: string;
    instanceId?: string;
    pid?: number;
    state: string;
    connected: boolean;
    processRunning?: boolean;
    localPlaceFile?: string;
    failureReason?: string;
  }>;
  statusReachable: boolean;
  /** manageInstance launch calls observed (args recorded for assertions). */
  launchCalls: Array<Record<string, unknown>>;
  closeCalls: string[];
}

function makeOps(overrides: Partial<StudioProjectLoaderOps> = {}): { ops: StudioProjectLoaderOps; state: MockOpsState } {
  const state: MockOpsState = {
    currentInstances: [],
    currentPhase: "edit",
    projectReady: false,
    statusProcesses: [],
    statusReachable: true,
    launchCalls: [],
    closeCalls: [],
  };

  const makeResponse = (data: unknown) => ({ ok: true, infra: false, message: "ok", data, stdout: "", stderr: "" });

  const ops: StudioProjectLoaderOps = {
    manageInstance: async (args) => {
      if (args.action === "launch") {
        state.launchCalls.push({ ...(args as unknown as Record<string, unknown>) });
        return makeResponse({ ok: true, message: "launch requested", instance_id: "instance:test-123", launch_id: "launch:test-1" });
      }
      if (args.action === "close") {
        if (typeof args.instance_id === "string") state.closeCalls.push(args.instance_id);
        state.currentInstances = [];
        state.currentPhase = "edit";
        return makeResponse({ ok: true, message: "closed" });
      }
      return makeResponse({ ok: true, message: "ok" });
    },
    manageStatus: async () => {
      if (!state.statusReachable) return { ok: false, infra: true, message: "status unreachable", stdout: "", stderr: "status unreachable" };
      return makeResponse({
        managed: state.statusProcesses.map((p) => ({
          launch_id: p.launchId,
          instance_id: p.instanceId,
          pid: p.pid,
          state: p.state,
          connected: p.connected,
          process_running: p.processRunning ?? false,
          roles: p.connected ? ["edit"] : [],
          source: "local_file",
          local_place_file: p.localPlaceFile,
          failure_reason: p.failureReason,
        })),
        connected: state.currentInstances.map((i) => ({ instance_id: i.id, place_name: i.placeName, roles: ["edit"] })),
      });
    },
    getConnectedInstances: async () => {
      return makeResponse({
        ok: true,
        message: "connected instances read",
        instances: state.currentInstances,
        multiplayerGroups: [],
        phase: state.currentPhase,
      });
    },
    getProjectStructure: async () => {
      if (!state.projectReady) return makeResponse({ ok: false, message: "not ready" });
      // verifyPlaceReady expects r.data.root directly
      return { ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" };
    },
    getRuntimeLogs: async () => makeResponse({ ok: true, output: "log line\n" }),
  };
  Object.assign(ops, overrides);

  return { ops, state };
}

describe("project-loader (mockable)", () => {
  const fastConfig: Partial<ProjectLoadConfig> = {
    studioStartupTimeoutMs: 5_000,
    pluginConnectTimeoutMs: 5_000,
    placeLoadTimeoutMs: 5_000,
    slowLoadThresholdMs: 2_000,
    maxTotalTimeoutMs: 30_000,
    pollIntervalMs: 100,
  };

  it("reuses existing Studio with correct place", async () => {
    const { ops, state } = makeOps();
    state.currentInstances = [{ id: "instance:existing", placeName: "MyPlace", peers: { edit: "peer:edit" } }];
    state.projectReady = true;

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);

    expect(result.ok).toBe(true);
    expect(result.state).toBe("PLACE_READY");
    // Reuse is not directly exposed in evidence; verified by successful load without launch
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("launches new Studio when no matching place exists", async () => {
    const { ops, state } = makeOps();
    state.currentInstances = [{ id: "instance:other", placeName: "OtherPlace", peers: { edit: "peer:edit" } }];

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);

    // Should have attempted launch (ops.manageInstance called)
    expect(result.evidence.diagnostics.studioProcessDetected).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("detects slow but healthy load (new Studio launch)", async () => {
    const { ops, state } = makeOps();
    let launchCalled = false;
    let readyCallCount = 0;
    const originalManageInstance = ops.manageInstance;
    ops.manageInstance = async (args) => {
      if (args.action === "launch" && args.source === "local_file") {
        launchCalled = true;
        return originalManageInstance(args);
      }
      return originalManageInstance(args);
    };
    ops.getConnectedInstances = async () => {
      if (!launchCalled) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => {
      readyCallCount++;
      if (readyCallCount < 3) {
        return { ok: true, infra: false, message: "ok", data: { children: ["Workspace"] }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" };
    };

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      slowLoadThresholdMs: 100,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("PLACE_READY");
    expect(result.evidence.advisoryMessages.some((m) => m.includes("slow"))).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("times out when place never appears", async () => {
    const { ops } = makeOps();
    ops.getConnectedInstances = async () => ({ ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" });

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      maxTotalTimeoutMs: 1_000,
      pollIntervalMs: 50,
    });

    expect(result.ok).toBe(false);
    expect(result.state).toBe("LOAD_TIMEOUT");
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("fails when manage_instance returns error", async () => {
    const { ops } = makeOps();
    ops.manageInstance = async () => ({ ok: false, infra: true, message: "disk full", stdout: "", stderr: "disk full" });

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);

    expect(result.ok).toBe(false);
    expect(result.state).toBe("FAILED");
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("records structured diagnostics throughout load (new Studio launch)", async () => {
    const { ops } = makeOps();
    let launchCalled = false;
    const originalManageInstance = ops.manageInstance;
    ops.manageInstance = async (args) => {
      if (args.action === "launch" && args.source === "local_file") {
        launchCalled = true;
        return originalManageInstance(args);
      }
      return originalManageInstance(args);
    };
    ops.getConnectedInstances = async () => {
      if (!launchCalled) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);

    const diag = result.evidence.diagnostics;
    expect(diag.projectFileSizeBytes).toBeGreaterThan(0);
    expect(diag.mcpReachable).toBe(true);
    expect(diag.pluginConnected).toBe(true);
    expect(diag.probeCount).toBeGreaterThan(0);
    expect(diag.elapsedMs).toBeGreaterThanOrEqual(0);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("emits progress events during load (new Studio launch)", async () => {
    const { ops } = makeOps();
    let launchCalled = false;
    const originalManageInstance = ops.manageInstance;
    ops.manageInstance = async (args) => {
      if (args.action === "launch" && args.source === "local_file") {
        launchCalled = true;
        return originalManageInstance(args);
      }
      return originalManageInstance(args);
    };
    ops.getConnectedInstances = async () => {
      if (!launchCalled) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });

    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);

    expect(result.evidence.transitions.length).toBeGreaterThan(0);
    expect(result.evidence.transitions.some(t => t.to === "PLACE_READY")).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });
});

describe("project-loader decoupled lifecycle", () => {
  const fastConfig: Partial<ProjectLoadConfig> = {
    launchAckTimeoutMs: 8_000,
    studioStartupTimeoutMs: 5_000,
    pluginConnectTimeoutMs: 5_000,
    placeLoadTimeoutMs: 5_000,
    slowLoadThresholdMs: 2_000,
    maxTotalTimeoutMs: 30_000,
    pollIntervalMs: 50,
  };

  it("1. launch is acknowledged quickly (no held request)", async () => {
    const { ops, state } = makeOps();
    let launched = false;
    const baseManage = ops.manageInstance;
    ops.manageInstance = async (args) => {
      if (args.action === "launch") launched = true;
      return baseManage(args);
    };
    ops.getConnectedInstances = async () => {
      if (!launched) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      expectedPlaceName: "MyPlace",
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("PLACE_READY");
    expect(state.launchCalls.length).toBe(1);
    expect(state.launchCalls[0].wait_for_connection).toBe(false);
    expect(state.launchCalls[0].timeout_ms).toBe(8_000);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("2. Studio process alive without MCP is not a failure", async () => {
    const { ops, state } = makeOps();
    state.statusProcesses = [{ launchId: "L-alive", pid: 4242, state: "launching", connected: false }];
    let calls = 0;
    const baseInstances = ops.getConnectedInstances;
    ops.getConnectedInstances = async () => {
      calls++;
      if (calls <= 2) return { ok: false, infra: true, message: "unreachable", stdout: "", stderr: "unreachable" };
      return baseInstances();
    };
    const placePath = await createTempPlace("MyPlace");
    state.currentInstances = [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }];
    state.projectReady = true;
    const result = await loadProject(ops, placePath, fastConfig);
    expect(result.ok).toBe(true);
    expect(result.state).toBe("PLACE_READY");
    expect(result.evidence.transitions.some((t) => t.to === "STUDIO_PROCESS_ALIVE")).toBe(true);
    expect(result.evidence.diagnostics.processAlive).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("3. delayed plugin connection still reaches ready", async () => {
    const { ops, state } = makeOps();
    state.projectReady = true;
    state.statusProcesses = [{ launchId: "L-conn", pid: 111, state: "launching", connected: false }];
    let calls = 0;
    ops.getConnectedInstances = async () => {
      calls++;
      if (calls <= 3) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);
    expect(result.ok).toBe(true);
    expect(result.evidence.transitions.some((t) => t.to === "PLUGIN_CONNECTING")).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("4. delayed place detection still reaches ready", async () => {
    const { ops } = makeOps();
    let calls = 0;
    ops.getConnectedInstances = async () => {
      calls++;
      if (calls <= 3) {
        return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i0", placeName: "Other", peers: { edit: "p0" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);
    expect(result.ok).toBe(true);
    expect(result.evidence.transitions.some((t) => t.to === "PLUGIN_CONNECTED")).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("5. sustained healthy load reports PLACE_LOADING, not MCP failure", async () => {
    const { ops } = makeOps();
    let launchCalled = false;
    const base = ops.manageInstance;
    ops.manageInstance = async (args) => {
      if (args.action === "launch") launchCalled = true;
      return base(args);
    };
    ops.getConnectedInstances = async () => {
      if (!launchCalled) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    let readyCalls = 0;
    ops.getProjectStructure = async () => {
      readyCalls++;
      if (readyCalls < 5) {
        return { ok: true, infra: false, message: "ok", data: { children: ["Workspace"] }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" };
    };
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      slowLoadThresholdMs: 100,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("PLACE_READY");
    expect(result.evidence.transitions.some((t) => t.to === "PLACE_LOADING")).toBe(true);
    expect(result.evidence.advisoryMessages.some((m) => m.includes("slow"))).toBe(true);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("8. exited launch process fails honestly without relaunch", async () => {
    const { ops, state } = makeOps();
    state.statusProcesses = [{ launchId: "launch:test-1", pid: 9999, state: "failed", connected: false, failureReason: "plugin registration timed out" }];
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      maxTotalTimeoutMs: 3_000,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("FAILED");
    expect(result.message).toMatch(/plugin registration timed out/);
    expect(result.evidence.diagnostics.launchesAttempted).toBe(1);
    expect(state.launchCalls.length).toBe(1);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("9. MCP disconnect past startup is DISCONNECTED", async () => {
    const { ops, state } = makeOps();
    state.statusReachable = false;
    ops.getConnectedInstances = async () => ({ ok: false, infra: true, message: "unreachable", stdout: "", stderr: "unreachable" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      studioStartupTimeoutMs: 300,
      maxTotalTimeoutMs: 3_000,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("DISCONNECTED");
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("10. total deadline exceeded reports timeout category", async () => {
    const { ops, state } = makeOps();
    state.statusProcesses = [{ launchId: "L-slow", pid: 7777, state: "launching", connected: false }];
    ops.getConnectedInstances = async () => ({ ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      maxTotalTimeoutMs: 800,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("LOAD_TIMEOUT");
    expect(result.evidence.diagnostics.timeoutCategory).toBe("max-total");
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("11. no duplicate launch when same-place Studio is still loading", async () => {
    const { ops, state } = makeOps();
    state.currentInstances = [{ id: "i-same", placeName: "MyPlace", peers: { edit: "p1" } }];
    let structCalls = 0;
    ops.getProjectStructure = async () => {
      structCalls++;
      if (structCalls < 3) {
        return { ok: true, infra: false, message: "ok", data: { children: ["Workspace"] }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" };
    };
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, fastConfig);
    expect(result.ok).toBe(true);
    expect(state.launchCalls.length).toBe(0);
    expect(state.closeCalls.length).toBe(0);
    expect(result.evidence.diagnostics.launchesAttempted).toBe(0);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("12. owned in-flight launch is polled, not relaunched", async () => {
    const { ops, state } = makeOps();
    const placePath = await createTempPlace("MyPlace");
    state.statusProcesses = [{ launchId: "L-own", pid: 5555, state: "launching", connected: false, localPlaceFile: placePath }];
    let polls = 0;
    ops.getConnectedInstances = async () => {
      polls++;
      if (polls < 3) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });
    const result = await loadProject(ops, placePath, fastConfig);
    expect(result.ok).toBe(true);
    expect(state.launchCalls.length).toBe(0);
    expect(result.evidence.diagnostics.launchesAttempted).toBe(0);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("13. supervision timeout with live process keeps polling to ready", async () => {
    const { ops, state } = makeOps();
    // Server declared the launch failed, but the OS process is still alive
    // (observed live: plugin registers after the server deadline).
    state.statusProcesses = [{
      launchId: "launch:test-1",
      pid: 4242,
      state: "failed",
      connected: false,
      processRunning: true,
      failureReason: "Studio launched, but the MCP plugin did not connect before timeout.",
    }];
    let polls = 0;
    const baseInstances = ops.getConnectedInstances;
    void baseInstances;
    ops.getConnectedInstances = async () => {
      polls++;
      if (polls < 3) {
        return { ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" };
      }
      return { ok: true, infra: false, message: "ok", data: { instances: [{ id: "i1", placeName: "MyPlace", peers: { edit: "p1" } }], multiplayerGroups: [], phase: "running" }, stdout: "", stderr: "" };
    };
    ops.getProjectStructure = async () => ({ ok: true, infra: false, message: "ok", data: { root: "game", children: ["Workspace"] }, stdout: "", stderr: "" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      slowLoadThresholdMs: 100,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(true);
    expect(result.state).toBe("PLACE_READY");
    expect(result.evidence.advisoryMessages.some((m) => m.includes("supervision timed out"))).toBe(true);
    expect(state.launchCalls.length).toBe(1);
    expect(result.evidence.diagnostics.launchesAttempted).toBe(1);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });

  it("14. supervision timeout with no recovery ends in max-total LOAD_TIMEOUT", async () => {
    const { ops, state } = makeOps();
    state.statusProcesses = [{
      launchId: "launch:test-1",
      pid: 4242,
      state: "failed",
      connected: false,
      processRunning: true,
      failureReason: "Studio launched, but the MCP plugin did not connect before timeout.",
    }];
    ops.getConnectedInstances = async () => ({ ok: true, infra: false, message: "ok", data: { instances: [], multiplayerGroups: [], phase: "edit" }, stdout: "", stderr: "" });
    const placePath = await createTempPlace("MyPlace");
    const result = await loadProject(ops, placePath, {
      ...fastConfig,
      maxTotalTimeoutMs: 800,
      pollIntervalMs: 50,
    });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("LOAD_TIMEOUT");
    expect(result.evidence.diagnostics.timeoutCategory).toBe("max-total");
    expect(result.evidence.diagnostics.processAlive).toBe(true);
    expect(state.launchCalls.length).toBe(1);
    await fs.rm(path.dirname(placePath), { recursive: true, force: true });
  });
});

describe("StudioProjectLoaderOps adapter", () => {
  it("wraps StudioBridge correctly", () => {
    const b = bridge();
    const ops = createProjectLoaderOps(b);
    expect(typeof ops.manageInstance).toBe("function");
    expect(typeof ops.getConnectedInstances).toBe("function");
    expect(typeof ops.getProjectStructure).toBe("function");
    expect(typeof ops.getRuntimeLogs).toBe("function");
  });
});