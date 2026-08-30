import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactStore } from "../visual-qa/src/artifact-store.js";
import { isValidProjectId, loadProjectManifest } from "../visual-qa/src/project-registry.js";
import { isValidViewportLabel, parseViewportLabel, resolveViewports } from "../visual-qa/src/viewports.js";
import { VisualQaRunRequestSchema } from "../shared/src/index.js";
import { createApp } from "../backend/src/app.js";

describe("Visual QA viewports", () => {
  it("parses valid viewport labels", () => {
    expect(parseViewportLabel("1280x720")).toEqual({ label: "1280x720", width: 1280, height: 720 });
    expect(isValidViewportLabel("1920x1080")).toBe(true);
    expect(parseViewportLabel("bad")).toBeUndefined();
    expect(parseViewportLabel("99999x720")).toBeUndefined();
  });

  it("falls back to defaults for malformed viewport lists", () => {
    const viewports = resolveViewports(["bad", "1280x720"]);
    expect(viewports).toHaveLength(1);
    expect(viewports[0].label).toBe("1280x720");
  });
});

describe("Visual QA project allowlist", () => {
  it("accepts only safe project ids", () => {
    expect(isValidProjectId("traffic-dodge")).toBe(true);
    expect(isValidProjectId("../etc/passwd")).toBe(false);
    expect(isValidProjectId("")).toBe(false);
  });

  it("loads traffic dodge manifest", async () => {
    const manifest = await loadProjectManifest("traffic-dodge");
    expect(manifest?.id).toBe("traffic-dodge");
    expect(manifest?.launch.type).toBe("static");
  });
});

describe("Artifact store safety", () => {
  it("rejects invalid artifact ids and resolves only stored artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vo-artifacts-"));
    const store = new ArtifactStore(root);
    await store.init();
    expect(store.isValidArtifactId("art_abc")).toBe(false);
    const artifact = await store.saveBinary("run-test", "1280x720", "menu", Buffer.from("png"), "screenshot");
    expect(store.isValidArtifactId(artifact.id)).toBe(true);
    const resolved = await store.resolveArtifactPath(artifact.id);
    expect(resolved?.absolute.endsWith("menu.png")).toBe(true);
    expect(await store.resolveArtifactPath("art_notfound000000000000")).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});

describe("Visual QA API validation", () => {
  it("rejects malformed POST bodies and shell-like payloads", async () => {
    const app = createApp({ startMonitor: false });
    const invalid = await app.inject({ method: "POST", url: "/api/visual-qa/runs", payload: { projectId: "../evil" } });
    expect(invalid.statusCode).toBe(400);
    const shell = await app.inject({ method: "POST", url: "/api/visual-qa/runs", payload: { projectId: "traffic-dodge", command: "rm -rf /" } });
    expect(shell.statusCode).toBe(400);
    await app.close();
  });

  it("validates run request schema", () => {
    expect(VisualQaRunRequestSchema.safeParse({ projectId: "traffic-dodge", viewports: ["1280x720"] }).success).toBe(true);
    expect(VisualQaRunRequestSchema.safeParse({ projectId: "traffic-dodge", viewports: ["rm -rf"] }).success).toBe(false);
  });

  it("serves visual qa status and blocks unknown artifacts", async () => {
    const app = createApp({ startMonitor: false });
    await app.ready();
    const status = await app.inject("/api/visual-qa/status");
    expect(status.statusCode).toBe(200);
    expect(JSON.parse(status.body).visualQa.available).toBe(true);
    expect((await app.inject("/api/artifacts/art_invalid")).statusCode).toBe(404);
    await app.close();
  });
});
