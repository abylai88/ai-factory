import type { StudioBridgeClient, StudioCallResult } from "./bridge.js";
import type { ToolDefinition } from "../tools/types.js";
import { checkClassName, checkInstanceName, checkNoShellMeta } from "../tools/safety.js";

/**
 * High-level Studio tool surface.
 *
 * Every function maps to one agent-visible tool id and returns a
 * StudioCallResult with honest infra-vs-fail classification. Validation
 * happens BEFORE any bridge call so invalid arguments are FAIL (caller
 * error), while unreachable Studio is infra (BLOCKED at the registry layer).
 *
 * Bridge tool-name mapping follows the Chrrxs/robloxstudio-mcp surface
 * (get_connected_instances, eval_luau, start_playtest, stop_playtest,
 * get_output, capture_screenshot, get_datamodel, create_instance, ...).
 * The bridge tolerates naming drift: callers pass the canonical name and
 * the bridge returns infra BLOCKED on HTTP 404 so version skew is visible
 * instead of silently faked.
 */

export const STUDIO_TOOL_DEFS: ToolDefinition[] = [
  { id: "studio.inspect", name: "Inspect DataModel/instance", description: "Read DataModel tree or instance properties (read-only).", capability: "inspect_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer", "builder", "visual", "ui", "qa", "tester", "researcher", "director", "designer", "gameplay", "architect", "monetization", "content", "reviewer"], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
  { id: "studio.create", name: "Create instance", description: "Create a Roblox instance under a parent path.", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual", "ui", "programmer", "builder", "content"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.modify", name: "Modify instance", description: "Set properties on an existing instance.", capability: "modify_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual", "ui", "programmer", "builder"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.delete", name: "Delete/clone/move instance", description: "Delete, clone, or move an instance. Destructive.", capability: "delete_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual", "programmer"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "script.read", name: "Read script", description: "Read a script's source from the live DataModel.", capability: "script_read", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer", "builder", "gameplay", "architect", "content"], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
  { id: "script.edit", name: "Edit script", description: "Write a script's source in the live DataModel.", capability: "script_edit", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer", "builder", "content"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "luau.execute", name: "Execute Luau", description: "Execute Luau in the live game VM (server or client peer).", capability: "execute_luau", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.play", name: "Start playtest", description: "Start a Studio playtest session.", capability: "playtest", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer", "visual", "ui", "qa", "tester", "gameplay"], timeoutMs: 60_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.stop", name: "Stop playtest", description: "Stop the running playtest session.", capability: "stop_playtest", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer", "qa", "tester"], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: true, requiresStudio: true },
  { id: "studio.output", name: "Read runtime output", description: "Read Studio output/log lines since playtest start.", capability: "read_output", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["programmer", "qa", "tester", "director", "reviewer"], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
  { id: "screenshot.capture", name: "Capture screenshot", description: "Capture a viewport/screenshot artifact from Studio.", capability: "screenshot", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual", "ui", "qa", "tester", "director", "designer", "reviewer"], timeoutMs: 60_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
  { id: "studio.terrain", name: "Edit terrain", description: "Procedural terrain edits via Studio.", capability: "terrain", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual"], timeoutMs: 60_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.lighting", name: "Edit lighting", description: "Lighting/atmosphere/post-effect edits.", capability: "lighting", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.material", name: "Edit material", description: "Material/color edits on instances.", capability: "material", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.ui.create", name: "Create UI", description: "Create ScreenGui/UI elements.", capability: "create_ui", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["ui", "visual"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.ui.modify", name: "Modify UI", description: "Modify ScreenGui/UI element properties.", capability: "modify_ui", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["ui"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "studio.ui.inspect", name: "Inspect UI", description: "Read UI tree/properties (read-only).", capability: "inspect_ui", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["ui", "reviewer", "qa", "tester"], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
];

function bad(message: string): StudioCallResult {
  return { ok: false, infra: false, message, stdout: "", stderr: message };
}

function checkPath(p: unknown): string | null {
  if (typeof p !== "string" || p.length === 0 || p.length > 500) return "instance path must be a non-empty string (<=500 chars)";
  if (p.includes("..") || /[;&|`$<>\n\r]/.test(p)) return `invalid instance path: ${p}`;
  return null;
}

export async function inspectInstance(
  bridge: StudioBridgeClient,
  args: { path?: string; depth?: number }
): Promise<StudioCallResult> {
  const pathErr = args.path != null ? checkPath(args.path) : null;
  if (pathErr) return bad(pathErr);
  if (args.depth != null && (!Number.isInteger(args.depth) || args.depth < 0 || args.depth > 6)) {
    return bad("depth must be an integer 0..6");
  }
  return bridge.callTool("get_datamodel", {
    path: args.path ?? "game",
    depth: args.depth ?? 2,
  });
}

export async function createInstance(
  bridge: StudioBridgeClient,
  args: { className: string; name: string; parent: string; properties?: Record<string, unknown> }
): Promise<StudioCallResult> {
  const cc = checkClassName(args.className);
  if (!cc.ok) return bad(cc.reason!);
  const nc = checkInstanceName(args.name);
  if (!nc.ok) return bad(nc.reason!);
  const pc = checkPath(args.parent);
  if (pc) return bad(pc);
  if (args.properties && typeof args.properties !== "object") return bad("properties must be an object");
  return bridge.callTool("create_instance", {
    class_name: args.className,
    name: args.name,
    parent: args.parent,
    properties: args.properties ?? {},
  });
}

export async function modifyInstance(
  bridge: StudioBridgeClient,
  args: { path: string; properties: Record<string, unknown> }
): Promise<StudioCallResult> {
  const pc = checkPath(args.path);
  if (pc) return bad(pc);
  if (!args.properties || typeof args.properties !== "object" || Array.isArray(args.properties)) {
    return bad("properties must be a non-empty object");
  }
  if (Object.keys(args.properties).length === 0) return bad("properties must be a non-empty object");
  if (Object.keys(args.properties).length > 25) return bad("too many properties (max 25 per call)");
  for (const k of Object.keys(args.properties)) {
    const m = checkNoShellMeta(k, "property name");
    if (!m.ok) return bad(m.reason!);
  }
  return bridge.callTool("set_properties", { path: args.path, properties: args.properties });
}

export async function deleteCloneMove(
  bridge: StudioBridgeClient,
  args: { op: "delete" | "clone" | "move"; path: string; newParent?: string }
): Promise<StudioCallResult> {
  const pc = checkPath(args.path);
  if (pc) return bad(pc);
  if (!["delete", "clone", "move"].includes(args.op)) return bad(`unknown op: ${args.op}`);
  if ((args.op === "clone" || args.op === "move") && !args.newParent) return bad(`${args.op} requires newParent`);
  if (args.newParent) {
    const np = checkPath(args.newParent);
    if (np) return bad(np);
  }
  return bridge.callTool(args.op === "delete" ? "delete_instance" : args.op === "clone" ? "clone_instance" : "move_instance", {
    path: args.path,
    ...(args.newParent ? { new_parent: args.newParent } : {}),
  });
}

export async function readScript(
  bridge: StudioBridgeClient,
  args: { path: string }
): Promise<StudioCallResult> {
  const pc = checkPath(args.path);
  if (pc) return bad(pc);
  return bridge.callTool("read_script", { path: args.path });
}

export async function editScript(
  bridge: StudioBridgeClient,
  args: { path: string; source: string }
): Promise<StudioCallResult> {
  const pc = checkPath(args.path);
  if (pc) return bad(pc);
  if (typeof args.source !== "string" || args.source.length === 0) return bad("source must be non-empty");
  if (args.source.length > 200_000) return bad("source too large (max 200k chars per call)");
  return bridge.callTool("write_script", { path: args.path, source: args.source });
}

export async function executeLuau(
  bridge: StudioBridgeClient,
  args: { source: string; peer?: "server" | "client"; clientId?: string }
): Promise<StudioCallResult> {
  if (typeof args.source !== "string" || args.source.length === 0) return bad("source must be non-empty");
  if (args.source.length > 50_000) return bad("source too large (max 50k chars per eval)");
  if (args.peer && !["server", "client"].includes(args.peer)) return bad(`unknown peer: ${args.peer}`);
  return bridge.callTool("eval_luau", {
    source: args.source,
    peer: args.peer ?? "server",
    ...(args.clientId ? { client_id: args.clientId } : {}),
  });
}

export async function startPlay(bridge: StudioBridgeClient): Promise<StudioCallResult> {
  return bridge.callTool("start_playtest", {});
}

export async function stopPlay(bridge: StudioBridgeClient): Promise<StudioCallResult> {
  return bridge.callTool("stop_playtest", {});
}

export async function readOutput(
  bridge: StudioBridgeClient,
  args: { limit?: number } = {}
): Promise<StudioCallResult> {
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit <= 0 || args.limit > 500)) {
    return bad("limit must be an integer 1..500");
  }
  return bridge.callTool("get_output", { limit: args.limit ?? 200 });
}

export async function captureScreenshot(
  bridge: StudioBridgeClient,
  args: { label?: string } = {}
): Promise<StudioCallResult> {
  if (args.label != null && (typeof args.label !== "string" || args.label.length > 120 || /[;&|`$<>\n\r]/.test(args.label))) {
    return bad("invalid label");
  }
  return bridge.callTool("capture_screenshot", { label: args.label ?? "playtest" });
}

export async function runtimeInspect(
  bridge: StudioBridgeClient,
  args: { expression: string; peer?: "server" | "client" }
): Promise<StudioCallResult> {
  if (typeof args.expression !== "string" || args.expression.length === 0) return bad("expression must be non-empty");
  if (args.expression.length > 5000) return bad("expression too large");
  return executeLuau(bridge, { source: `return (${args.expression})`, peer: args.peer ?? "server" });
}
