import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchProject } from "../src/project-launcher.js";
import { runTrafficDodgeSmoke } from "../src/smoke-runner.js";
import { ArtifactStore } from "../src/artifact-store.js";
import { resolveProjectPath, loadProjectManifest } from "../src/project-registry.js";

const factoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const artifactsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../artifacts/playwright");

test.describe("Traffic Dodge smoke", () => {
  test("menu boot across default viewports", async () => {
    const manifest = await loadProjectManifest("traffic-dodge");
    expect(manifest).toBeTruthy();
    const projectPath = resolveProjectPath(factoryRoot, manifest!);
    expect(projectPath).toBeTruthy();

    const launched = await launchProject({
      projectPath: projectPath!,
      type: manifest!.launch.type,
      directory: manifest!.launch.directory,
      port: manifest!.launch.port,
      healthCheckPath: manifest!.launch.healthCheckPath
    });

    const store = new ArtifactStore(artifactsDir);
    await store.init();
    const runId = `playwright-${Date.now()}`;

    try {
      for (const viewport of [
        { label: "1280x720", width: 1280, height: 720 },
        { label: "1366x768", width: 1366, height: 768 },
        { label: "1920x1080", width: 1920, height: 1080 }
      ]) {
        const result = await runTrafficDodgeSmoke({
          baseUrl: launched.baseUrl,
          viewport,
          runId,
          artifactStore: store,
          traceOnFailure: true
        });
        expect(result.passed, `${viewport.label} failed: ${result.errors[0]?.message ?? result.checks.find(c => c.status === "failed")?.message}`).toBe(true);
      }
    } finally {
      await launched.stop();
    }
  });
});
