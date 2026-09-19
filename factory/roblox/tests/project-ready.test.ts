import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ensureProjectReady,
  readyCodeToFailureCategory,
} from "../project-ready.js";
import type { StudioProjectLoaderOps } from "../../studio/project-loader.js";
import type { PlaceArtifactOptions } from "../place-artifact.js";

async function makeFakeBin(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rojo-bin-"));
  const bin = path.join(dir, "rojo");
  await fs.writeFile(bin, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(bin, 0o755);
  return bin;
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ready-test-"));
  await fs.writeFile(
    path.join(dir, "default.project.json"),
    JSON.stringify({ name: "ReadyTest", tree: { $className: "DataModel" } }),
    "utf8"
  );
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "a.lua"), "print(1)\n", "utf8");
  return dir;
}

function okResult(message = "ok") {
  return { ok: true, infra: false, message, data: {}, stdout: "", stderr: "" };
}

function readyLoaderOps(): StudioProjectLoaderOps {
  return {
    manageInstance: async () => okResult("launch requested"),
    manageStatus: async () =>
      okResult("status") as unknown as ReturnType<StudioProjectLoaderOps["manageStatus"]>,
    getConnectedInstances: async () => ({
      ...okResult("instances"),
      data: { instances: [{ id: "i1", placeName: "Ready", peers: { edit: "p1" } }], multiplayerGroups: [] },
    }),
    getProjectStructure: async () => ({
      ...okResult("structure"),
      data: { root: "game", children: ["Workspace"] },
    }),
    getRuntimeLogs: async () => okResult("logs"),
  };
}

function fakeBuildOk(): PlaceArtifactOptions["runFn"] {
  return (async (args: string[]) => {
    await fs.mkdir(path.dirname(args[args.indexOf("--output") + 1]), { recursive: true });
    await fs.writeFile(args[args.indexOf("--output") + 1], "place-bytes");
    return { ok: true, command: "", exitCode: 0, stdout: "", stderr: "", durationMs: 2 };
  }) as PlaceArtifactOptions["runFn"];
}

describe("ensureProjectReady", () => {
  it("provisions, loads, and returns PLACE_READY with a bridge", async () => {
    const dir = await makeProject();
    const ops = readyLoaderOps();
    const r = await ensureProjectReady(dir, {
      rojoBin: await makeFakeBin(),
      loaderOps: ops,
      artifactOptions: { runFn: fakeBuildOk() },
      loadConfig: { pollIntervalMs: 10, maxTotalTimeoutMs: 5_000, expectedPlaceName: "Ready" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state).toBe("PLACE_READY");
      expect(r.bridge).toBeDefined();
      expect(r.artifact.ok).toBe(true);
      await fs.rm(r.artifact.artifactPath, { force: true });
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("skipStudio returns ARTIFACT_READY without touching Studio", async () => {
    const dir = await makeProject();
    let loaderTouched = false;
    const ops = readyLoaderOps();
    const wrapped: StudioProjectLoaderOps = {
      ...ops,
      getConnectedInstances: async () => {
        loaderTouched = true;
        return ops.getConnectedInstances();
      },
    };
    const r = await ensureProjectReady(dir, {
      rojoBin: await makeFakeBin(),
      skipStudio: true,
      loaderOps: wrapped,
      artifactOptions: { runFn: fakeBuildOk() },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state).toBe("ARTIFACT_READY");
      expect(r.bridge).toBeUndefined();
    }
    expect(loaderTouched).toBe(false);
    if (r.ok) await fs.rm(r.artifact.artifactPath, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("missing project maps to ROBLOX_ARTIFACT_MISSING without Studio", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ready-empty-"));
    let loaderTouched = false;
    const r = await ensureProjectReady(dir, {
      rojoBin: await makeFakeBin(),
      loaderOps: {
        ...readyLoaderOps(),
        getConnectedInstances: async () => {
          loaderTouched = true;
          throw new Error("must not be called");
        },
      },
      artifactOptions: { runFn: fakeBuildOk() },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ROBLOX_ARTIFACT_MISSING");
    expect(loaderTouched).toBe(false);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("maps loader LOAD_TIMEOUT to PROJECT_LOAD_TIMEOUT", async () => {
    const dir = await makeProject();
    const ops = readyLoaderOps();
    ops.getConnectedInstances = async () => ({
      ok: true,
      infra: false,
      message: "ok",
      data: { instances: [], multiplayerGroups: [] },
      stdout: "",
      stderr: "",
    });
    const r = await ensureProjectReady(dir, {
      rojoBin: await makeFakeBin(),
      loaderOps: ops,
      artifactOptions: { runFn: fakeBuildOk() },
      loadConfig: { pollIntervalMs: 10, maxTotalTimeoutMs: 300, studioStartupTimeoutMs: 100 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROJECT_LOAD_TIMEOUT");
    if (r.artifact?.ok) await fs.rm(r.artifact.artifactPath, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("maps loader DISCONNECTED to MCP/STUDIO codes by process health", async () => {
    const dir = await makeProject();
    const mk = (processAlive: boolean, expected: string) => (async () => {
      const ops = readyLoaderOps();
      ops.getConnectedInstances = async () => ({ ok: false, infra: true, message: "down", stdout: "", stderr: "down" });
      ops.manageStatus = async () => ({
        ok: true,
        infra: false,
        message: "ok",
        data: processAlive
          ? { managed: [{ launch_id: "L", state: "launching", connected: false, process_running: true }], connected: [] }
          : { managed: [], connected: [] },
        stdout: "",
        stderr: "",
      });
      const r = await ensureProjectReady(dir, {
        rojoBin: await makeFakeBin(),
        loaderOps: ops,
        artifactOptions: { runFn: fakeBuildOk() },
        loadConfig: { pollIntervalMs: 10, maxTotalTimeoutMs: 3_000, studioStartupTimeoutMs: 100 },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(expected);
      if (r.artifact?.ok) await fs.rm(r.artifact.artifactPath, { force: true }).catch(() => {});
    })();
    await mk(true, "MCP_UNAVAILABLE");
    await mk(false, "STUDIO_UNAVAILABLE");
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("readyCodeToFailureCategory", () => {
  it("maps codes onto existing triage categories", () => {
    expect(readyCodeToFailureCategory("ROJO_UNAVAILABLE")).toBe("tool_unavailable");
    expect(readyCodeToFailureCategory("STUDIO_UNAVAILABLE")).toBe("tool_unavailable");
    expect(readyCodeToFailureCategory("MCP_UNAVAILABLE")).toBe("tool_unavailable");
    expect(readyCodeToFailureCategory("PROJECT_LOAD_TIMEOUT")).toBe("tool_unavailable");
    expect(readyCodeToFailureCategory("PROJECT_NOT_READY")).toBe("tool_unavailable");
    expect(readyCodeToFailureCategory("ROJO_BUILD_FAILED")).toBe("build_config");
    expect(readyCodeToFailureCategory("ROBLOX_ARTIFACT_MISSING")).toBe("roblox_structure");
  });
});
