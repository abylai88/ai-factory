import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureRojoAvailable,
  ensureRobloxPlaceArtifact,
  defaultArtifactPath,
  artifactSlug,
  artifactFreshness,
  newestSourceMtime,
  type PlaceArtifactOptions,
} from "../place-artifact.js";
import type { RojoRunResult } from "../rojo.js";

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  return dir;
}

const MINIMAL_PROJECT = {
  "default.project.json": JSON.stringify({ name: "ArtifactTest", tree: { $className: "DataModel" } }),
  "src/ServerScriptService/main.server.lua": "print('hi')\n",
};

async function makeFakeBin(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rojo-bin-"));
  const bin = path.join(dir, "rojo");
  await fs.writeFile(bin, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(bin, 0o755);
  return bin;
}

function fakeRunOk(artifactSize = 1234): PlaceArtifactOptions["runFn"] {
  const calls: string[][] = [];
  const fn = async (args: string[], opts: { cwd?: string; bin?: string }) => {
    calls.push(args);
    const outIdx = args.indexOf("--output");
    const out = outIdx >= 0 ? args[outIdx + 1] : path.join(opts.cwd ?? os.tmpdir(), "out.rbxlx");
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, "x".repeat(artifactSize));
    (fn as unknown as { calls: string[][] }).calls = calls;
    return { ok: true, command: `rojo ${args.join(" ")}`, exitCode: 0, stdout: "built", stderr: "", durationMs: 5 };
  };
  return fn as PlaceArtifactOptions["runFn"];
}

function fakeRunFail(stderr = "rojo build failed: bad $path"): PlaceArtifactOptions["runFn"] {
  return async (args) => ({
    ok: false,
    command: `rojo ${args.join(" ")}`,
    exitCode: 1,
    stdout: "",
    stderr,
    durationMs: 5,
  });
}

describe("artifactSlug / defaultArtifactPath", () => {
  it("sanitizes names deterministically", () => {
    expect(artifactSlug("AI Factory Roblox Game")).toBe("ai-factory-roblox-game");
    expect(artifactSlug("My_Place v2!")).toBe("my-place-v2");
    expect(artifactSlug("")).toBe("roblox-place");
  });

  it("is deterministic per project and ends with .rbxlx", () => {
    const a = defaultArtifactPath("/tmp/some-project");
    const b = defaultArtifactPath("/tmp/some-project");
    expect(a).toBe(b);
    expect(a.endsWith(".rbxlx")).toBe(true);
    expect(a).not.toContain("/tmp/some-project/");
  });
});

