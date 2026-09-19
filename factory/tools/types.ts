/**
 * Tool-layer core types.
 *
 * Central contract for every agent-callable tool in the AI Factory.
 * Agents never receive arbitrary shell access — they receive named tools
 * with declared capabilities, permissions, timeouts, and failure semantics.
 *
 * Failure classification (never collapsed):
 *   PASS    — tool executed and its own success criteria held
 *   FAIL    — tool executed but the game/code assertion failed (repair loop)
 *   BLOCKED — toolchain/infrastructure unavailable (Studio down, binary
 *             missing, timeout). NEVER routed to code repair as a code bug.
 */

/** Final verdict of a tool execution. */
export type ToolStatus = "PASS" | "FAIL" | "BLOCKED";

/** How a tool is executed. */
export type ToolExecutionMethod =
  | "studio-bridge" // via Roblox Studio HTTP/MCP bridge
  | "local-exec" // via a local binary (rojo, stylua, lune, ...)
  | "filesystem" // deterministic local file/project operation
  | "http" // outbound HTTP (asset search, docs) with allowlist
  | "stub"; // optional integration point (blender, telegram)

/** Agent roles known to the tool layer. */
export type ToolRole =
  | "programmer"
  | "builder"
  | "visual"
  | "ui"
  | "qa"
  | "tester"
  | "researcher"
  | "market"
  | "competitor"
  | "idea"
  | "director"
  | "designer"
  | "gameplay"
  | "architect"
  | "monetization"
  | "content"
  | "reviewer";

export interface ToolRetryPolicy {
  maxRetries: number;
  backoffMs: number;
}

export interface ToolDefinition {
  /** Stable id, e.g. "studio.play". Referenced by role permissions. */
  id: string;
  name: string;
  description: string;
  capability: string;
  platform: "roblox" | "web" | "shared";
  executionMethod: ToolExecutionMethod;
  /** Roles allowed to invoke this tool. Empty = no role may invoke. */
  allowedRoles: ToolRole[];
  timeoutMs: number;
  retry: ToolRetryPolicy;
  /** True for destructive ops (delete, overwrite, stop playtest, etc). */
  dangerous: boolean;
  /** True when the tool needs a live Studio connection. */
  requiresStudio: boolean;
}

export interface ToolCallContext {
  role: ToolRole;
  projectDir?: string;
  /** Attempt number (1-based) for observability. */
  attempt?: number;
}

export interface ToolResult {
  status: ToolStatus;
  toolId: string;
  /** Machine-readable summary line. */
  message: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Project-relative files relevant to a FAIL (for repair). */
  affectedFiles?: string[];
  /** Structured payload (instance tree, runtime state, screenshot path...). */
  data?: Record<string, unknown>;
  /** Present when status is BLOCKED: why the toolchain failed. */
  infraReason?: string;
  /** Screenshot path/reference when the tool captured one. */
  screenshotPath?: string;
}

export function pass(
  toolId: string,
  message: string,
  extra?: Partial<ToolResult>
): ToolResult {
  const result: ToolResult = {
    status: "PASS",
    toolId,
    message,
    stdout: message,
    stderr: "",
    durationMs: 0,
  };
  if (extra) {
    if (extra.stdout !== undefined) result.stdout = extra.stdout;
    if (extra.stderr !== undefined) result.stderr = extra.stderr;
    if (extra.durationMs !== undefined) result.durationMs = extra.durationMs;
    if (extra.affectedFiles !== undefined) result.affectedFiles = extra.affectedFiles;
    if (extra.data !== undefined) result.data = extra.data;
    if (extra.screenshotPath !== undefined) result.screenshotPath = extra.screenshotPath;
    if (extra.infraReason !== undefined) result.infraReason = extra.infraReason;
  }
  return result;
}

export function fail(
  toolId: string,
  message: string,
  extra?: Partial<ToolResult>
): ToolResult {
  const result: ToolResult = {
    status: "FAIL",
    toolId,
    message,
    stdout: "",
    stderr: message,
    durationMs: 0,
  };
  if (extra) {
    if (extra.stdout !== undefined) result.stdout = extra.stdout;
    if (extra.stderr !== undefined) result.stderr = extra.stderr;
    if (extra.durationMs !== undefined) result.durationMs = extra.durationMs;
    if (extra.affectedFiles !== undefined) result.affectedFiles = extra.affectedFiles;
    if (extra.data !== undefined) result.data = extra.data;
    if (extra.screenshotPath !== undefined) result.screenshotPath = extra.screenshotPath;
    if (extra.infraReason !== undefined) result.infraReason = extra.infraReason;
  }
  return result;
}

export function blocked(
  toolId: string,
  infraReason: string,
  extra?: Partial<ToolResult>
): ToolResult {
  const result: ToolResult = {
    status: "BLOCKED",
    toolId,
    message: `BLOCKED (infrastructure): ${infraReason}`,
    stdout: "",
    stderr: infraReason,
    durationMs: 0,
    infraReason,
  };
  if (extra) {
    if (extra.stdout !== undefined) result.stdout = extra.stdout;
    if (extra.stderr !== undefined) result.stderr = extra.stderr;
    if (extra.durationMs !== undefined) result.durationMs = extra.durationMs;
    if (extra.affectedFiles !== undefined) result.affectedFiles = extra.affectedFiles;
    if (extra.data !== undefined) result.data = extra.data;
    if (extra.screenshotPath !== undefined) result.screenshotPath = extra.screenshotPath;
    if (extra.infraReason !== undefined) result.infraReason = extra.infraReason;
  }
  return result;
}

/** True when output indicates toolchain/infra failure, not a game bug. */
export function isInfrastructureReason(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /roblox_toolchain:/i.test(text) ||
    /studio (not connected|unavailable|disconnected|connection refused|timed out)/i.test(text) ||
    /tool_unavailable|tool\.blocked|BLOCKED \(infrastructure\)/i.test(text) ||
    /\bENOENT\b/i.test(text) ||
    /command not found/i.test(text) ||
    /127/.test(text) && /rojo|stylua|lune|luau/i.test(text)
  );
}
