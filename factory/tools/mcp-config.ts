/**
 * OpenCode / MCP integration helpers.
 *
 * Determines how OpenCode agents consume factory tools in the current
 * environment: inspects installed OpenCode setup, declares MCP servers, and
 * surfaces tool availability to agents. No secrets are ever hardcoded —
 * everything flows through environment variables.
 *
 * Supported MCP servers (optional, health-checked at runtime):
 *   roblox-studio — PRIMARY Studio bridge (Chrrxs/robloxstudio-mcp
 *                   compatible HTTP bridge). `npx -y @chrrxs/robloxstudio-mcp`
 *   blender       — OPTIONAL Blender bridge (ahujasid/blender-mcp
 *                   compatible). `uvx blender-mcp`
 */

export interface McpServerDecl {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  required: boolean;
  description: string;
}

export interface McpHealth {
  name: string;
  ok: boolean;
  message: string;
  optional: boolean;
}

export function robloxStudioMcpDecl(env?: NodeJS.ProcessEnv): McpServerDecl {
  const e = env ?? process.env;
  return {
    name: "roblox-studio",
    command: "npx",
    args: ["-y", "@chrrxs/robloxstudio-mcp@latest"],
    env: e.STUDIO_BRIDGE_PORT ? { STUDIO_BRIDGE_PORT: e.STUDIO_BRIDGE_PORT } : undefined,
    required: false,
    description:
      "PRIMARY Studio bridge (Chrrxs/robloxstudio-mcp, MIT). " +
      "Requires the Studio plugin + an open place. Missing Studio => BLOCKED, never a code bug.",
  };
}

export function blenderMcpDecl(): McpServerDecl {
  return {
    name: "blender",
    command: "uvx",
    args: ["blender-mcp"],
    required: false,
    description:
      "OPTIONAL Blender bridge (ahujasid/blender-mcp, MIT). " +
      "Missing Blender => TOOL_UNAVAILABLE/BLOCKED; Roblox pipeline continues.",
  };
}

/** Default MCP server set for OpenCode agents. */
export function defaultMcpServers(env?: NodeJS.ProcessEnv): McpServerDecl[] {
  return [robloxStudioMcpDecl(env), blenderMcpDecl()];
}

/**
 * Render an `mcpServers` JSON snippet suitable for opencode.json /
 * `.opencode/` MCP client configuration. Callers merge it into their own
 * config file — this helper never writes files itself.
 */
export function renderMcpConfigSnippet(env?: NodeJS.ProcessEnv): string {
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const s of defaultMcpServers(env)) {
    servers[s.name] = s.env ? { command: s.command, args: s.args, env: s.env } : { command: s.command, args: s.args };
  }
  return JSON.stringify({ mcpServers: servers }, null, 2);
}

/**
 * Describe how a Factory agent reaches tool execution in the current
 * environment: Factory agent → ToolRegistry/MCP → execution → result.
 */
export function describeToolConsumption(): string {
  return [
    "Factory agent → ToolRegistry.execute(toolId, args, { role, projectDir })",
    "  → permission check (ROLE_TOOLS matrix + destructive-role gate)",
    "  → handler: studio-bridge (HTTP to Studio plugin) | local-exec (rojo/stylua/...) | filesystem | http (allowlisted)",
    "  → ToolResult PASS/FAIL/BLOCKED → agent continues reasoning",
    "Optional MCP servers (opencode.json mcpServers): roblox-studio (PRIMARY), blender (OPTIONAL).",
    "Missing Studio/Blender surfaces as BLOCKED/TOOL_UNAVAILABLE infrastructure — never as game-code FAIL.",
  ].join("\n");
}

/** Health-check the MCP layer without requiring any server to be present. */
export async function checkMcpHealth(opts?: {
  studioProbe?: () => Promise<{ ok: boolean; message: string }>;
  blenderProbe?: () => Promise<{ ok: boolean; message: string }>;
}): Promise<McpHealth[]> {
  const out: McpHealth[] = [];
  try {
    const r = opts?.studioProbe ? await opts.studioProbe() : { ok: false, message: "studio bridge not probed (no live Studio expected in CI)" };
    out.push({ name: "roblox-studio", ok: r.ok, message: r.message, optional: true });
  } catch (e) {
    out.push({ name: "roblox-studio", ok: false, message: e instanceof Error ? e.message : String(e), optional: true });
  }
  try {
    const r = opts?.blenderProbe ? await opts.blenderProbe() : { ok: false, message: "blender bridge not probed (optional)" };
    out.push({ name: "blender", ok: r.ok, message: r.message, optional: true });
  } catch (e) {
    out.push({ name: "blender", ok: false, message: e instanceof Error ? e.message : String(e), optional: true });
  }
  return out;
}
