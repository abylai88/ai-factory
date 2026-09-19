import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StudioBridge } from "../bridge.js";
import { McpStudioBridge, createStudioBridge, isMcpUrl, parseSseMessages, resolveMcpBridgeConfig } from "../mcp-bridge.js";

function sse(msg: unknown): string {
  return `event: message\ndata: ${JSON.stringify(msg)}\n\n`;
}

/** Minimal MCP Streamable-HTTP server that mimics the live Studio MCP. */
async function startFakeMcp(handlers: Record<string, (args: Record<string, unknown>) => unknown> = {}): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream", "access-control-allow-origin": "*" });
      let body: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> }; id?: number } = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      const m = body.method;
      const name = body.params?.name;
      if (m === "initialize") {
        res.end(sse({ jsonrpc: "2.0", id: body.id ?? 1, result: { protocolVersion: "2025-03-26", serverInfo: { name: "fake", version: "1" } } }));
        return;
      }
      if (m === "notifications/initialized") {
        res.end();
        return;
      }
      if (m === "tools/call") {
        const handler = handlers[name ?? ""];
        if (!handler) {
          res.end(sse({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `unknown tool ${name}` } }));
          return;
        }
        const out = handler(body.params?.arguments ?? {});
        res.end(sse({ jsonrpc: "2.0", id: body.id, result: out }));
        return;
      }
      res.end(sse({ jsonrpc: "2.0", id: body.id ?? 1, error: { code: -32601, message: `unknown method ${m}` } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  return { server, baseUrl: `http://127.0.0.1:${addr.port}/mcp` };
}

let tempDir: string | undefined;
let servers: Server[] = [];
async function makeAuthFile(): Promise<string> {
  tempDir ??= await fs.mkdtemp(path.join(os.tmpdir(), "mcp-bridge-test-"));
  const f = path.join(tempDir, "auth-token");
  await fs.writeFile(f, "test-token\n");
  return f;
}

async function envFor(baseUrl: string): Promise<NodeJS.ProcessEnv> {
  const authFile = await makeAuthFile();
  return { STUDIO_BRIDGE_URL: baseUrl, MCP_AUTH_FILE: authFile } as NodeJS.ProcessEnv;
}

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("parseSseMessages", () => {
  it("parses event/message frames into json", () => {
    const body = 'event: message\ndata: {"a":1}\n\nnot-data\ndata: {"b":2}\n\n';
    const msgs = parseSseMessages(body);
    expect(msgs).toEqual([{ a: 1 }, { b: 2 }]);
  });
  it("skips non-json frames", () => {
    expect(parseSseMessages("data: garbage\n\n")).toEqual([]);
  });
});

describe("isMcpUrl", () => {
  it("accepts /mcp endpoints and rejects plain HTTP bridge URLs", () => {
    expect(isMcpUrl("http://127.0.0.1:58741/mcp")).toBe(true);
    expect(isMcpUrl("http://127.0.0.1:58741/mcp/")).toBe(true);
    expect(isMcpUrl("http://127.0.0.1:3002")).toBe(false);
    expect(isMcpUrl("")).toBe(false);
  });
});

describe("resolveMcpBridgeConfig", () => {
  it("returns a config only for /mcp URLs", () => {
    expect(resolveMcpBridgeConfig({ STUDIO_BRIDGE_URL: "http://127.0.0.1:3002" })).toBeUndefined();
    const c = resolveMcpBridgeConfig({ STUDIO_BRIDGE_URL: "http://127.0.0.1:58741/mcp", MCP_AUTH_FILE: "/tmp/a" });
    expect(c?.baseUrl).toBe("http://127.0.0.1:58741/mcp");
    expect(c?.authFile).toBe("/tmp/a");
  });
});

describe("createStudioBridge", () => {
  it("returns McpStudioBridge for /mcp URLs and StudioBridge otherwise", () => {
    expect(createStudioBridge(undefined, { STUDIO_BRIDGE_URL: "http://127.0.0.1:58741/mcp" } as NodeJS.ProcessEnv)).toBeInstanceOf(McpStudioBridge);
    expect(createStudioBridge(undefined, { STUDIO_BRIDGE_URL: "http://127.0.0.1:3002" } as NodeJS.ProcessEnv)).toBeInstanceOf(StudioBridge);
    expect(createStudioBridge(undefined, { STUDIO_BRIDGE_URL: "http://127.0.0.1:58741/mcp" } as NodeJS.ProcessEnv)).toSatisfy(
      (b: McpStudioBridge) => b.discover && typeof b.discover === "function"
    );
  });
});

describe("McpStudioBridge", () => {
  it("blocks unknown tools as infrastructure without touching the network", async () => {
    const { server, baseUrl } = await startFakeMcp();
    servers.push(server);
    const bridge = new McpStudioBridge(undefined, await envFor(baseUrl));
    const r = await bridge.callTool("create_instance", { className: "Part" });
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(true);
    expect(r.message).toContain("create_instance");
  });

  it("maps eval_luau server peer onto eval_server_runtime structured result", async () => {
    const { server, baseUrl } = await startFakeMcp({
      eval_server_runtime: (args) => ({
        content: [{ type: "text", text: JSON.stringify({ ok: true, result: JSON.stringify({ players: 1 }) }) }],
        structuredContent: { ok: true, result: JSON.stringify({ players: 1 }), output: [] },
      }),
      get_connected_instances: () => ({
        content: [{ type: "text", text: "[]" }],
        structuredContent: {
          instances: [{ id: "instance:ud1", placeName: "Test.rbxlx", peers: { edit: "peer:1" } }],
          multiplayerGroups: [{ id: "g1", controllerInstanceId: "instance:ud1", instances: { "instance:srv-server": "peer:2" } }],
        },
      }),
      get_runtime_logs: () => ({
        content: [{ type: "text", text: "{}" }],
        structuredContent: { instanceId: "instance:srv", entries: [{ message: "[AI FACTORY] Roblox server online", level: "OUT" }], nextCursor: "" },
      }),
    });
    servers.push(server);
    const bridge = new McpStudioBridge(undefined, await envFor(baseUrl));
    const r = await bridge.callTool("eval_luau", { source: "return 1", peer: "server" });
    expect(r.ok).toBe(true);
    expect(r.infra).toBe(false);
    expect(r.stdout).toContain("players");
  });

  it("surfaces capture_screenshot minimized-window errors as infra BLOCKED", async () => {
    const { server, baseUrl } = await startFakeMcp({
      capture_screenshot: () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: "Studio window appears minimized or not rendering (no frame in 24508.3s)" }) }],
        structuredContent: { error: "Studio window appears minimized or not rendering (no frame in 24508.3s)" },
      }),
      get_connected_instances: () => ({
        content: [{ type: "text", text: "[]" }],
        structuredContent: { instances: [{ id: "instance:ud1" }], multiplayerGroups: [] },
      }),
    });
    servers.push(server);
    const bridge = new McpStudioBridge(undefined, await envFor(baseUrl));
    const r = await bridge.callTool("capture_screenshot", {});
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(true);
    expect(r.message).toMatch(/minimized|not rendering/i);
  });

  it("treats a start that lacks any server peer as BLOCKED infrastructure", async () => {
    const { server, baseUrl } = await startFakeMcp({
      multiplayer_playtest: () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "multiplayer_start_not_detected", message: "no peers" }) }],
        structuredContent: { success: false, error: "multiplayer_start_not_detected", message: "no peers" },
      }),
      solo_playtest: () => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ success: false, message: "wedged" }) }],
        structuredContent: { success: false, message: "wedged" },
      }),
      get_connected_instances: () => ({
        content: [{ type: "text", text: "[]" }],
        structuredContent: { instances: [{ id: "instance:ud1", peers: { edit: "peer:edit" } }], multiplayerGroups: [] },
      }),
    });
    servers.push(server);
    const bridge = new McpStudioBridge(undefined, await envFor(baseUrl));
    const r = await bridge.callTool("start_playtest", {});
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(true);
    expect(r.message).toMatch(/could not start (multiplayer )?playtest|multiplayer_start_not_detected/);
  });
});