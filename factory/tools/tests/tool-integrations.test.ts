import { describe, it, expect } from "vitest";
import { emitToolEvent, onToolEvent, recentToolEvents, clearToolEvents } from "../observability.js";
import {
  checkProjectScope,
  checkInstanceName,
  checkClassName,
  checkLuauPath,
  checkNoShellMeta,
  mayInvokeDangerous,
} from "../safety.js";
import { checkMcpHealth, renderMcpConfigSnippet, describeToolConsumption, defaultMcpServers } from "../mcp-config.js";
import { checkBlenderAvailable } from "../../blender/bridge.js";

// ─── observability ────────────────────────────────────────────────

describe("tool observability", () => {
  it("emits and retains lifecycle events", () => {
    clearToolEvents();
    const seen: string[] = [];
    const off = onToolEvent((e) => seen.push(e.type));
    emitToolEvent({ type: "tool.started", toolId: "studio.play", role: "qa" });
    emitToolEvent({ type: "playtest.started", role: "qa" });
    emitToolEvent({ type: "screenshot.created", toolId: "screenshot.capture" });
    emitToolEvent({ type: "tool.completed", toolId: "studio.play", role: "qa" });
    off();
    expect(seen).toEqual(["tool.started", "playtest.started", "screenshot.created", "tool.completed"]);
    expect(recentToolEvents(10).length).toBe(4);
    clearToolEvents();
    expect(recentToolEvents().length).toBe(0);
  });

  it("listener exceptions never break emission", () => {
    clearToolEvents();
    const off = onToolEvent(() => {
      throw new Error("listener boom");
    });
    expect(() => emitToolEvent({ type: "tool.started", toolId: "x" })).not.toThrow();
    off();
    clearToolEvents();
  });
});

// ─── safety ───────────────────────────────────────────────────────

describe("tool safety", () => {
  it("rejects absolute paths", () => {
    expect(checkProjectScope("/p", "/etc/passwd").ok).toBe(false);
  });

  it("rejects parent escapes", () => {
    expect(checkProjectScope("/p", "../outside").ok).toBe(false);
    expect(checkProjectScope("/p", "src/../../evil").ok).toBe(false);
  });

  it("rejects protected factory paths", () => {
    expect(checkProjectScope("/p", "factory/tools/x.ts").ok).toBe(false);
    expect(checkProjectScope("/p", "agents/opencode/x.md").ok).toBe(false);
  });

  it("accepts normal project paths", () => {
    expect(checkProjectScope("/p", "src/ServerScriptService/main.server.lua").ok).toBe(true);
  });

  it("validates instance names", () => {
    expect(checkInstanceName("BasePlate").ok).toBe(true);
    expect(checkInstanceName("a/b").ok).toBe(false);
    expect(checkInstanceName("").ok).toBe(false);
  });

  it("allowlist gates class names", () => {
    expect(checkClassName("Part").ok).toBe(true);
    expect(checkClassName("SpawnLocation").ok).toBe(true);
    expect(checkClassName("EvilExecutor").ok).toBe(false);
  });

  it("luau paths must live under src/", () => {
    expect(checkLuauPath("src/ServerScriptService/a.server.lua").ok).toBe(true);
    expect(checkLuauPath("elsewhere/a.lua").ok).toBe(false);
    expect(checkLuauPath("src/a.txt").ok).toBe(false);
  });

  it("shell metacharacters rejected", () => {
    expect(checkNoShellMeta("a; rm -rf /", "field").ok).toBe(false);
    expect(checkNoShellMeta("Position", "field").ok).toBe(true);
  });

  it("only builder-class roles may invoke dangerous tools", () => {
    expect(mayInvokeDangerous("programmer")).toBe(true);
    expect(mayInvokeDangerous("visual")).toBe(true);
    expect(mayInvokeDangerous("researcher")).toBe(false);
    expect(mayInvokeDangerous("reviewer")).toBe(false);
    expect(mayInvokeDangerous("director")).toBe(false);
  });
});

// ─── 18. MCP health + config ──────────────────────────────────────

describe("mcp integration", () => {
  it("default servers include roblox-studio (primary) + blender (optional)", () => {
    const servers = defaultMcpServers();
    expect(servers.map((s) => s.name)).toEqual(["roblox-studio", "blender"]);
    expect(servers.every((s) => s.required === false)).toBe(true);
  });

  it("renders a parseable opencode.json snippet without secrets", () => {
    const snippet = renderMcpConfigSnippet();
    const parsed = JSON.parse(snippet) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(parsed.mcpServers["roblox-studio"].command).toBe("npx");
    expect(parsed.mcpServers["blender"].command).toBe("uvx");
    expect(snippet).not.toMatch(/token|secret|password|key/i);
  });

  it("health check reports optional servers honestly", async () => {
    const health = await checkMcpHealth();
    expect(health.length).toBe(2);
    expect(health.every((h) => h.optional)).toBe(true);
    expect(health.find((h) => h.name === "roblox-studio")?.ok).toBe(false);
  });

  it("describes agent → registry → execution flow", () => {
    expect(describeToolConsumption()).toMatch(/ToolRegistry\.execute/);
  });

  it("blender unavailable degrades to optional (never fatal)", async () => {
    const r = await checkBlenderAvailable(
      { baseUrl: "http://127.0.0.1:1" },
      { ...process.env, BLENDER_MCP_URL: "http://127.0.0.1:1" }
    );
    expect(r.available).toBe(false);
    expect(r.message).toMatch(/optional|not available/i);
  });
});
