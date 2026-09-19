/**
 * Roblox Studio bridge — MCP transport adapter.
 *
 * The Chrrxs/robloxstudio-mcp server exposes Studio over the MCP protocol
 * (Streamable HTTP, JSON-RPC 2.0, `text/event-stream` framing). The
 * factory's primary `StudioBridge` speaks the Chrrxs *direct-HTTP* surface
 * (`/health`, `/status`, `/mcp/<tool>`), which requires a separate bridge
 * process on port 3002. When the configured `STUDIO_BRIDGE_URL` points at an
 * MCP endpoint (path contains `/mcp`), `McpStudioBridge` is used instead so
 * the factory's tools and runtime QA reach the already-connected Studio
 * without a second sidecar.
 *
 * Discovery / failure semantics are identical to `StudioBridge`:
 *   - missing Studio / not connected  → infra (BLOCKED)
 *   - tool ran but game check failed  → ok=false, infra=false (FAIL)
 *
 * The auth token is read from the standard MCP auth file
 * (`~/.robloxstudio-mcp/auth-token`) at call time and is never logged or
 * emitted; without the file every call is BLOCKED infrastructure.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StudioBridge } from "./bridge.js";
import type {
  StudioBridgeConfig,
  StudioCallResult,
  StudioConnectionStatus,
  StudioInstanceRef,
} from "./bridge.js";
import {
  inspectToState,
  safeStartPlaytest,
  safeStopPlaytest,
  type PlaytestInspect,
  type PlaytestLifecycleOps,
  type PlaytestMode,
  type PlaytestStart,
  type PlaytestStop,
} from "./playtest-lifecycle.js";

export interface McpBridgeConfig extends StudioBridgeConfig {
  /** Path to the file containing the MCP auth token (file-reference pattern). */
  authFile: string;
}

/** True when a URL is an MCP Streamable-HTTP endpoint, not the direct bridge. */
export function isMcpUrl(url: string): boolean {
  const u = (url ?? "").trim().toLowerCase();
  return /\/mcp(\/)?$/.test(u) || u.includes("/mcp/");
}

export function resolveMcpBridgeConfig(env?: NodeJS.ProcessEnv): McpBridgeConfig | undefined {
  const e = env ?? process.env;
  const url = (e.STUDIO_BRIDGE_URL ?? "").trim();
  if (!url) return undefined;
  if (!isMcpUrl(url)) return undefined;
  return {
    baseUrl: url.replace(/\/+$/, ""),
    timeoutMs: Number(e.STUDIO_BRIDGE_TIMEOUT_MS ?? 60_000) || 60_000,
    instanceId: e.STUDIO_INSTANCE_ID || undefined,
    authFile: e.MCP_AUTH_FILE || path.join(os.homedir(), ".robloxstudio-mcp", "auth-token"),
  };
}

interface McpJsonRpcResult {
  result?: {
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

export function parseSseMessages(body: string): McpJsonRpcResult[] {
  const out: McpJsonRpcResult[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        const parsed = JSON.parse(line.slice(6)) as McpJsonRpcResult;
        out.push(parsed);
      } catch {
        // skip non-JSON event frames (comments, empty keepalives)
      }
    }
  }
  return out;
}

class McpClient {
  private initialized = false;
  private initError: string | undefined;

  constructor(private readonly config: McpBridgeConfig) {}

  private async readAuth(): Promise<string> {
    try {
      const token = (await fs.readFile(this.config.authFile, "utf8")).trim();
      if (!token) throw new Error("empty auth token");
      return token;
    } catch {
      throw new Error(`MCP auth token file not readable at ${this.config.authFile}`);
    }
  }

  private async post(body: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
    try {
      const auth = await this.readAuth();
      return await fetch(this.config.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "x-mcp-auth": auth,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async init(): Promise<{ ok: boolean; message: string }> {
    if (this.initialized) return { ok: true, message: "mcp initialized" };
    if (this.initError) return { ok: false, message: this.initError };
    try {
      const res = await this.post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ai-factory", version: "1.0.0" },
        },
      });
      if (!res.ok) {
        this.initError = `mcp initialize -> HTTP ${res.status}`;
        return { ok: false, message: this.initError };
      }
      const msgs = parseSseMessages(await res.text());
      const ok = msgs.some((m) => m.result && !m.error);
      this.initialized = ok;
      this.initError = ok ? undefined : "mcp initialize did not return a result";
      return ok ? { ok: true, message: "mcp initialized" } : { ok: false, message: this.initError ?? "mcp initialize did not return a result" };
    } catch (e) {
      this.initError = `mcp server unreachable: ${e instanceof Error ? e.message : e}`;
      return { ok: false, message: this.initError };
    }
  }

