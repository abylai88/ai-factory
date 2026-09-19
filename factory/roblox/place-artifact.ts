/**
 * Roblox place artifact provisioning.
 *
 * Turns a Rojo source project (`default.project.json` + `src/`) into a
 * deterministic loadable `.rbxlx` artifact the Studio project loader can
 * open — without requiring the user to build it by hand.
 *
 * Flow: validate project → resolve Rojo → freshness check → build if needed
 * → verify artifact on disk. Every outcome is structured; nothing is
 * claimed without filesystem evidence.
 *
 * Reuses the existing toolchain abstraction (`resolveRojoExecutable`,
 * `runRojo` in `./rojo.js`) — never a duplicate resolver, never a hardcoded
 * machine-specific path.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveRojoExecutable,
  runRojo,
  ROBLOX_TOOLCHAIN_ERROR_PREFIX,
  type RojoRunResult,
} from "./rojo.js";

/** Terminal failure codes for artifact provisioning (never generic timeout). */
export type RobloxProvisionCode =
  | "ROJO_UNAVAILABLE"
  | "ROJO_BUILD_FAILED"
  | "ROBLOX_ARTIFACT_MISSING";

export interface RojoAvailable {
  ok: true;
  bin: string;
  version?: string;
  via?: string;
}

export interface RojoUnavailable {
  ok: false;
  code: "ROJO_UNAVAILABLE";
  reason: string;
  probed: string[];
}

/**
 * Reusable Rojo availability check. Reuses any installed Rojo binary found
 * through the existing discovery chain (ROJO_BIN → PATH → rokit/aftman →
 * Windows-side scan). Never downloads anything; without network or binary
 * it returns a structured unavailable result for tests and offline use.
 */
export async function ensureRojoAvailable(opts?: {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  bin?: string;
}): Promise<RojoAvailable | RojoUnavailable> {
  if (opts?.bin) {
    try {
      await fs.access(opts.bin);
      return { ok: true, bin: opts.bin };
    } catch {
      return {
        ok: false,
        code: "ROJO_UNAVAILABLE",
        reason:
          `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Rojo binary override not accessible at ${opts.bin}.`,
        probed: [opts.bin],
      };
    }
  }
  const resolution = await resolveRojoExecutable({ env: opts?.env, timeoutMs: opts?.timeoutMs });
  if (resolution.found && resolution.bin) {
    return { ok: true, bin: resolution.bin, version: resolution.version, via: resolution.via };
  }
  return {
    ok: false,
    code: "ROJO_UNAVAILABLE",
    reason: resolution.reason ?? `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Rojo executable not found.`,
    probed: resolution.probed,
  };
}

/** Directory holding deterministic build artifacts (outside source trees). */
export function artifactDir(): string {
  return path.join(os.tmpdir(), "ai-factory-places");
}

/** Filesystem-safe slug for artifact naming (<=64 chars). */
export function artifactSlug(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug || "roblox-place";
}

/**
 * Deterministic artifact path for a project. Defaults to
 * `<tmpdir>/ai-factory-places/<project-dir-slug>.rbxlx` so rebuilds never
 * accumulate junk and Studio (Windows side) reads a stable path.
 */
export function defaultArtifactPath(projectDir: string, artifactName?: string): string {
  const base = artifactName ?? path.basename(path.resolve(projectDir));
  return path.join(artifactDir(), `${artifactSlug(base)}.rbxlx`);
}

export interface SourceFreshness {
  /** Newest mtime (ms) among project config + sources, -1 when unreadable. */
  newestSourceMtimeMs: number;
  filesScanned: number;
  truncated: boolean;
}

const FRESHNESS_EXCLUDES = new Set(["node_modules", ".git", ".git2", "dist", "build", ".factory"]);
const FRESHNESS_MAX_FILES = 5000;

/** Newest modification time across the Rojo project inputs. */
export async function newestSourceMtime(projectDir: string): Promise<SourceFreshness> {
  let newest = -1;
  let scanned = 0;
  let truncated = false;
  const stack: string[] = [projectDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (scanned >= FRESHNESS_MAX_FILES) {
        truncated = true;
        break;
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (FRESHNESS_EXCLUDES.has(e.name)) continue;
        stack.push(full);
        continue;
      }
      if (e.name.endsWith(".rbxlx") || e.name.endsWith(".rbxl")) continue;
      scanned++;
      try {
        const st = await fs.stat(full);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch {
        // unreadable file: ignore, other files still count
      }
    }
    if (truncated) break;
  }
  return { newestSourceMtimeMs: newest, filesScanned: scanned, truncated };
}

export interface ArtifactFreshness {
  fresh: boolean;
  reason: string;
  artifactMtimeMs: number;
  newestSourceMtimeMs: number;
}

