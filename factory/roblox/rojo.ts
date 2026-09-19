import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Rojo toolchain resolution.
 *
 * The factory runs inside WSL while Rojo is installed in the Windows Roblox
 * tooling environment. There is no single guaranteed path, so resolution is
 * a discovery chain (first hit wins) — never one hardcoded assumption:
 *
 *   1. `ROJO_BIN` / `ROJO_PATH` env override (supports both WSL paths and
 *      Windows `C:\...` paths, which are converted to `/mnt/c/...`).
 *   2. `rojo` / `rojo.exe` found on PATH.
 *   3. Per-user tool managers: `~/.rokit/bin/rojo`, `~/.aftman/bin/rojo`.
 *   4. Windows-side discovery from WSL: enumerate per-user directories under
 *      /mnt/c/Users for Rokit/Aftman install locations
 *      (.rokit/bin/rojo.exe, .aftman/bin/rojo.exe).
 *
 * Missing Rojo is an INFRASTRUCTURE condition (`roblox_toolchain:` prefix),
 * never a game-code bug.
 */

/** Prefix marking Roblox toolchain/infrastructure failures. */
export const ROBLOX_TOOLCHAIN_ERROR_PREFIX = "roblox_toolchain:";

export interface RojoResolution {
  found: boolean;
  /** Absolute executable path when found. */
  bin?: string;
  /** How the binary was discovered (env, PATH, rokit, aftman, windows-scan). */
  via?: string;
  /** `rojo --version` output when the binary executed successfully. */
  version?: string;
  /** Human-readable reason when not found. */
  reason?: string;
  /** Every candidate location that was probed (for diagnostics). */
  probed: string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a Windows-style path (`C:\tools\rojo.exe`) to its WSL mount
 * equivalent (`/mnt/c/tools/rojo.exe`). WSL paths pass through unchanged.
 */
export function toWslPath(p: string): string {
  const m = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2].replace(/\\/g, "/");
    return `/mnt/${drive}/${rest}`;
  }
  return p.replace(/\\/g, "/");
}

async function tryVersion(bin: string, timeoutMs: number): Promise<string | null> {
  try {
    const r = await execFileAsync(bin, ["--version"], {
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
      encoding: "utf8",
    });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, 200) || "unknown version";
  } catch {
    return null;
  }
}

async function whichOnPath(name: string): Promise<string | null> {
  for (const finder of ["which", "command"]) {
    try {
      if (finder === "which") {
        const r = await execFileAsync("which", [name], {
          timeout: 5000,
          encoding: "utf8",
        });
        const hit = (r.stdout ?? "").split("\n").map((s) => s.trim()).find(Boolean);
        if (hit && (await pathExists(hit))) return hit;
      }
    } catch {
      // fall through to next finder
    }
  }
  // Direct attempt: rely on exec PATH lookup via --version probe.
  const v = await tryVersion(name, 5000);
  return v !== null ? name : null;
}

/** Enumerate per-user Windows tool-manager install locations visible from WSL. */
async function scanWindowsUserDirs(probed: string[]): Promise<string[]> {
  const hits: string[] = [];
  const usersRoot = "/mnt/c/Users";
  let users: string[] = [];
  try {
    const entries = await fs.readdir(usersRoot, { withFileTypes: true });
    users = entries
      .filter((e) => e.isDirectory() && !["Public", "Default", "Default User", "All Users"].includes(e.name))
      .map((e) => path.join(usersRoot, e.name));
  } catch {
    return hits;
  }
  const relCandidates = [
    "AppData/Local/Rokit/bin/rojo.exe",
    ".rokit/bin/rojo.exe",
    ".aftman/bin/rojo.exe",
    "AppData/Local/Aftman/bin/rojo.exe",
    "AppData/Local/Programs/Rojo/rojo.exe",
  ];
  for (const home of users) {
    for (const rel of relCandidates) {
      const candidate = path.join(home, rel);
      probed.push(candidate);
      if (await pathExists(candidate)) hits.push(candidate);
    }
    // Rokit/Aftman tool storage holds the REAL binaries behind the bin shims
    // (e.g. .rokit/tool-storage/rojo-rbx/rojo/7.7.0/rojo.exe).
    hits.push(...(await scanToolStorage(home, probed)));
  }
  return hits;
}

/**
 * Find real Rojo binaries inside Rokit/Aftman tool-storage directories.
 * Picks the highest versioned `rojo-rbx/rojo/<semver>/rojo(.exe)` available.
 */