  /**
   * Invoke an MCP tool. Returns the structured result (content text parse),
   * `isError`, or an error message. Never throws for tool failures.
   */
  async call(tool: string, args: Record<string, unknown>): Promise<{
    ok: boolean;
    isError: boolean;
    text?: string;
    structured?: unknown;
    message: string;
  }> {
    const init = await this.init();
    if (!init.ok) return { ok: false, isError: true, message: init.message };
    let res: Response;
    try {
      res = await this.post({
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 1_000_000) + 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      });
    } catch (e) {
      return { ok: false, isError: true, message: `mcp transport error: ${e instanceof Error ? e.message : e}` };
    }
    const body = await res.text().catch(() => "");
    const msgs = parseSseMessages(body);
    const msg = [...msgs].reverse().find((m) => m.result || m.error);
    if (!msg) {
      return { ok: false, isError: true, message: `mcp ${tool} returned no result (HTTP ${res.status})` };
    }
    if (msg.error) {
      return { ok: false, isError: true, message: `mcp ${tool} error ${msg.error.code ?? ""}: ${msg.error.message ?? "unknown"}`.trim() };
    }
    const rc = msg.result;
    if (!rc) {
      return { ok: false, isError: true, message: `mcp ${tool} returned an empty result (HTTP ${res.status})` };
    }
    const content0 = rc.content?.[0];
    const text =
      typeof content0?.text === "string"
        ? content0.text
        : content0?.data
          ? `[image] ${content0.mimeType ?? ""} ${(content0.data as string).length} chars`
          : "";
    const structured = rc.structuredContent ?? parseJson(text);
    const isError = rc.isError === true;
    if (isError) {
      const errObj = (structured ?? parseJson(text)) as Record<string, unknown> | null;
      const errMsg =
        typeof errObj?.error === "string"
          ? (errObj.error as string)
          : typeof errObj?.message === "string"
            ? (errObj.message as string)
            : text || `mcp ${tool} failed`;
      return { ok: false, isError: true, message: errMsg, text, structured };
    }
    return { ok: true, isError: false, message: text || `mcp ${tool} ok`, text, structured };
  }
}

function parseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface McpPeerInfo {
  instanceId: string;
  serverInstanceId?: string;
  multiplayerGroupId?: string;
}

export class McpStudioBridge {
  private readonly client: McpClient;
  readonly config: McpBridgeConfig;
  private peerInfo: McpPeerInfo | undefined;

  constructor(config?: Partial<McpBridgeConfig>, env?: NodeJS.ProcessEnv) {
    const base = resolveMcpBridgeConfig(env);
    if (!base) {
      throw new Error("McpStudioBridge requires STUDIO_BRIDGE_URL to point at an /mcp endpoint");
    }
    this.config = {
      baseUrl: config?.baseUrl ?? base.baseUrl,
      timeoutMs: config?.timeoutMs ?? base.timeoutMs,
      instanceId: config?.instanceId ?? base.instanceId,
      authFile: config?.authFile ?? base.authFile,
    };
    this.client = new McpClient(this.config);
  }

  async checkBridge(): Promise<{ alive: boolean; message: string }> {
    const init = await this.client.init();
    return init.ok ? { alive: true, message: init.message } : { alive: false, message: init.message };
  }

