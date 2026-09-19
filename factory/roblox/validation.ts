import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { isRobloxProjectDir, ROBLOX_SRC_SERVICES } from "./platform.js";
import {
  resolveRojoExecutable,
  runRojo,
  ROBLOX_TOOLCHAIN_ERROR_PREFIX,
} from "./rojo.js";

/**
 * Platform-aware Roblox/Rojo validation.
 *
 * Validates a real Rojo project WITHOUT requiring Roblox Studio:
 *   - `default.project.json` exists, parses, and has a DataModel tree
 *   - every `$path` mapping points at a directory/file that exists
 *     (malformed Rojo mappings FAIL)
 *   - required source services exist
 *   - `.server.lua` / `.client.lua` placement conventions hold
 *   - no browser/TypeScript code leaked into the Luau project
 *   - Luau syntax checked with external tools when available
 *   - `rojo build` runs when Rojo is installed
 *
 * Verdicts:
 *   PASS    — project is a valid Rojo project
 *   FAIL    — game-code/structure bug → repair loop with file context
 *   BLOCKED — infrastructure (Rojo missing) → NEVER a code-repair loop
 */

export type RobloxValidationStatus = "PASS" | "FAIL" | "BLOCKED";

export interface RobloxCheck {
  name: string;
  passed: boolean;
  /** Present when the check failed or was skipped for infra reasons. */
  message?: string;
  /** True when this check reflects infrastructure, not game code. */
  infra?: boolean;
}

export interface RobloxValidationResult {
  status: RobloxValidationStatus;
  /** Failing/validating command label (e.g. "roblox-validate (structural)" or "rojo build ..."). */
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  checks: RobloxCheck[];
  /** Short human-readable verdict line. */
  reason: string;
  /** Project-relative Luau/config files relevant to a failure (for repair). */
  affectedFiles: string[];
}

export interface ValidateRobloxOptions {
  /** Run `rojo build` when Rojo is available (default true). */
  runRojoBuild?: boolean;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Pre-resolved Rojo binary (skips discovery). */
  rojoBin?: string;
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
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function collectLuauFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectLuauFiles(full, out);
    } else if (e.name.endsWith(".lua") || e.name.endsWith(".luau")) {
      out.push(full);
    }
  }
  return out;
}

interface RojoTreeNode {
  $className?: string;
  $path?: string;
  $properties?: Record<string, unknown>;
  [service: string]: unknown;
}

/** Collect every `$path` mapping in the Rojo tree with its JSON location. */
function collectPathMappings(
  node: unknown,
  base: string,
  out: Array<{ jsonPath: string; fsPath: string }> = []
): Array<{ jsonPath: string; fsPath: string }> {
  if (!node || typeof node !== "object") return out;
  const n = node as RojoTreeNode;
  if (typeof n.$path === "string") {
    out.push({ jsonPath: base || "$", fsPath: n.$path });
  }
  for (const [key, value] of Object.entries(n)) {
    if (key.startsWith("$")) continue;
    if (value && typeof value === "object") {
      collectPathMappings(value, base ? `${base}.${key}` : key, out);
    }
  }
  return out;
}

