import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROBLOX_TEMPLATE_ID } from "../roblox/platform.js";
import { isRojoMissingFailure } from "../roblox/rojo.js";

const execFileAsync = promisify(execFile);

/**
 * Project bootstrap contract for AI Factory.
 *
 * Historical failure: `npm run build` → `sh: 1: webpack: not found` even
 * though package.json correctly declared webpack/webpack-cli. The root cause
 * was an environment/dependency bootstrap problem at execution time (the
 * scaffolded project never had its dependencies installed), not a missing
 * dependency declaration.
 *
 * This module is the single place that defines:
 *   1. Which local executables a template/build pipeline requires
 *      (derived from the project's own package.json — never invented).
 *   2. A lightweight preflight check (package.json, package-lock when
 *      expected, node_modules, required local binaries).
 *   3. Deterministic recovery: `npm ci` when a lockfile is available,
 *      `npm install` only when the project legitimately lacks one.
 *      Working node_modules is never deleted.
 *   4. Classification of bootstrap failures as infrastructure/dependency
 *      failures (`dependency_bootstrap:` prefix) so they are NEVER routed
 *      into expensive architect/agent repair loops.
 *   5. Helpers to execute build commands with the project's LOCAL
 *      dependencies (node_modules/.bin first on PATH — never rely on
 *      globally installed webpack/typescript).
 */

export const BOOTSTRAP_ERROR_PREFIX = "dependency_bootstrap:";

/** Default timeout for `npm ci` / `npm install` (ms). */
export const DEFAULT_INSTALL_TIMEOUT_MS = 300_000;

/**
 * Binary name -> owning npm package. Used to derive the required local
 * executables from the project's own package.json dependencies.
 */
const BIN_TO_PACKAGE: Record<string, string> = {
  webpack: "webpack",
  "webpack-cli": "webpack-cli",
  tsc: "typescript",
  tsserver: "typescript",
};

/** Required binaries for Phaser/Webpack web projects (template default). */
export const PHASER_WEB_REQUIRED_BINS: readonly string[] = [
  "webpack",
  "webpack-cli",
  "tsc",
];

export type InstallStrategy = "ci" | "install";

export interface PreflightResult {
  ok: boolean;
  projectDir: string;
  hasPackageJson: boolean;
  hasPackageLock: boolean;
  hasNodeModules: boolean;
  /** Local binaries (node_modules/.bin/<name>) that are required but missing. */
  missingBinaries: string[];
  /** Blocking problems. Empty when ok. */
  failures: string[];
  /** Non-blocking observations (e.g. lockfile absent on a fresh scaffold). */
  warnings: string[];
  requiredBinaries: string[];
}

export interface EnsureOptions {
  templateId?: string;
  timeoutMs?: number;
  /**
   * Injected installer (tests). Receives the chosen strategy and project dir.
   * The default installer runs real `npm ci` / `npm install`.
   */
  installer?: (strategy: InstallStrategy, projectDir: string) => Promise<void>;
}

export interface EnsureResult {
  ok: boolean;
  installed: boolean;
  strategy: InstallStrategy | "none";
  preflight: PreflightResult;
  /** Prefixed with `dependency_bootstrap:` when !ok. */
  error?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function readPackageJson(projectDir: string): Promise<PackageJsonShape | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir, "package.json"), "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
}

/**
 * Derive the required local binaries from the project's own package.json.
 * Only binaries whose owning package is actually declared are required —
 * nothing is invented and no random packages are ever installed.
 * Falls back to the Phaser/Webpack set when the template is a known
 * Phaser template but package.json cannot be read.
 */
export function requiredBinariesForProject(
  packageJson: PackageJsonShape | null,
  templateId?: string
): string[] {
  // Roblox/Rojo projects have no npm binaries — never invent any.
  if (templateId === ROBLOX_TEMPLATE_ID) {
    return [];
  }
  if (packageJson) {
    const declared = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]);
    const required: string[] = [];
    for (const [bin, pkg] of Object.entries(BIN_TO_PACKAGE)) {
      // tsc/tsserver share the typescript package — only require tsc.
      if (bin === "tsserver") continue;
      if (declared.has(pkg) && !required.includes(bin)) {
        required.push(bin);
      }
    }
    return required;
  }
  if (
    templateId === "phaser-generic-web-template" ||
    templateId === "yagames-phaser-template"
  ) {
    return [...PHASER_WEB_REQUIRED_BINS];
  }
  return [];
}

/**
 * Choose the reproducible install strategy. Prefers `npm ci` whenever the
 * project has a lockfile; falls back to `npm install` only when the project
 * legitimately lacks one (e.g. a fresh template scaffold — templates never
 * ship node_modules or lockfiles).
 */
