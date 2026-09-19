/**
 * Roblox Studio bridge client.
 *
 * PRIMARY integration: Chrrxs/robloxstudio-mcp (MIT) compatible HTTP bridge.
 * Architecture (upstream): MCP server (Node/TS) + HTTP bridge on
 * localhost:3002 + Studio plugin (Luau) that long-polls /poll and posts
 * /response. This client speaks the bridge's direct-HTTP tool surface:
 *
 *   GET  /health          — bridge process alive
 *   GET  /status          — plugin connection state + connected instances
 *   POST /mcp/<toolName>  — direct tool invocation { instance_id?, ...params }
 *
 * When no bridge/Studio is reachable every operation returns BLOCKED
 * (TOOLCHAIN / INFRASTRUCTURE FAILURE) — never a code FAIL. This is the
 * load-bearing distinction: "Studio not connected" must not look like
 * "game code is broken".
 *
 * OPTIONAL FALLBACK / REFERENCE (not executed, documented in
 * docs/tool-architecture.md): official Roblox studio-rust-mcp-server /
 * creator-docs MCP surface.
 */

export interface StudioBridgeConfig {
  baseUrl: string;
  timeoutMs: number;
  instanceId?: string;
}

export interface StudioInstanceRef {
  id: string;
  placeName?: string;
  mode?: string;
}

export interface StudioConnectionStatus {
  bridgeAlive: boolean;
  pluginConnected: boolean;
  instances: StudioInstanceRef[];
  message: string;
}

export interface StudioCallResult {
  ok: boolean;
  /** True when the failure is infrastructure (bridge/plugin missing). */
  infra: boolean;
  message: string;
  data?: unknown;
  stdout: string;
  stderr: string;
}

/** Structural contract every bridge (HTTP or MCP) must satisfy. */
export interface StudioBridgeClient {
  discover(): Promise<StudioConnectionStatus>;
  isStudioConnected(): Promise<boolean>;
  callTool(toolName: string, params?: Record<string, unknown>): Promise<StudioCallResult>;
}