describe("ensureRojoAvailable", () => {
  it("resolves a fake executable via ROJO_BIN override", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rojo-fake-"));
    const bin = path.join(dir, "rojo");
    await fs.writeFile(bin, "#!/bin/sh\necho 'Rojo 7.7.0'\n", "utf8");
    await fs.chmod(bin, 0o755);
    const r = await ensureRojoAvailable({ env: { ...process.env, ROJO_BIN: bin } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bin).toBe(bin);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports ROJO_UNAVAILABLE for a missing ROJO_BIN target", async () => {
    const r = await ensureRojoAvailable({ env: { ...process.env, ROJO_BIN: "/tmp/definitely-not-here-rojo-xyz" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("ROJO_UNAVAILABLE");
      expect(r.reason).toMatch(/roblox_toolchain:/);
    }
  });
});

describe("ensureRobloxPlaceArtifact", () => {
  it("rejects non-Roblox directories without touching Rojo", async () => {
    const dir = await makeProject({ "package.json": "{}" });
    let ran = false;
    const r = await ensureRobloxPlaceArtifact(dir, {
      runFn: (async () => {
        ran = true;
        return { ok: true, command: "", exitCode: 0, stdout: "", stderr: "", durationMs: 0 };
      }) as PlaceArtifactOptions["runFn"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ROBLOX_ARTIFACT_MISSING");
    expect(ran).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("builds the artifact on first run with evidence", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    const runFn = fakeRunOk(2048);
    const r = await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rebuilt).toBe(true);
      expect(r.fresh).toBe(false);
      expect(r.sizeBytes).toBe(2048);
      expect(r.rojoBin).toMatch(/rojo$/);
      expect((await fs.stat(r.artifactPath)).size).toBe(2048);
      await fs.rm(r.artifactPath, { force: true });
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reuses a fresh artifact without rebuilding", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    let runs = 0;
    const runFn = (async (args: string[], opts: { cwd?: string }) => {
      runs++;
      const out = args[args.indexOf("--output") + 1];
      await fs.writeFile(out, "data");
      return { ok: true, command: "", exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    }) as PlaceArtifactOptions["runFn"];
    const first = await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin() });
    expect(first.ok).toBe(true);
    const second = await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin() });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.rebuilt).toBe(false);
      expect(second.fresh).toBe(true);
    }
    expect(runs).toBe(1);
    if (first.ok) await fs.rm(first.artifactPath, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rebuilds when sources change after the artifact", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    let runs = 0;
    const runFn = (async (args: string[]) => {
      runs++;
      await fs.writeFile(args[args.indexOf("--output") + 1], "data");
      return { ok: true, command: "", exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    }) as PlaceArtifactOptions["runFn"];
    const first = await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin() });
    expect(first.ok).toBe(true);
    // Touch a source file newer than the artifact.
    const src = path.join(dir, "src/ServerScriptService/main.server.lua");
    const future = new Date(Date.now() + 5_000);
    await fs.utimes(src, future, future);
    const second = await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin() });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.rebuilt).toBe(true);
    expect(runs).toBe(2);
    if (first.ok) await fs.rm(first.artifactPath, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("forceRebuild rebuilds even a fresh artifact", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    let runs = 0;
    const runFn = (async (args: string[]) => {
      runs++;
      await fs.writeFile(args[args.indexOf("--output") + 1], "data");
      return { ok: true, command: "", exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    }) as PlaceArtifactOptions["runFn"];
    await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin() });
    const second = await ensureRobloxPlaceArtifact(dir, { runFn, bin: await makeFakeBin(), forceRebuild: true });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.rebuilt).toBe(true);
    expect(runs).toBe(2);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("maps build failures to ROJO_BUILD_FAILED with evidence", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    const r = await ensureRobloxPlaceArtifact(dir, { runFn: fakeRunFail(), bin: await makeFakeBin() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("ROJO_BUILD_FAILED");
      expect(r.reason).toMatch(/roblox_toolchain:/);
      expect(r.buildStderr).toMatch(/bad \$path/);
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports missing Rojo as ROJO_UNAVAILABLE without building", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    let ran = false;
    const r = await ensureRobloxPlaceArtifact(dir, {
      bin: undefined,
      env: { ...process.env, ROJO_BIN: "/tmp/definitely-not-here-rojo-xyz" },
      runFn: (async () => {
        ran = true;
        return { ok: true, command: "", exitCode: 0, stdout: "", stderr: "", durationMs: 0 };
      }) as PlaceArtifactOptions["runFn"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ROJO_UNAVAILABLE");
    expect(ran).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("artifactFreshness / newestSourceMtime", () => {
  it("detects missing and empty artifacts", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    const missing = await artifactFreshness(dir, path.join(dir, "nope.rbxlx"));
    expect(missing.fresh).toBe(false);
    expect(missing.reason).toMatch(/missing/);
    const empty = path.join(dir, "empty.rbxlx");
    await fs.writeFile(empty, "");
    const e = await artifactFreshness(dir, empty);
    expect(e.fresh).toBe(false);
    expect(e.reason).toMatch(/empty/);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("scans sources with a file cap", async () => {
    const dir = await makeProject(MINIMAL_PROJECT);
    const src = await newestSourceMtime(dir);
    expect(src.newestSourceMtimeMs).toBeGreaterThan(0);
    expect(src.filesScanned).toBeGreaterThanOrEqual(2);
    expect(src.truncated).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
