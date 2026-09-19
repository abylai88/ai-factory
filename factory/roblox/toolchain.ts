import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Professional Luau development toolchain wrappers.
 *
 * Tools are used as deterministic helpers (never as AI agents):
 *   PROGRAMMER → generate/edit Luau → StyLua → Selene → Luau validation
 *   → Lune tests → Rojo build → Studio playtest
 *
 * Licenses (binaries invoked, never vendored — no redistribution):
 *   Rojo      MPL-2.0      (rojo-rbx/rojo)
 *   StyLua    MPL-2.0      (JohnnyMorganz/StyLua)
 *   Selene    MPL-2.0      (Kampfkarren/selene)
 *   luau-lsp  MIT          (JohnnyMorganz/luau-lsp)
 *   Lune      MPL-2.0      (lune-org/lune)
 *   Wally     Apache-2.0   (UpliftGames/wally)
 *   Rokit     Apache-2.0   (rojo-rbx/rokit, toolchain manager)
 *
 * Every probe/run degrades to { available:false } / non-zero results — the
 * registry maps those to BLOCKED infrastructure, never code FAIL.
 */

export interface ToolAvailability {
  name: string;
  available: boolean;
  bin: string;
  version?: string;
  message: string;
}

export interface ToolRunResult {
  ok: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

async function tryVersion(bin: string, args: string[], timeoutMs: number): Promise<string | null> {
  try {
    const r = await execFileAsync(bin, args, { timeout: timeoutMs, maxBuffer: 512 * 1024, encoding: "utf8" });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, 200) || "unknown version";
  } catch {
    return null;
  }
}

export async function probeBinary(
  name: string,
  versionArgs: string[] = ["--version"],
  timeoutMs = 8000
): Promise<ToolAvailability> {
  const v = await tryVersion(name, versionArgs, timeoutMs);
  if (v !== null) return { name, available: true, bin: name, version: v, message: `${name} ${v}` };
  return { name, available: false, bin: name, message: `${name} not installed (optional toolchain component)` };
}

export async function probeToolchain(): Promise<ToolAvailability[]> {
  return Promise.all([
    probeBinary("stylua"),
    probeBinary("selene"),
    probeBinary("luau-analyze"),
    probeBinary("luau-lsp", ["--version"]),
    probeBinary("lune"),
    probeBinary("wally"),
    probeBinary("rokit"),
  ]);
}

export async function runTool(
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<ToolRunResult> {
  const start = Date.now();
  const command = `${bin} ${args.join(" ")}`;
  try {
    const r = await execFileAsync(bin, args, {
      cwd: opts?.cwd,
      timeout: opts?.timeoutMs ?? 60_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: opts?.env ?? process.env,
    });
    return {
      ok: true,
      command,
      exitCode: 0,
      stdout: (r.stdout ?? "").slice(0, 4000),
      stderr: (r.stderr ?? "").slice(0, 4000),
      durationMs: Date.now() - start,
    };
  } catch (error: unknown) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const code = typeof e.code === "number" ? e.code : 1;
    if (/ENOENT/i.test(e.message ?? "") && (e.code == null || e.code === "ENOENT")) {
      return {
        ok: false,
        command,
        exitCode: 127,
        stdout: "",
        stderr: `roblox_toolchain: ${bin} not installed: ${e.message ?? ""}`.slice(0, 1000),
        durationMs: Date.now() - start,
      };
    }
    return {
      ok: false,
      command,
      exitCode: code,
      stdout: (e.stdout ?? "").slice(0, 4000),
      stderr: (e.stderr ?? e.message ?? "").slice(0, 4000),
      durationMs: Date.now() - start,
    };
  }
}

/** StyLua formatting check (read-only `--check`; never rewrites silently). */
export function styluaCheck(file: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ToolRunResult> {
  return runTool("stylua", ["--check", file], opts);
}

/** Selene lint for a file. */
export function seleneLint(file: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ToolRunResult> {
  return runTool("selene", [file], opts);
}

/** Lune script execution (tests where applicable). */
export function luneRun(file: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ToolRunResult> {
  return runTool("lune", ["run", file], opts);
}

/** Wally package install (explicit opt-in; network required). */
export function wallyInstall(opts?: { cwd?: string; timeoutMs?: number }): Promise<ToolRunResult> {
  return runTool("wally", ["install"], opts);
}