  async discover(): Promise<StudioConnectionStatus> {
    const bridge = await this.checkBridge();
    if (!bridge.alive) {
      return { bridgeAlive: false, pluginConnected: false, instances: [], message: bridge.message };
    }
    const r = await this.client.call("get_connected_instances", {});
    if (!r.ok) {
      return { bridgeAlive: true, pluginConnected: false, instances: [], message: `mcp get_connected_instances failed: ${r.message}` };
    }
    const sc = (r.structured ?? {}) as {
      instances?: Array<{ id?: string; placeName?: string; mode?: string }>;
      multiplayerGroups?: Array<{ id?: string; instances?: Record<string, string> }>;
    };
    const instances: StudioInstanceRef[] = (sc.instances ?? [])
      .map((i) => ({ id: i.id ?? "", placeName: i.placeName, mode: i.mode }))
      .filter((i) => i.id.length > 0);
    const groups = sc.multiplayerGroups ?? [];
    const multiplayerGroupId = groups[0]?.id;
    const serverInstanceId = groups
      .flatMap((g) => Object.keys(g.instances ?? {}))
      .find((id) => /-server$/.test(id));
    if (instances.length > 0) {
      this.peerInfo = {
        instanceId: this.config.instanceId ?? instances[0].id,
        serverInstanceId: serverInstanceId ?? this.peerInfo?.serverInstanceId,
        multiplayerGroupId: multiplayerGroupId ?? this.peerInfo?.multiplayerGroupId,
      };
    }
    const connected = instances.length > 0;
    return {
      bridgeAlive: true,
      pluginConnected: connected,
      instances,
      message: connected
        ? `studio connected via MCP (${instances.length} instance(s))${serverInstanceId ? `, server peer ${serverInstanceId}` : ""}`
        : "MCP reachable but no Studio instance connected",
    };
  }

  async isStudioConnected(): Promise<boolean> {
    return (await this.discover()).pluginConnected;
  }

  /** Resolve the running server peer (for server-side runtime assertions). */
  async serverPeer(): Promise<string | undefined> {
    if (this.peerInfo?.serverInstanceId) return this.peerInfo.serverInstanceId;
    await this.discover();
    return this.peerInfo?.serverInstanceId;
  }

  async callTool(toolName: string, params: Record<string, unknown> = {}): Promise<StudioCallResult> {
    const fn = TOOL_MAP[toolName];
    if (!fn) {
      return this.infra(`roblox_toolchain: tool "${toolName}" is not exposed by the MCP bridge (no 1:1 mapping).`);
    }
    const init = await this.client.init();
    if (!init.ok) {
      return this.infra(`roblox_toolchain: ${init.message}`);
    }
    const res = await fn(this, params);
    return res.result;
  }

  // ── internal helpers ──────────────────────────────────────────────

  private infra(message: string): StudioCallResult {
    return { ok: false, infra: true, message, stdout: "", stderr: message };
  }

  async defaultInstance(): Promise<string | undefined> {
    await this.discover();
    return this.peerInfo?.instanceId;
  }

  async callInternal(tool: string, args: Record<string, unknown>): Promise<{
    ok: boolean;
    isError: boolean;
    text?: string;
    structured?: unknown;
    message: string;
  }> {
    return this.client.call(tool, args);
  }
}

type ToolHandler = (
  bridge: McpStudioBridge,
  params: Record<string, unknown>
) => Promise<{ result: StudioCallResult; infra?: boolean; ok?: boolean }>;

function handled(result: StudioCallResult): { result: StudioCallResult; ok: boolean } {
  return { result, ok: result.ok };
}

function infraResult(message: string): { result: StudioCallResult; infra: true; ok: false } {
  return { result: { ok: false, infra: true, message, stdout: "", stderr: message }, infra: true, ok: false };
}

function toCallResult(
  message: string,
  opts: { text?: string; data?: unknown; failInfra?: boolean; failText?: string } = {}
): StudioCallResult {
  if (opts.failText) {
    if (opts.failInfra) {
      return { ok: false, infra: true, message: `roblox_toolchain: ${opts.failText}`, stdout: opts.text ?? "", stderr: opts.failText };
    }
    return { ok: false, infra: false, message: opts.failText, stdout: opts.text ?? "", stderr: opts.failText };
  }
  return { ok: true, infra: false, message, stdout: opts.text ?? JSON.stringify(opts.data) ?? message, stderr: "", data: opts.data };
}