/** Artifact is fresh when it exists and is newer than every source input. */
export async function artifactFreshness(
  projectDir: string,
  artifactPath: string
): Promise<ArtifactFreshness> {
  let artifactStat;
  try {
    artifactStat = await fs.stat(artifactPath);
  } catch {
    return {
      fresh: false,
      reason: "artifact missing — rebuild required",
      artifactMtimeMs: -1,
      newestSourceMtimeMs: -1,
    };
  }
  if (artifactStat.size === 0) {
    return {
      fresh: false,
      reason: "artifact is empty — rebuild required",
      artifactMtimeMs: artifactStat.mtimeMs,
      newestSourceMtimeMs: -1,
    };
  }
  const src = await newestSourceMtime(projectDir);
  if (src.newestSourceMtimeMs < 0) {
    return {
      fresh: false,
      reason: "project sources unreadable — rebuild required",
      artifactMtimeMs: artifactStat.mtimeMs,
      newestSourceMtimeMs: src.newestSourceMtimeMs,
    };
  }
  if (artifactStat.mtimeMs >= src.newestSourceMtimeMs) {
    return {
      fresh: true,
      reason: "artifact is newer than all sources — reusing",
      artifactMtimeMs: artifactStat.mtimeMs,
      newestSourceMtimeMs: src.newestSourceMtimeMs,
    };
  }
  return {
    fresh: false,
    reason: "sources changed since artifact build — rebuild required",
    artifactMtimeMs: artifactStat.mtimeMs,
    newestSourceMtimeMs: src.newestSourceMtimeMs,
  };
}

export interface PlaceArtifactOptions {
  /** Explicit artifact path (default: deterministic tmpdir path). */
  artifactPath?: string;
  /** Artifact file base name without extension (default: project dir name). */
  artifactName?: string;
  /** Rebuild even when the artifact is fresh. */
  forceRebuild?: boolean;
  /** `rojo build` budget in ms (default 120_000). */
  buildTimeoutMs?: number;
  /** Pre-resolved Rojo binary (skips discovery). */
  bin?: string;
  env?: NodeJS.ProcessEnv;
  /** Injectable Rojo runner (defaults to runRojo; faked in unit tests). */
  runFn?: (args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; bin?: string }) => Promise<RojoRunResult>;
}

export interface PlaceArtifactSuccess {
  ok: true;
  artifactPath: string;
  fresh: boolean;
  rebuilt: boolean;
  sizeBytes: number;
  buildDurationMs: number;
  rojoBin: string;
  rojoVersion?: string;
  rojoVia?: string;
  freshnessReason: string;
}

export interface PlaceArtifactFailure {
  ok: false;
  code: RobloxProvisionCode;
  reason: string;
  artifactPath?: string;
  rojoBin?: string;
  buildStdout?: string;
  buildStderr?: string;
}

export type PlaceArtifactResult = PlaceArtifactSuccess | PlaceArtifactFailure;

/**
 * Ensure a loadable `.rbxlx` artifact exists for a Rojo source project.
 * Never modifies sources; the artifact lives outside the source tree.
 */
export async function ensureRobloxPlaceArtifact(
  projectDir: string,
  opts: PlaceArtifactOptions = {}
): Promise<PlaceArtifactResult> {
  const start = Date.now();
  const projectFile = path.join(projectDir, "default.project.json");
  try {
    const raw = await fs.readFile(projectFile, "utf8");
    JSON.parse(raw);
  } catch {
    return {
      ok: false,
      code: "ROBLOX_ARTIFACT_MISSING",
      reason:
        `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Not a Roblox source project: ${projectFile} is missing or unparseable.`,
    };
  }

  const artifactPath = opts.artifactPath ?? defaultArtifactPath(projectDir, opts.artifactName);
  const rojo = await ensureRojoAvailable({ env: opts.env, bin: opts.bin });
  if (!rojo.ok) {
    return { ok: false, code: rojo.code, reason: rojo.reason, artifactPath };
  }

  const freshness = await artifactFreshness(projectDir, artifactPath);
  if (freshness.fresh && !opts.forceRebuild) {
    const sizeBytes = (await fs.stat(artifactPath)).size;
    return {
      ok: true,
      artifactPath,
      fresh: true,
      rebuilt: false,
      sizeBytes,
      buildDurationMs: 0,
      rojoBin: rojo.bin,
      rojoVersion: rojo.version,
      rojoVia: rojo.via,
      freshnessReason: freshness.reason,
    };
  }

  const runFn = opts.runFn ?? runRojo;
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const built = await runFn(["build", "default.project.json", "--output", artifactPath], {
    cwd: projectDir,
    timeoutMs: opts.buildTimeoutMs ?? 120_000,
    env: opts.env,
    bin: rojo.bin,
  });
  if (!built.ok) {
    return {
      ok: false,
      code: "ROJO_BUILD_FAILED",
      reason:
        `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} rojo build failed for ${projectDir}: ${(built.stderr || built.stdout || `exit ${built.exitCode}`).slice(0, 500)}`,
      artifactPath,
      rojoBin: rojo.bin,
      buildStdout: built.stdout,
      buildStderr: built.stderr,
    };
  }

  let sizeBytes = 0;
  try {
    sizeBytes = (await fs.stat(artifactPath)).size;
  } catch {
    return {
      ok: false,
      code: "ROJO_BUILD_FAILED",
      reason: `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} rojo build reported success but no artifact exists at ${artifactPath}.`,
      artifactPath,
      rojoBin: rojo.bin,
      buildStdout: built.stdout,
      buildStderr: built.stderr,
    };
  }
  if (sizeBytes === 0) {
    return {
      ok: false,
      code: "ROJO_BUILD_FAILED",
      reason: `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} rojo build produced an empty artifact at ${artifactPath}.`,
      artifactPath,
      rojoBin: rojo.bin,
      buildStdout: built.stdout,
      buildStderr: built.stderr,
    };
  }
  return {
    ok: true,
    artifactPath,
    fresh: false,
    rebuilt: true,
    sizeBytes,
    buildDurationMs: built.durationMs,
    rojoBin: rojo.bin,
    rojoVersion: rojo.version,
    rojoVia: rojo.via,
    freshnessReason: freshness.reason,
  };
}
