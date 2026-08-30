import path from "node:path";
import { PlaywrightVisualQAService } from "../../visual-office/visual-qa/src/service.js";
import type { VisualQaResult, VisualQaArtifactRef, VisualQaCheckResult } from "./mission.js";
import type { VisualQaAdapter } from "./visual-qa-adapter.js";

export interface PlaywrightVisualQaAdapterOptions {
  factoryRoot: string;
  artifactsDir?: string;
}

export class PlaywrightVisualQaAdapter implements VisualQaAdapter {
  private readonly service: PlaywrightVisualQAService;
  private readonly factoryRoot: string;

  constructor(options: PlaywrightVisualQaAdapterOptions) {
    this.factoryRoot = options.factoryRoot;
    this.service = new PlaywrightVisualQAService({
      factoryRoot: options.factoryRoot,
      artifactsDir: options.artifactsDir,
    });
  }

  async init(): Promise<void> {
    await this.service.init();
  }

  async run(options: {
    projectId: string;
    projectPath: string;
    runId: string;
  }): Promise<VisualQaResult> {
    const startedAt = new Date().toISOString();

    try {
      const qaRun = await this.service.run({
        projectId: options.projectId,
        traceOnFailure: true,
      });

      // Poll for completion
      const maxWaitMs = 120_000;
      const pollIntervalMs = 2_000;
      const deadline = Date.now() + maxWaitMs;

      while (Date.now() < deadline) {
        if (qaRun.status !== "queued" && qaRun.status !== "running") {
          break;
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      const finishedAt = new Date().toISOString();
      const passed = qaRun.status === "passed";

      const checkDetails: VisualQaCheckResult[] = qaRun.checks.map((c) => ({
        name: c.name,
        viewport: c.viewport,
        status: c.status as "passed" | "failed",
        message: c.message,
      }));

      const artifacts: VisualQaArtifactRef[] = qaRun.artifacts.map((a) => ({
        id: a.id,
        type: a.type as "screenshot" | "trace" | "report",
        label: a.label,
      }));

      const errors: string[] = qaRun.errors.map((e) => `${e.type}: ${e.message}`);

      return {
        status: passed ? "passed" : "failed",
        passed,
        checks: checkDetails.length,
        failedChecks: checkDetails.filter((c) => c.status === "failed").length,
        checkDetails,
        errors,
        artifacts,
        runId: qaRun.runId,
        startedAt,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      return {
        status: "failed",
        passed: false,
        checks: 0,
        failedChecks: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        artifacts: [],
        startedAt,
        finishedAt,
      };
    }
  }
}