const TOOL_MAP: Record<string, ToolHandler> = {
  // ── inspection ─────────────────────────────────────────────────
  get_datamodel: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("get_project_structure", {
      path: (params.path as string) ?? "game",
      maxDepth: (params.depth as number) ?? 2,
      ...(id ? { instance_id: id } : {}),
    });
    if (!r.ok) return infraResult(`roblox_toolchain: get_datamodel failed: ${r.message}`);
    return handled(toCallResult("datamodel read", { text: r.text, data: r.structured }));
  },

  // ── Luau execution ─────────────────────────────────────────────
  eval_luau: async (b, params) => {
    const peer = (params.peer as string) ?? "server";
    const source = (params.source as string) ?? "";
    const id = await b.defaultInstance();
    const serverId = await b.serverPeer();
    if (peer === "server") {
      const r = await b.callInternal("eval_server_runtime", {
        code: source,
        ...(serverId || id ? { instance_id: serverId ?? id } : {}),
      });
      if (!r.ok) return infraResult(`roblox_toolchain: server eval failed: ${r.message}`);
      const structured = r.structured as { result?: string } | undefined;
      const value = (r.text ?? JSON.stringify(structured) ?? "").slice(0, 4000);
      return handled(toCallResult("server eval ok", { text: typeof structured?.result === "string" ? structured.result : value, data: structured }));
    }
    if (peer === "client") {
      const target = (params.clientId as string) || "client-1";
      const r = await b.callInternal("eval_client_runtime", {
        code: source,
        target,
        ...(id ? { instance_id: id } : {}),
      });
      if (!r.ok) return infraResult(`roblox_toolchain: client eval failed: ${r.message}`);
      const structured = r.structured as { result?: string } | undefined;
      return handled(toCallResult("client eval ok", { text: typeof structured?.result === "string" ? structured.result : r.text, data: structured }));
    }
    const r = await b.callInternal("execute_luau", { code: source, ...(id ? { instance_id: id } : {}) });
    if (!r.ok) return infraResult(`roblox_toolchain: luau execute failed: ${r.message}`);
    return handled(toCallResult("luau executed", { text: r.text, data: r.structured }));
  },

  // ── output ─────────────────────────────────────────────────────
  read_output: async (b, params) => {
    const limit = Math.max(1, Math.min(500, Number(params.limit ?? 200)));
    const id = await b.defaultInstance();
    const serverId = await b.serverPeer();
    const r = await b.callInternal("get_runtime_logs", {
      tail: limit,
      ...(serverId || id ? { instance_id: serverId ?? id } : {}),
    });
    if (!r.ok) return infraResult(`roblox_toolchain: read output failed: ${r.message}`);
    const sc = (r.structured ?? {}) as { entries?: Array<{ message?: string; level?: string }> };
    const lines = (sc.entries ?? []).map((en) => `[${en.level ?? "OUT"}] ${en.message ?? ""}`);
    return handled(toCallResult("output read", { text: lines.join("\n"), data: r.structured }));
  },

  // ── screenshot ─────────────────────────────────────────────────
  capture_screenshot: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("capture_screenshot", {
      format: (params.format as string) ?? "png",
      ...(id ? { instance_id: id } : {}),
    });
    if (!r.ok) {
      const infra = /minimized|not rendering|no frame|not connected|no instance|unreachable/i.test(r.message);
      return handled(toCallResult("screenshot failed", { text: r.text, failText: r.message, failInfra: infra }));
    }
    return handled(toCallResult("screenshot captured", { text: r.text, data: r.structured }));
  },

  // ── raw plugin tools (used by the playtest lifecycle engine) ─────
  get_connected_instances: async (b) => {
    const r = await b.callInternal("get_connected_instances", {});
    if (!r.ok) return infraResult(`roblox_toolchain: get_connected_instances failed: ${r.message}`);
    return handled(toCallResult("connected instances read", { text: r.text, data: r.structured }));
  },

  // ── raw project tools (used by the project loader readiness probe) ──
  get_project_structure: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("get_project_structure", {
      ...(params.path ? { path: String(params.path) } : {}),
      ...(params.maxDepth != null ? { maxDepth: Math.max(0, Math.min(6, Number(params.maxDepth))) } : {}),
      ...(id && !params.instance_id ? { instance_id: id } : {}),
      ...(params.instance_id ? { instance_id: String(params.instance_id) } : {}),
    });
    if (!r.ok) return handled(toCallResult("project structure failed", { text: r.text, failText: r.message, failInfra: /not connected|no instance|unreachable/i.test(r.message) }));
    return handled(toCallResult("project structure read", { text: r.text, data: r.structured }));
  },

  get_runtime_logs: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("get_runtime_logs", {
      ...(params.tail != null ? { tail: Math.max(1, Math.min(500, Number(params.tail))) } : {}),
      ...(id && !params.instance_id ? { instance_id: id } : {}),
      ...(params.instance_id ? { instance_id: String(params.instance_id) } : {}),
    });
    if (!r.ok) return infraResult(`roblox_toolchain: get_runtime_logs failed: ${r.message}`);
    return handled(toCallResult("runtime logs read", { text: r.text, data: r.structured }));
  },

  multiplayer_playtest: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("multiplayer_playtest", {
      ...(params.action ? { action: String(params.action) } : {}),
      ...(params.numPlayers != null ? { numPlayers: Math.max(1, Math.min(8, Number(params.numPlayers))) } : {}),
      ...(params.timeout != null ? { timeout: Math.max(10, Math.min(180, Number(params.timeout))) } : {}),
      ...(id ? { instance_id: id } : {}),
    });
    const action = String(params.action ?? "");
    // A refused *start* (wedged/transitioning Studio) is infrastructure;
    // a failed *end* is just an empty teardown result.
    if (!r.ok) {
      const isStop = action === "end" || action === "stop";
      if (!isStop) return infraResult(`roblox_toolchain: multiplayer_playtest failed: ${r.message}`);
      return handled(toCallResult("multiplayer_playtest failed", { text: r.text, failText: r.message, failInfra: false }));
    }
    return handled(toCallResult(`multiplayer_playtest ${action}`.trim(), { text: r.text, data: r.structured }));
  },

  solo_playtest: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("solo_playtest", {
      ...(params.action ? { action: String(params.action) } : {}),
      ...(params.mode ? { mode: String(params.mode) } : {}),
      ...(params.timeout != null ? { timeout: Math.max(10, Math.min(180, Number(params.timeout))) } : {}),
      ...(id ? { instance_id: id } : {}),
    });
    const action = String(params.action ?? "");
    if (!r.ok) {
      const isStop = action === "stop" || action === "end";
      if (!isStop) return infraResult(`roblox_toolchain: solo_playtest failed: ${r.message}`);
      return handled(toCallResult("solo_playtest failed", { text: r.text, failText: r.message, failInfra: false }));
    }
    return handled(toCallResult(`solo_playtest ${action}`.trim(), { text: r.text, data: r.structured }));
  },

  // ── studio instance management (project loading) ─────────────────
  manage_instance: async (b, params) => {
    const action = String(params.action ?? "");
    // Only close targets a specific instance. Launch/status must NOT inherit
    // a stale default instance_id — that would couple the new launch to an
    // unrelated Studio or confuse the managed-launch lifecycle.
    const id = action === "close" ? await b.defaultInstance() : undefined;
    const r = await b.callInternal("manage_instance", {
      ...(params.action ? { action: String(params.action) } : {}),
      ...(params.source ? { source: String(params.source) } : {}),
      ...(params.local_place_file ? { local_place_file: String(params.local_place_file) } : {}),
      ...(params.place_id != null ? { place_id: Number(params.place_id) } : {}),
      ...(params.place_version != null ? { place_version: Number(params.place_version) } : {}),
      ...(params.wait_for_connection != null ? { wait_for_connection: Boolean(params.wait_for_connection) } : {}),
      ...(params.timeout_ms != null ? { timeout_ms: Math.max(10_000, Math.min(600_000, Number(params.timeout_ms))) } : {}),
      ...(id && !params.instance_id ? { instance_id: id } : {}),
      ...(params.instance_id ? { instance_id: String(params.instance_id) } : {}),
      ...(params.launch_id ? { launch_id: String(params.launch_id) } : {}),
    });
    if (!r.ok) {
      const isClose = action === "close";
      if (!isClose) return infraResult(`roblox_toolchain: manage_instance failed: ${r.message}`);
      return handled(toCallResult("manage_instance failed", { text: r.text, failText: r.message, failInfra: false }));
    }
    return handled(toCallResult(`manage_instance ${action}`.trim(), { text: r.text, data: r.structured }));
  },

  // ── playtest lifecycle (safe start / safe stop via the state machine) ──
  start_playtest: async (b, params) => {
    const requestedMode: PlaytestMode =
      (params.mode as string) === "solo" || (params.mode as string) === "multiplayer"
        ? (params.mode as PlaytestMode)
        : "multiplayer";
    const numPlayers = Math.max(1, Math.min(8, Number(params.numPlayers ?? 1)));
    const res = await safeStartPlaytest(playtestOpsFor(b), {
      requestedMode,
      numPlayers,
      assertRuntimeReady: params.assertRuntimeReady !== false,
      role: "qa",
    });
    if (!res.ok) {
      return infraResult(res.message);
    }
    return handled(
      toCallResult(res.message, { data: { state: res.state, evidence: res.evidence, mode: res.evidence.actualMode } })
    );
  },

  stop_playtest: async (b) => {
    const res = await safeStopPlaytest(playtestOpsFor(b), { role: "qa" });
    if (!res.ok && res.state !== "DISCONNECTED") {
      return infraResult(res.message);
    }
    return handled(
      toCallResult(res.message, {
        data: { state: res.state, teardownConfirmed: !res.teardownUnconfirmed, evidence: res.evidence },
      })
    );
  },

  // ── instance / script edits ────────────────────────────────────
  set_properties: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("set_properties", {
      instancePath: params.path as string,
      properties: (params.properties ?? {}) as Record<string, unknown>,
      ...(id ? { instance_id: id } : {}),
    });
    if (!r.ok) return handled(toCallResult("properties failed", { text: r.text, failText: r.message, failInfra: /not connected|no instance/i.test(r.message) }));
    return handled(toCallResult("properties set", { text: r.text, data: r.structured }));
  },

  read_script: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("get_script_source", {
      instancePath: params.path as string,
      ...(id ? { instance_id: id } : {}),
    });
    if (!r.ok) return handled(toCallResult("script read failed", { text: r.text, failText: r.message, failInfra: /not connected|no instance|invalid/i.test(r.message) }));
    const sc = (r.structured ?? {}) as { source?: string };
    return handled(toCallResult("script read", { text: typeof sc.source === "string" ? sc.source : r.text, data: r.structured }));
  },

  get_properties: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("get_instance_properties", {
      instancePath: params.path as string,
      ...(id ? { instance_id: id } : {}),
    });
    if (!r.ok) return handled(toCallResult("properties read failed", { text: r.text, failText: r.message, failInfra: /not connected|no instance|invalid|does not exist/i.test(r.message) }));
    return handled(toCallResult("properties read", { text: r.text, data: r.structured }));
  },

  write_script: async (b, params) => {
    const id = await b.defaultInstance();
    const r = await b.callInternal("set_script_source", {
      instancePath: params.path as string,
      source: params.source as string,
      ...(id ? { instance_id: id } : {}),
    });
    if (!r.ok) return handled(toCallResult("script write failed", { text: r.text, failText: r.message, failInfra: /not connected|no instance/i.test(r.message) }));
    return handled(toCallResult("script written", { text: r.text, data: r.structured }));
  },
};