async function scanToolStorage(homeDir: string, probed: string[]): Promise<string[]> {
  const hits: string[] = [];
  const roots = [
    path.join(homeDir, ".rokit", "tool-storage"),
    path.join(homeDir, ".aftman", "tool-storage"),
  ];
  for (const root of roots) {
    const toolDir = path.join(root, "rojo-rbx", "rojo");
    probed.push(toolDir);
    let versions: string[] = [];
    try {
      const entries = await fs.readdir(toolDir, { withFileTypes: true });
      versions = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    versions.sort(compareSemverDesc);
    for (const v of versions) {
      for (const exe of ["rojo.exe", "rojo"]) {
        const candidate = path.join(toolDir, v, exe);
        probed.push(candidate);
        if (await pathExists(candidate)) {
          hits.push(candidate);
          break;
        }
      }
      if (hits.length > 0 && hits[hits.length - 1].startsWith(toolDir + path.sep)) {
        break; // highest usable version in this storage wins
      }
    }
  }
  return hits;
}

function parseSemver(v: string): number[] {
  return v.split(".").map((n) => Number.parseInt(n, 10) || 0);
}

function compareSemverDesc(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface ResolveRojoOptions {
  env?: NodeJS.ProcessEnv;
  /** Probe timeout per candidate in ms. */
  timeoutMs?: number;
}

/**
 * Discover the Rojo executable. Never throws — returns a resolution object
 * so callers can classify "not found" as BLOCKED infrastructure.
 */
export async function resolveRojoExecutable(
  opts?: ResolveRojoOptions
): Promise<RojoResolution> {
  const env = opts?.env ?? process.env;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const probed: string[] = [];

  // 1. Explicit override.
  const override = env.ROJO_BIN ?? env.ROJO_PATH;
  if (override) {
    const candidate = toWslPath(override.trim());
    probed.push(candidate);
    if (await pathExists(candidate)) {
      const version = await tryVersion(candidate, timeoutMs);
      if (version !== null) {
        return { found: true, bin: candidate, via: "env", version, probed };
      }
      return {
        found: false,
        reason:
          `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} ROJO_BIN points at ${candidate} but it is not executable.`,
        probed,
      };
    }
    return {
      found: false,
      reason:
        `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} ROJO_BIN points at ${candidate} which does not exist.`,
      probed,
    };
  }

  // 2. PATH lookup.
  for (const name of ["rojo", "rojo.exe"]) {
    probed.push(`PATH:${name}`);
    const hit = await whichOnPath(name);
    if (hit) {
      const version = await tryVersion(hit, timeoutMs);
      if (version !== null) {
        return { found: true, bin: hit, via: "PATH", version, probed };
      }
    }
  }

  // 3. Per-user tool managers (Linux/WSL side).
  const home = os.homedir();
  for (const [candidate, via] of [
    [path.join(home, ".rokit", "bin", "rojo"), "rokit"],
    [path.join(home, ".aftman", "bin", "rojo"), "aftman"],
  ] as Array<[string, string]>) {
    probed.push(candidate);
    if (await pathExists(candidate)) {
      const version = await tryVersion(candidate, timeoutMs);
      if (version !== null) {
        return { found: true, bin: candidate, via, version, probed };
      }
    }
  }

  // 3b. WSL-side tool storage (real binaries behind manager shims).
  for (const hit of await scanToolStorage(home, probed)) {
    const version = await tryVersion(hit, timeoutMs);
    if (version !== null) {
      return { found: true, bin: hit, via: "tool-storage", version, probed };
    }
  }

  // 4. Windows-side scan from WSL (/mnt/c/Users/...).
  const windowsHits = await scanWindowsUserDirs(probed);
  for (const hit of windowsHits) {
    const version = await tryVersion(hit, timeoutMs);
    if (version !== null) {
      return { found: true, bin: hit, via: "windows-scan", version, probed };
    }
  }

  return {
    found: false,
    reason:
      `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Rojo executable not found. ` +
      `Set ROJO_BIN to the installed Rojo binary (WSL or C:\\ path), or install Rojo ` +
      `(https://rojo.space/docs/installation/). This is an infrastructure condition, not a game-code bug.`,
    probed,
  };
}

/**
 * True when output text indicates the Rojo toolchain itself is unavailable
 * (as opposed to the game project being broken).
 */
export function isRojoMissingFailure(text: string | null | undefined): boolean {
  if (!text) return false;
  const patterns = [
    /roblox_toolchain:/i,
    /\brojo\b.*(not found|command not found|missing|no such file)/i,
    /(not found|command not found|no such file).*?\brojo\b/i,
    /\bENOENT\b.*\brojo\b/i,
    /\brojo\b.*\bENOENT\b/i,
  ];
  return patterns.some((re) => re.test(text));
}

export interface RojoRunResult {
  ok: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Present when the failure is infrastructure (missing toolchain). */
  infraError?: string;
}

/**
 * Run Rojo with the resolved binary. Returns an infra-classified result when
 * Rojo is missing instead of throwing.
 */
export async function runRojo(
  args: string[],
  opts?: {
    cwd?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    bin?: string;
  }
): Promise<RojoRunResult> {
  const start = Date.now();
  let bin = opts?.bin;
  if (!bin) {
    const resolution = await resolveRojoExecutable({ env: opts?.env });
    if (!resolution.found) {
      return {
        ok: false,
        command: `rojo ${args.join(" ")}`,
        exitCode: 127,
        stdout: "",
        stderr: resolution.reason ?? `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Rojo not found.`,
        durationMs: Date.now() - start,
        infraError: resolution.reason,
      };
    }
    bin = resolution.bin!;
  }
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
    const e = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    const stderr = (e.stderr ?? e.message ?? "").slice(0, 4000);
    if (/ENOENT/i.test(e.message ?? "") && !e.code) {
      return {
        ok: false,
        command,
        exitCode: 127,
        stdout: "",
        stderr: `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Rojo binary not executable at ${bin}: ${stderr}`,
        durationMs: Date.now() - start,
        infraError: stderr,
      };
    }
    return {
      ok: false,
      command,
      exitCode: e.code ?? 1,
      stdout: (e.stdout ?? "").slice(0, 4000),
      stderr,
      durationMs: Date.now() - start,
    };
  }
}