export function selectInstallStrategy(hasLockfile: boolean): InstallStrategy {
  return hasLockfile ? "ci" : "install";
}

/**
 * True when a project is Roblox-only: it has `default.project.json` and no
 * `package.json`, so no npm lifecycle applies to it at all.
 */
export async function isRobloxOnlyProject(projectDir: string): Promise<boolean> {
  const [hasRoblox, hasNpm] = await Promise.all([
    pathExists(path.join(projectDir, "default.project.json")),
    pathExists(path.join(projectDir, "package.json")),
  ]);
  return hasRoblox && !hasNpm;
}

/**
 * Lightweight preflight check for a project workspace:
 * package.json exists, package-lock exists when expected, node_modules
 * exists (when the project declares dependencies), required local binaries
 * exist. Pure filesystem stats — no subprocesses, safe to run before every
 * implementation/test/build step.
 *
 * Roblox/Rojo-only projects skip the npm preflight entirely (ok with a
 * warning) — Rojo validation owns their health checks.
 */
export async function preflightProject(
  projectDir: string,
  opts?: { templateId?: string; expectLockfile?: boolean }
): Promise<PreflightResult> {
  const failures: string[] = [];
  const warnings: string[] = [];

  // Roblox/Rojo-only projects have no npm toolchain to preflight.
  if (opts?.templateId === ROBLOX_TEMPLATE_ID || (await isRobloxOnlyProject(projectDir))) {
    return {
      ok: true,
      projectDir,
      hasPackageJson: false,
      hasPackageLock: false,
      hasNodeModules: false,
      missingBinaries: [],
      failures: [],
      warnings: ["Roblox/Rojo project — npm preflight not applicable (Rojo validation owns health checks)"],
      requiredBinaries: [],
    };
  }

  const hasPackageJson = await pathExists(path.join(projectDir, "package.json"));
  if (!hasPackageJson) {
    failures.push("missing package.json");
  }

  const hasPackageLock = await pathExists(path.join(projectDir, "package-lock.json"));
  if (!hasPackageLock) {
    const msg = "missing package-lock.json";
    if (opts?.expectLockfile) {
      failures.push(msg);
    } else {
      warnings.push(`${msg} (fresh scaffold — will use npm install)`);
    }
  }

  const pkg = hasPackageJson ? await readPackageJson(projectDir) : null;
  const requiredBinaries = requiredBinariesForProject(pkg, opts?.templateId);
  const declaresDeps =
    !!pkg &&
    (Object.keys(pkg.dependencies ?? {}).length > 0 ||
      Object.keys(pkg.devDependencies ?? {}).length > 0);

  const hasNodeModules = await isDirectory(path.join(projectDir, "node_modules"));
  if (hasPackageJson && declaresDeps && !hasNodeModules) {
    failures.push("missing node_modules (dependencies never installed)");
  }

  const missingBinaries: string[] = [];
  for (const bin of requiredBinaries) {
    if (!(await pathExists(path.join(projectDir, "node_modules", ".bin", bin)))) {
      missingBinaries.push(bin);
    }
  }
  if (missingBinaries.length > 0) {
    failures.push(`missing local binaries: ${missingBinaries.join(", ")}`);
  }

  return {
    ok: failures.length === 0,
    projectDir,
    hasPackageJson,
    hasPackageLock,
    hasNodeModules,
    missingBinaries,
    failures,
    warnings,
    requiredBinaries,
  };
}

/**
 * Detect dependency/bootstrap failure text: missing local binaries
 * (`sh: 1: webpack: not found`), missing modules, npm errors. Such output
 * means the environment was never bootstrapped — NOT that the agent wrote
 * bad code. Roblox toolchain failures (`roblox_toolchain:`, missing Rojo)
 * are classified here too: missing external tooling is infrastructure.
 */
export function isDependencyBootstrapFailure(text: string | null | undefined): boolean {
  if (!text) return false;
  if (isRojoMissingFailure(text)) return true;
  const patterns = [
    /dependency_bootstrap:/i,
    /sh:\s*\d*\s*:?\s*[\w-]+:\s*not found/i,
    /\b(webpack|webpack-cli|tsc|typescript)\s*:\s*(not found|command not found)\b/i,
    /\bcommand not found\b/i,
    /\bcannot find module\b/i,
    /\berr_module_not_found\b/i,
    /\bmodule not found\b/i,
    /\bmodulenotfounderror\b/i,
    /\bnpm err!/i,
    /\beresolve\b/i,
    /\bneed to install\b/i,
    /node_modules\/.bin\/[\w-]+.*(missing|not found|no such file)/i,
  ];
  return patterns.some((re) => re.test(text));
}

function defaultInstaller(
  strategy: InstallStrategy,
  projectDir: string,
  timeoutMs: number
): Promise<void> {
  return runNpmInstall(strategy, projectDir, timeoutMs);
}