export function resolveStudioBridgeConfig(env?: NodeJS.ProcessEnv): StudioBridgeConfig {
  const e = env ?? process.env;
  const explicit = (e.STUDIO_BRIDGE_URL ?? "").trim();
  if (explicit) {
    return { baseUrl: explicit.replace(/\/$/, ""), timeoutMs: Number(e.STUDIO_BRIDGE_TIMEOUT_MS ?? 30_000) || 30_000, instanceId: e.STUDIO_INSTANCE_ID || undefined };
  }
  const port = (e.STUDIO_BRIDGE_PORT ?? "3002").trim() || "3002";
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    timeoutMs: Number(e.STUDIO_BRIDGE_TIMEOUT_MS ?? 30_000) || 30_000,
    instanceId: e.STUDIO_INSTANCE_ID || undefined,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function infraResult(message: string): StudioCallResult {
  return { ok: false, infra: true, message, stdout: "", stderr: message };
}

export class StudioBridge implements StudioBridgeClient {
  readonly config: StudioBridgeConfig;

  constructor(config?: Partial<StudioBridgeConfig>, env?: NodeJS.ProcessEnv) {
    const base = resolveStudioBridgeConfig(env);
    this.config = {
      baseUrl: config?.baseUrl ?? base.baseUrl,
      timeoutMs: config?.timeoutMs ?? base.timeoutMs,
      instanceId: config?.instanceId ?? base.instanceId,
    };
  }

  /** Bridge process alive? (not Studio — just the MCP/HTTP sidecar). */
  async checkBridge(): Promise<{ alive: boolean; message: string }> {
    try {
      const res = await fetchWithTimeout(`${this.config.baseUrl}/health`, { method: "GET" }, Math.min(5000, this.config.timeoutMs));
      if (!res.ok) return { alive: false, message: `bridge /health -> HTTP ${res.status}` };
      return { alive: true, message: "bridge alive" };
    } catch (e) {
      return { alive: false, message: `bridge unreachable at ${this.config.baseUrl}: ${e instanceof Error ? e.message : e}` };
    }
  }

  /**
   * Full discovery: bridge alive + plugin connected + instance list.
   * Missing Studio => pluginConnected=false (callers map to BLOCKED).
   */
  async discover(): Promise<StudioConnectionStatus> {
    const bridge = await this.checkBridge();
    if (!bridge.alive) {
      return { bridgeAlive: false, pluginConnected: false, instances: [], message: bridge.message };
    }
    try {
      const res = await fetchWithTimeout(`${this.config.baseUrl}/status`, { method: "GET" }, Math.min(8000, this.config.timeoutMs));
      if (!res.ok) {
        return { bridgeAlive: true, pluginConnected: false, instances: [], message: `bridge alive but /status -> HTTP ${res.status}` };
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const instances = normalizeInstances(body);
      const connected = instances.length > 0 && pluginFlag(body) !== false;
      return {
        bridgeAlive: true,
        pluginConnected: connected,
        instances,
        message: connected
          ? `studio connected (${instances.length} instance(s))`
          : "bridge alive but no Studio plugin connected — open Studio with the MCP plugin and an open place",
      };
    } catch (e) {
      return {
        bridgeAlive: true,
        pluginConnected: false,
        instances: [],
        message: `bridge alive but /status failed: ${e instanceof Error ? e.message : e}`,
      };
    }
  }

  async isStudioConnected(): Promise<boolean> {
    return (await this.discover()).pluginConnected;
  }

  /**
   * Invoke a bridge tool by name. Unknown bridge / missing plugin =>
   * infra=true (BLOCKED). A tool that ran but reported a game assertion
   * failure comes back ok=false, infra=false (FAIL).
   */
  async callTool(toolName: string, params: Record<string, unknown> = {}): Promise<StudioCallResult> {
    if (!toolName || /[;&|`$<>\n\r]/.test(toolName) || toolName.includes("..") || toolName.includes("/")) {
      return { ok: false, infra: false, message: `invalid tool name: ${toolName}`, stdout: "", stderr: `invalid tool name: ${toolName}` };
    }
    const payload: Record<string, unknown> = { ...params };
    if (this.config.instanceId && payload.instance_id == null) {
      payload.instance_id = this.config.instanceId;
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${this.config.baseUrl}/mcp/${encodeURIComponent(toolName)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
        this.config.timeoutMs
      );
    } catch (e) {
      return infraResult(
        `roblox_toolchain: studio bridge unreachable at ${this.config.baseUrl} (is the MCP server + Studio plugin running?): ${e instanceof Error ? e.message : e}`
      );
    }
    const text = await res.text().catch(() => "");
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = { raw: text };
    }
    if (res.status === 404) {
      return infraResult(`roblox_toolchain: bridge has no tool "${toolName}" (HTTP 404). Check MCP server version.`);
    }
    if (res.status >= 500) {
      return infraResult(`roblox_toolchain: bridge error for "${toolName}" (HTTP ${res.status}): ${text.slice(0, 500)}`);
    }
    // Upstream convention: { ok:true, data } or { error } shapes vary by
    // tool; treat explicit connection errors as infra.
    const asText = `${text} ${JSON.stringify(body)}`;
    if (/not connected|no (connected )?instances?|no plugin|connection refused|plugin (not|never) connected/i.test(asText) && res.status !== 200) {
      return infraResult(`roblox_toolchain: Studio not connected for "${toolName}": ${text.slice(0, 500)}`);
    }
    if (!res.ok) {
      const msg = (body.error as string) ?? text.slice(0, 1000) ?? `HTTP ${res.status}`;
      if (/not connected|no instance/i.test(String(msg))) return infraResult(`roblox_toolchain: ${msg}`);
      return { ok: false, infra: false, message: String(msg).slice(0, 2000), data: body, stdout: text.slice(0, 2000), stderr: String(msg).slice(0, 2000) };
    }
    if (typeof body.ok === "boolean" && body.ok === false) {
      const msg = String((body.error as string) ?? (body.message as string) ?? "tool reported failure").slice(0, 2000);
      if (/not connected|no instance/i.test(msg)) return infraResult(`roblox_toolchain: ${msg}`);
      return { ok: false, infra: false, message: msg, data: body, stdout: text.slice(0, 2000), stderr: msg };
    }
    return {
      ok: true,
      infra: false,
      message: String((body.message as string) ?? "ok"),
      data: body,
      stdout: text.slice(0, 4000),
      stderr: "",
    };
  }
}

function normalizeInstances(body: Record<string, unknown>): StudioInstanceRef[] {
  const raw =
    (body.instances as unknown[]) ??
    (body.connected_instances as unknown[]) ??
    (body.places as unknown[]) ??
    [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (typeof r === "string") return { id: r };
      if (r && typeof r === "object") {
        const o = r as Record<string, unknown>;
        const id = String(o.id ?? o.instance_id ?? o.placeId ?? "");
        if (!id) return null;
        return {
          id,
          placeName: typeof o.placeName === "string" ? o.placeName : typeof o.name === "string" ? o.name : undefined,
          mode: typeof o.mode === "string" ? o.mode : undefined,
        } as StudioInstanceRef;
      }
      return null;
    })
    .filter((x): x is StudioInstanceRef => x !== null);
}

function pluginFlag(body: Record<string, unknown>): boolean | null {
  for (const k of ["plugin_connected", "pluginConnected", "connected"]) {
    if (typeof body[k] === "boolean") return body[k] as boolean;
  }
  return null;
}