/** Strip Luau comments and long strings so heuristics don't misfire. */
function stripLuauNoise(src: string): string {
  return src
    .replace(/--\[\[[\s\S]*?\]\]/g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\[\[[\s\S]*?\]\]/g, '""')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Markers that prove a file is browser/TypeScript code, not Luau. */
const WEB_LEAK_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^\s*import\s+.+\s+from\s+['"]/m, label: "ES module import" },
  { re: /^\s*export\s+default\b/m, label: "ES module default export" },
  { re: /\brequire\(['"]phaser['"]\)/, label: 'require("phaser")' },
  { re: /\bfrom\s+['"]phaser['"]/, label: 'from "phaser"' },
  { re: /\bdocument\.(getElementById|querySelector|createElement)\b/, label: "DOM access" },
  { re: /\bwindow\.(addEventListener|location|innerWidth)\b/, label: "window access" },
  { re: /\bnpm\s+run\s+build\b/, label: "npm build reference" },
  { re: /281474976710656|game\.config|new\s+Phaser\.Game/, label: "Phaser bootstrap" },
];

/**
 * Conservative Luau block-balance check. Only reports when an `end` deficit
 * is unambiguous (missing ends virtually always mean a syntax error); extra
 * `end`s are left to real parsers to avoid false positives from `end` inside
 * identifiers that survived stripping.
 *
 * NOTE: `do` is deliberately NOT an opener: in `for...do` / `while...do` it
 * belongs to the loop statement, and standalone `do...end` blocks are rare
 * enough that missing their `end` is better caught by rojo/stylua.
 */
function checkBlockBalance(src: string): string | null {
  const clean = stripLuauNoise(src);
  const tokens = clean.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  const openers = new Set(["function", "if", "for", "while"]);
  let depth = 0;
  for (const t of tokens) {
    if (openers.has(t)) depth++;
    else if (t === "end") depth--;
    else if (t === "repeat") depth++;
    else if (t === "until" && depth > 0) depth--;
  }
  if (depth > 0) {
    return `unbalanced blocks: ${depth} unclosed function/if/for/while (missing "end")`;
  }
  return null;
}

async function tryExternalLuauCheck(
  file: string,
  timeoutMs: number
): Promise<{ checked: boolean; ok: boolean; message?: string }> {
  const candidates: Array<{ bin: string; args: (f: string) => string[]; label: string }> = [
    { bin: "stylua", args: (f) => ["--check", f], label: "stylua --check" },
    { bin: "lune", args: (f) => ["check", f], label: "lune check" },
    { bin: "luau-analyze", args: (f) => [f], label: "luau-analyze" },
  ];
  for (const c of candidates) {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(execFile);
      await run(c.bin, c.args(file), { timeout: timeoutMs, encoding: "utf8" });
      return { checked: true, ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string | number; stderr?: string; stdout?: string };
      if (err.code === "ENOENT" || /command not found|not recognized|ENOENT/i.test(String(err.code ?? "") + (err.stderr ?? ""))) {
        continue; // tool not installed — try next
      }
      return {
        checked: true,
        ok: false,
        message: `${c.label}: ${((err.stderr ?? err.stdout ?? err.code ?? "") as string).toString().slice(0, 500)}`,
      };
    }
  }
  return { checked: false, ok: true };
}

export async function validateRobloxProject(
  projectDir: string,
  opts?: ValidateRobloxOptions
): Promise<RobloxValidationResult> {
  const start = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const checks: RobloxCheck[] = [];
  const affectedFiles: string[] = [];
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let command = "roblox-validate (structural)";

  const fail = (
    reason: string,
    cmd?: string
  ): RobloxValidationResult => ({
    status: "FAIL",
    command: cmd ?? command,
    exitCode: 1,
    stdout: stdoutLines.join("\n").slice(0, 4000),
    stderr: [...stderrLines, reason].join("\n").slice(0, 4000),
    durationMs: Date.now() - start,
    checks,
    reason,
    affectedFiles: [...new Set(affectedFiles)],
  });

  // 0. Must be a Rojo project at all.
  if (!(await isRobloxProjectDir(projectDir))) {
    checks.push({ name: "rojo-project-present", passed: false, message: "missing default.project.json" });
    return fail("Not a Roblox/Rojo project: default.project.json is missing.");
  }
  checks.push({ name: "rojo-project-present", passed: true });
  affectedFiles.push("default.project.json");

  // 1. default.project.json parses and has a DataModel tree.
  let projectJson: { name?: string; tree?: unknown };
  try {
    projectJson = JSON.parse(await fs.readFile(path.join(projectDir, "default.project.json"), "utf8"));
  } catch (e) {
    checks.push({
      name: "project-json-parse",
      passed: false,
      message: e instanceof Error ? e.message : String(e),
    });
    return fail(`default.project.json is malformed: ${e instanceof Error ? e.message : e}`);
  }
  checks.push({ name: "project-json-parse", passed: true });
  if (!projectJson.tree || typeof projectJson.tree !== "object") {
    checks.push({ name: "project-tree", passed: false, message: "missing tree" });
    return fail('default.project.json has no "tree" object.');
  }
  checks.push({ name: "project-tree", passed: true });

  // 2. Every $path mapping resolves on disk (malformed Rojo mappings FAIL).
  const mappings = collectPathMappings(projectJson.tree, "tree");
  if (mappings.length === 0) {
    checks.push({ name: "rojo-mappings", passed: false, message: "no $path mappings" });
    return fail("default.project.json tree contains no $path mappings.");
  }
  let mappingsOk = true;
  for (const m of mappings) {
    const target = path.join(projectDir, m.fsPath);
    if (!(await pathExists(target))) {
      mappingsOk = false;
      const msg = `Rojo mapping "${m.jsonPath}" points at missing "${m.fsPath}"`;
      checks.push({ name: `rojo-mapping:${m.jsonPath}`, passed: false, message: msg });
      stderrLines.push(msg);
    }
  }
  checks.push({
    name: "rojo-mappings",
    passed: mappingsOk,
    message: mappingsOk ? `${mappings.length} mapping(s) resolve` : "some mappings are dangling",
  });
  if (!mappingsOk) {
    return fail("Malformed Rojo mappings: default.project.json references paths that do not exist.");
  }
  stdoutLines.push(`mappings: ${mappings.length} $path target(s) resolve`);

  // 3. Required source services exist.
  const required = ["src/ServerScriptService", "src/ReplicatedStorage"];
  let servicesOk = true;
  for (const rel of required) {
    if (!(await isDirectory(path.join(projectDir, rel)))) {
      servicesOk = false;
      checks.push({ name: `src-service:${rel}`, passed: false, message: "missing directory" });
      stderrLines.push(`Required source directory missing: ${rel}`);
      affectedFiles.push(rel);
    } else {
      checks.push({ name: `src-service:${rel}`, passed: true });
    }
  }
  // Optional-but-expected services are warnings, not failures.
  for (const rel of ROBLOX_SRC_SERVICES.filter((s) => !required.includes(s))) {
    if (!(await pathExists(path.join(projectDir, rel)))) {
      checks.push({ name: `src-service:${rel}`, passed: true, message: "optional service absent (warning)" });
    } else {
      checks.push({ name: `src-service:${rel}`, passed: true });
    }
  }
  if (!servicesOk) {
    return fail("Invalid project structure: required Roblox source directories are missing.");
  }

  // 4. Luau sources exist; placement conventions + web-leak scan.
  const srcDir = path.join(projectDir, "src");
  const luauFiles = await collectLuauFiles(srcDir);
  if (luauFiles.length === 0) {
    checks.push({ name: "luau-sources", passed: false, message: "no .lua/.luau files under src/" });
    return fail("No Luau sources found under src/.");
  }
  checks.push({ name: "luau-sources", passed: true, message: `${luauFiles.length} file(s)` });
  stdoutLines.push(`luau: ${luauFiles.length} source file(s)`);

  let conventionOk = true;
  for (const full of luauFiles) {
    const rel = path.relative(projectDir, full).replace(/\\/g, "/");
    const base = path.basename(full);
    const inServer = rel.startsWith("src/ServerScriptService/");
    const inClient =
      rel.startsWith("src/StarterPlayer/") ||
      rel.startsWith("src/StarterGui/") ||
      rel.startsWith("src/StarterPack/");
    // Definite misplacements FAIL (a .client.lua under server authority or vice versa).
    if (inServer && base.endsWith(".client.lua")) {
      conventionOk = false;
      const msg = `${rel}: .client.lua must not live under ServerScriptService (server-authoritative boundary)`;
      checks.push({ name: `placement:${rel}`, passed: false, message: msg });
      stderrLines.push(msg);
      affectedFiles.push(rel);
    } else if (inClient && base.endsWith(".server.lua")) {
      conventionOk = false;
      const msg = `${rel}: .server.lua must not live under a client container`;
      checks.push({ name: `placement:${rel}`, passed: false, message: msg });
      stderrLines.push(msg);
      affectedFiles.push(rel);
    }
  }
  checks.push({
    name: "server-client-placement",
    passed: conventionOk,
    message: conventionOk ? "server/client boundaries respected" : "misplaced server/client scripts",
  });
  if (!conventionOk) {
    return fail("Server/client organization violated: scripts are placed in the wrong Roblox container.");
  }

  // 5. Per-file content checks: web leaks (FAIL) + block balance (FAIL when unambiguous).
  let contentOk = true;
  for (const full of luauFiles) {
    const rel = path.relative(projectDir, full).replace(/\\/g, "/");
    let src: string;
    try {
      src = await fs.readFile(full, "utf8");
    } catch (e) {
      contentOk = false;
      const msg = `${rel}: unreadable (${e instanceof Error ? e.message : e})`;
      checks.push({ name: `read:${rel}`, passed: false, message: msg });
      stderrLines.push(msg);
      affectedFiles.push(rel);
      continue;
    }
    for (const p of WEB_LEAK_PATTERNS) {
      if (p.re.test(src)) {
        contentOk = false;
        const msg = `${rel}: looks like browser/TypeScript code (${p.label}) — Roblox projects must be Luau`;
        checks.push({ name: `web-leak:${rel}`, passed: false, message: msg });
        stderrLines.push(msg);
        affectedFiles.push(rel);
        break;
      }
    }
    if (contentOk) {
      const imbalance = checkBlockBalance(src);
      if (imbalance) {
        contentOk = false;
        const msg = `${rel}: ${imbalance}`;
        checks.push({ name: `luau-balance:${rel}`, passed: false, message: msg });
        stderrLines.push(msg);
        affectedFiles.push(rel);
      }
    }
  }
  checks.push({ name: "luau-content", passed: contentOk, message: contentOk ? "no web leaks, blocks balanced" : "content problems found" });
  if (!contentOk) {
    return fail("Luau validation failed: sources contain non-Luau code or unbalanced blocks.");
  }

  // 6. External Luau syntax tools when available (skipped silently otherwise).
  for (const full of luauFiles.slice(0, 25)) {
    const rel = path.relative(projectDir, full).replace(/\\/g, "/");
    const ext = await tryExternalLuauCheck(full, Math.min(15_000, timeoutMs));
    if (ext.checked && !ext.ok) {
      checks.push({ name: `luau-syntax:${rel}`, passed: false, message: ext.message });
      stderrLines.push(`${rel}: ${ext.message}`);
      affectedFiles.push(rel);
      return fail("Luau syntax check failed.", command);
    }
  }
  checks.push({ name: "luau-syntax-tools", passed: true, message: "external checks passed or no tools installed" });

  // 7. `rojo build` when available; missing Rojo is BLOCKED infrastructure.
  if (opts?.runRojoBuild !== false) {
    const resolution = opts?.rojoBin
      ? { found: true as const, bin: opts.rojoBin }
      : await resolveRojoExecutable({ env: opts?.env });
    const rojoBin = "bin" in resolution ? resolution.bin : undefined;
    if (!resolution.found || !rojoBin) {
      const reason =
        "reason" in resolution && typeof resolution.reason === "string"
          ? resolution.reason
          : `${ROBLOX_TOOLCHAIN_ERROR_PREFIX} Rojo not found.`;
      checks.push({ name: "rojo-build", passed: false, message: reason, infra: true });
      return {
        status: "BLOCKED",
        command: "rojo build default.project.json",
        exitCode: 127,
        stdout: stdoutLines.join("\n").slice(0, 4000),
        stderr: reason.slice(0, 4000),
        durationMs: Date.now() - start,
        checks,
        reason,
        affectedFiles: [...new Set(affectedFiles)],
      };
    }
    const outFile = path.join(os.tmpdir(), `roblox-validate-${Date.now()}.rbxlx`);
    const built = await runRojo(["build", "default.project.json", "--output", outFile], {
      cwd: projectDir,
      timeoutMs,
      env: opts?.env,
      bin: rojoBin,
    });
    command = built.command;
    try {
      await fs.rm(outFile, { force: true });
    } catch {
      // best-effort cleanup
    }
    if (!built.ok) {
      checks.push({ name: "rojo-build", passed: false, message: built.stderr.slice(0, 300) });
      stderrLines.push(built.stderr);
      return fail(`rojo build failed: ${built.stderr.slice(0, 500)}`, built.command);
    }
    checks.push({ name: "rojo-build", passed: true, message: "rojo build succeeded" });
    stdoutLines.push(built.stdout);
  }

  return {
    status: "PASS",
    command,
    exitCode: 0,
    stdout: stdoutLines.join("\n").slice(0, 4000),
    stderr: "",
    durationMs: Date.now() - start,
    checks,
    reason: `Roblox/Rojo project valid (${luauFiles.length} Luau file(s), ${mappings.length} mapping(s)).`,
    affectedFiles: [...new Set(affectedFiles)],
  };
}