// Legacy factory alias for the output reader.
TOOL_MAP.get_output = TOOL_MAP.read_output;

/**
 * Adapter from any StudioBridgeClient (MCP or direct-HTTP) to the lifecycle
 * engine's ops surface. Raw plugin tool names (multiplayer_playtest,
 * solo_playtest, get_connected_instances) are resolved through the bridge's
 * callTool surface: TOOL_MAP for the MCP bridge, `/mcp/<tool>` passthrough
 * for the direct-HTTP bridge.
 */
export function createPlaytestLifecycleOps(bridge: StudioBridgeLike): PlaytestLifecycleOps {
  return {
    inspect: async () => {
      const r = await bridge.callTool("get_connected_instances", {});
      return parseInspectResult(r);
    },
    startMultiplayer: async (n) => {
      const r = await bridge.callTool("multiplayer_playtest", { action: "start", numPlayers: n ?? 1, timeout: 90 });
      return parseStartResult(r, "multiplayer");
    },
    startSolo: async () => {
      const r = await bridge.callTool("solo_playtest", { action: "start", mode: "play", timeout: 120 });
      return parseStartResult(r, "solo");
    },
    stopMultiplayer: async () => {
      const r = await bridge.callTool("multiplayer_playtest", { action: "end" });
      return parseStopResult(r);
    },
    stopSolo: async () => {
      const r = await bridge.callTool("solo_playtest", { action: "stop" });
      return parseStopResult(r);
    },
    execute: async (expression, peer) =>
      bridge.callTool("eval_luau", { source: `return (${expression})`, peer: peer ?? "server" }),
    readOutput: async () => bridge.callTool("get_output", { limit: 200 }),
    screenshot: async () => bridge.callTool("capture_screenshot", { format: "png" }),
  };
}

