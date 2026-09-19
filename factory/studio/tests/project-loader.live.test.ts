import { describe, it, expect } from "vitest";
import {
  loadProject,
  createProjectLoaderOps,
  type ProjectLoadConfig,
} from "../project-loader.js";
import { createStudioBridge } from "../mcp-bridge.js";

/**
 * LIVE integration harness (opt-in only).
 *
 * Run with:
 *   LIVE_STUDIO_INTEGRATION=1 npx vitest run factory/studio/tests/project-loader.live.test.ts
 *
 * Default CI/unit runs NEVER execute this file (describe.skip unless the env
 * flag is set), so ordinary tests stay offline/mockable.
 *
 * Safety policy (single Studio):
 *  - If any connected instance already exists, the harness performs
 *    READ-ONLY observation (status + instances + one structure probe) and
 *    launches nothing, closes nothing, starts no playtest.
 *  - Only when zero instances are connected does it launch exactly ONE
 *    baseplate, observe launch → process → place → ready, then close it.
 *  - No game content is modified. No playtest is started.
 */
const LIVE = process.env.LIVE_STUDIO_INTEGRATION === "1";

const LIVE_CONFIG: Partial<ProjectLoadConfig> = {
  launchAckTimeoutMs: 30_000,
  studioStartupTimeoutMs: 120_000,
  pluginConnectTimeoutMs: 90_000,
  placeLoadTimeoutMs: 180_000,
  slowLoadThresholdMs: 60_000,
  maxTotalTimeoutMs: 540_000,
  pollIntervalMs: 5_000,
  expectedPlaceName: "Baseplate",
  source: "baseplate",
  placeNamePrefixMatch: true,
};

describe.skipIf(!LIVE)("project-loader live (baseplate, opt-in)", () => {
  it(
    "observes one controlled baseplate load lifecycle",
    async () => {
      if (!process.env.STUDIO_BRIDGE_URL) {
        console.warn("LIVE skipped: STUDIO_BRIDGE_URL is not set");
        return;
      }
      const bridge = createStudioBridge();
      const ops = createProjectLoaderOps(bridge);

      // 1. Inspect current status first — never blind-launch.
      const pre = await ops.manageStatus();
      console.log("LIVE pre-status:", JSON.stringify(pre.data ?? pre.message).slice(0, 1_000));
      const preInstances = await ops.getConnectedInstances();
      const preList = ((preInstances.data ?? {}) as { instances?: unknown[] }).instances;
      if (Array.isArray(preList) && preList.length > 0) {
        // Studio busy: read-only observation only.
        console.log(`LIVE read-only: ${preList.length} instance(s) already connected; launching nothing.`);
        const probe = await ops.getProjectStructure({ path: "game", maxDepth: 1 });
        const keys = (() => {
          try {
            return Object.keys((probe.data ?? {}) as Record<string, unknown>);
          } catch {
            return [];
          }
        })();
        console.log("LIVE structure probe ok:", probe.ok, "keys:", JSON.stringify(keys), "msg:", probe.message.slice(0, 200));
        expect(probe.ok).toBe(true);
        // Full loader reuse path on the live instance (no launch, no close).
        const reuse = await loadProject(ops, "baseplate", LIVE_CONFIG);
        console.log("LIVE reuse result:", reuse.state, reuse.message);
        console.log("LIVE reuse transitions:", JSON.stringify(reuse.evidence.transitions));
        expect(reuse.ok).toBe(true);
        expect(reuse.state).toBe("PLACE_READY");
        return;
      }

      // 2. Zero instances: launch exactly one baseplate via the loader.
      const startedAt = Date.now();
      const result = await loadProject(ops, "baseplate", LIVE_CONFIG);
      const wallMs = Date.now() - startedAt;
      console.log("LIVE result:", result.state, result.message);
      console.log("LIVE transitions:", JSON.stringify(result.evidence.transitions));
      console.log(
        "LIVE diagnostics:",
        JSON.stringify({ ...result.evidence.diagnostics, connectedInstances: `[${result.evidence.diagnostics.connectedInstances.length} instance(s)]` })
      );
      console.log("LIVE advisory:", JSON.stringify(result.evidence.advisoryMessages));
      console.log("LIVE wall ms:", wallMs);

      // 3. Cleanup: close what we launched (baseplate only).
      try {
        const id = result.evidence.instanceId;
        if (id) {
          await ops.manageInstance({ action: "close", instance_id: id });
          console.log("LIVE closed instance:", id);
        }
      } catch (e) {
        console.warn("LIVE close failed (best effort):", e instanceof Error ? e.message : e);
      }

      expect(result.ok).toBe(true);
      expect(result.state).toBe("PLACE_READY");
    },
    600_000
  );
});
