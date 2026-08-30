import type { VisualQaResult, VisualQaCheckResult, VisualQaArtifactRef } from "./mission.js";

export interface VisualQaAdapter {
  run(options: {
    projectId: string;
    projectPath: string;
    runId: string;
  }): Promise<VisualQaResult>;
}

export class NoopVisualQaAdapter implements VisualQaAdapter {
  async run(): Promise<VisualQaResult> {
    const now = new Date().toISOString();
    return {
      status: "skipped",
      passed: false,
      checks: 0,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };
  }
}
