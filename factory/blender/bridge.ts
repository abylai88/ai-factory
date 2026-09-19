/**
 * OPTIONAL Blender toolchain bridge.
 *
 * PRIMARY candidate: ahujasid/blender-mcp (MIT, most maintained) —
 * MCP server + Blender addon over a local socket/bridge. Reference:
 * official Blender lab blender_mcp (blender.org/lab/mcp-server).
 *
 * This module is intentionally a thin optional adapter: visual agents may
 * use Blender for procedural models/meshes/materials/modifiers/export, but
 * Blender is NEVER required. When Blender is unavailable every operation
 * returns TOOL_UNAVAILABLE/BLOCKED and the Roblox pipeline continues.
 */

export interface BlenderConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface BlenderResult {
  status: "PASS" | "BLOCKED" | "FAIL";
  message: string;
  data?: unknown;
}

export function resolveBlenderConfig(env?: NodeJS.ProcessEnv): BlenderConfig {
  const e = env ?? process.env;
  return {
    baseUrl: (e.BLENDER_MCP_URL ?? "http://127.0.0.1:9876").replace(/\/$/, ""),
    timeoutMs: Number(e.BLENDER_MCP_TIMEOUT_MS ?? 15_000) || 15_000,
  };
}

export async function checkBlenderAvailable(
  config?: Partial<BlenderConfig>,
  env?: NodeJS.ProcessEnv
): Promise<{ available: boolean; message: string }> {
  const c = { ...resolveBlenderConfig(env), ...config };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(5000, c.timeoutMs));
    try {
      const res = await fetch(`${c.baseUrl}/health`, { signal: ctrl.signal });
      if (res.ok) return { available: true, message: "blender bridge available" };
      return { available: false, message: `blender bridge HTTP ${res.status} (optional)` };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { available: false, message: "blender not available (optional) — continuing without Blender" };
  }
}

export async function blenderExport(
  _args: { scene?: string; format: "obj" | "fbx" | "stl" | "glb"; outPath: string },
  env?: NodeJS.ProcessEnv
): Promise<BlenderResult> {
  const check = await checkBlenderAvailable(undefined, env);
  if (!check.available) {
    return { status: "BLOCKED", message: `TOOL_UNAVAILABLE: ${check.message}` };
  }
  return { status: "FAIL", message: "blender export via live bridge not yet wired — use Studio-native parts instead" };
}