function playtestOpsFor(b: McpStudioBridge): PlaytestLifecycleOps {
  return createPlaytestLifecycleOps(b);
}

interface ConnectedInstancesShape {
  instances?: Array<{ id?: string; placeName?: string; mode?: string; editModeReady?: boolean; peers?: Record<string, string> }>;
  multiplayerGroups?: Array<{ id?: string; instances?: Record<string, string> }>;
  phase?: string;
  editModeReady?: boolean;
}

/**
 * Build a PlaytestInspect snapshot from a get_connected_instances result.
 * Runtime roles are derived from peer keys (edit / server / client-N) and
 * role-suffixed multiplayer group instance ids (instance:x-server → server).
 */
export function parseInspectResult(r: StudioCallResult): PlaytestInspect {
  const sc = (r.data ?? {}) as ConnectedInstancesShape;
  const instances = Array.isArray(sc.instances) ? sc.instances : [];
  const groups = Array.isArray(sc.multiplayerGroups) ? sc.multiplayerGroups : [];
  const roles: string[] = [];
  let editModeReady = typeof sc.editModeReady === "boolean" ? sc.editModeReady : false;
  const phase = sc.phase ?? "";
  let serverPeerId: string | undefined;
  const clientPeerIds: string[] = [];
  let multiplayerGroupId = groups[0]?.id;
  const connected = instances.length > 0;

  for (const g of groups) {
    const mapping = g.instances ?? {};
    for (const key of Object.keys(mapping)) {
      classifyRoleKey(key, roles, (id) => (serverPeerId ??= id), (id) => clientPeerIds.push(id));
    }
  }
  for (const inst of instances) {
    if (typeof inst.editModeReady === "boolean") editModeReady = inst.editModeReady;
    for (const [key, peer] of Object.entries(inst.peers ?? {})) {
      classifyRoleKey(key, roles, () => (serverPeerId ??= peer), (id) => clientPeerIds.push(id));
    }
  }

  const deduped = [...new Set(roles)];
  const state = inspectToState({
    state: "UNKNOWN",
    phase,
    connected,
    editModeReady,
    roles: deduped,
    serverPeerId,
    clientPeerIds,
    multiplayerGroupId,
    message: r.message,
  });
  return {
    state,
    phase,
    connected,
    editModeReady,
    roles: deduped,
    serverPeerId,
    clientPeerIds,
    multiplayerGroupId,
    message: r.message,
  };
}