async function runNpmInstall(
  strategy: InstallStrategy,
  projectDir: string,
  timeoutMs: number
): Promise<void> {
  const run = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
    execFileAsync("npm", args, {
      cwd: projectDir,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    }).then(
      (r) => ({ stdout: r.stdout ?? "", stderr: r.stderr ?? "" }),
      (error: unknown) => {
        const e = error as { stdout?: string; stderr?: string; message?: string };
        throw new Error(
          [e.stderr, e.stdout, e.message].filter(Boolean).join("\n").slice(0, 4000)
        );
      }
    );

  if (strategy === "ci") {
    try {
      await run(["ci", "--no-audit", "--no-fund"]);
      return;
    } catch (error) {
      // `npm ci` fails when package.json and package-lock.json are out of
      // sync. That is the ONE case where falling back to `npm install`
      // (which reconciles the lockfile) is legitimate.
      const msg = error instanceof Error ? error.message : String(error);
      if (/in sync|ci can only|out of sync|missing:.*from lock/i.test(msg)) {
        await run(["install", "--no-audit", "--no-fund"]);
        return;
      }
      throw error;
    }
  }

  await run(["install", "--no-audit", "--no-fund"]);
}

/**
 * Ensure a scaffolded/copied project's dependencies are installed.
 *
 * - Roblox/Rojo projects (roblox template or `default.project.json` without
 *   `package.json`) have no npm toolchain: this is an explicit no-op and
 *   NEVER runs `npm ci` / `npm install` for them.
 * - Reads the project's own package.json (versions are preserved exactly;
 *   no random packages are ever installed).
 * - No-op when preflight already passes (never deletes working node_modules,
 *   never reinstalls unnecessarily).
 * - Uses `npm ci` when package-lock.json is available, `npm install` only
 *   when the project legitimately lacks a lockfile.
 * - Failures are returned with a `dependency_bootstrap:` error so callers
 *   classify them as infrastructure failures — never as agent failures and
 *   never into architect repair loops.
 */
export async function ensureProjectDependencies(
  projectDir: string,
  opts?: EnsureOptions
): Promise<EnsureResult> {
  const templateId = opts?.templateId;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;

  // Roblox/Rojo projects never use npm — skip before touching anything.
  if (templateId === ROBLOX_TEMPLATE_ID) {
    const preflight = await preflightProject(projectDir, { templateId });
    return { ok: true, installed: false, strategy: "none", preflight };
  }
  if (await isRobloxOnlyProject(projectDir)) {
    const preflight = await preflightProject(projectDir, { templateId });
    return { ok: true, installed: false, strategy: "none", preflight };
  }

  const before = await preflightProject(projectDir, { templateId });
  if (before.ok) {
    return { ok: true, installed: false, strategy: "none", preflight: before };
  }

  // Not an npm project at all (no package.json and nothing we recognize):
  // nothing to bootstrap — leave it to the caller. This keeps the check
  // safe for non-npm workspaces and mock executors in tests.
  if (!before.hasPackageJson) {
    return {
      ok: true,
      installed: false,
      strategy: "none",
      preflight: before,
    };
  }

  const strategy = selectInstallStrategy(before.hasPackageLock);
  const installer = opts?.installer ?? ((s, dir) => defaultInstaller(s, dir, timeoutMs));

  try {
    await installer(strategy, projectDir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      installed: false,
      strategy,
      preflight: before,
      error:
        `${BOOTSTRAP_ERROR_PREFIX} failed to install dependencies ` +
        `(${strategy}) in ${projectDir}: ${detail.slice(0, 2000)}`,
    };
  }

  const after = await preflightProject(projectDir, { templateId });
  if (!after.ok) {
    return {
      ok: false,
      installed: true,
      strategy,
      preflight: after,
      error:
        `${BOOTSTRAP_ERROR_PREFIX} dependencies installed (${strategy}) but ` +
        `preflight still fails in ${projectDir}: ${after.failures.join("; ")}`,
    };
  }

  return { ok: true, installed: true, strategy, preflight: after };
}

/**
 * Environment with the project's LOCAL node_modules/.bin first on PATH so
 * build/typecheck commands resolve webpack/tsc from the project's own
 * dependencies — never from a global install.
 */
export function envWithLocalBin(
  projectDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const localBin = path.join(projectDir, "node_modules", ".bin");
  const prevPath = baseEnv.PATH ?? baseEnv.Path ?? "";
  const delimiter = path.delimiter;
  const parts = prevPath ? prevPath.split(delimiter) : [];
  if (parts[0] !== localBin) {
    const filtered = parts.filter((p) => p !== localBin);
    return { ...baseEnv, PATH: [localBin, ...filtered].join(delimiter) };
  }
  return { ...baseEnv };
}