function classifyRoleKey(
  key: string,
  roles: string[],
  onServer: (id: string) => void,
  onClient: (id: string) => void
): void {
  const lower = key.toLowerCase();
  if (/server/.test(lower)) {
    roles.push("server");
    onServer(key);
  } else if (/client/.test(lower)) {
    const m = lower.match(/client[-_ ]?(\d+)/);
    roles.push(m ? `client-${m[1]}` : "client");
    onClient(key);
  } else if (/edit/.test(lower)) {
    roles.push("edit");
  }
}

function parseStartResult(r: StudioCallResult, mode: PlaytestMode): PlaytestStart {
  const sc = (r.data ?? {}) as { error?: string; message?: string };
  if (r.ok) return { ok: true, message: r.message || `${mode} start ok`, mode, infra: false };
  return {
    ok: false,
    message: typeof sc.error === "string" ? sc.error : r.message,
    mode,
    infra: r.infra,
    errorCode: typeof sc.error === "string" ? sc.error : undefined,
  };
}

function parseStopResult(r: StudioCallResult): PlaytestStop {
  return { ok: r.ok, message: r.message || "stop ok", unconfirmed: !r.ok };
}

/** Pick the right bridge for the configured STUDIO_BRIDGE_URL. */
export function createStudioBridge(
  config?: { baseUrl?: string; timeoutMs?: number; instanceId?: string },
  env?: NodeJS.ProcessEnv
): StudioBridgeLike {
  const e = env ?? process.env;
  const url = (config?.baseUrl ?? e.STUDIO_BRIDGE_URL ?? "").trim();
  if (url && isMcpUrl(url)) {
    return new McpStudioBridge(config as Partial<McpBridgeConfig> | undefined, env);
  }
  return new StudioBridge(config, env);
}

// Minimal structural interface shared by both bridges.
export interface StudioBridgeLike {
  discover(): Promise<StudioConnectionStatus>;
  isStudioConnected(): Promise<boolean>;
  callTool(toolName: string, params?: Record<string, unknown>): Promise<StudioCallResult>;
}