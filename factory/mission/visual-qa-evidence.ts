import type { VisualQaResult } from "./mission.js";

export interface VisualQaEvidence {
  status: "passed" | "failed" | "skipped";
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  errorCount: number;
  artifactCount: number;
  artifacts: Array<{ id: string; type: string; label: string }>;
  startedAt: string;
  finishedAt: string;
}

export function normalizeVisualQaEvidence(result: VisualQaResult): VisualQaEvidence {
  return {
    status: result.status,
    passed: result.passed,
    totalChecks: result.checks,
    passedChecks: result.checks - result.failedChecks,
    failedChecks: result.failedChecks,
    errorCount: result.errors.length,
    artifactCount: result.artifacts.length,
    artifacts: result.artifacts.map((a) => ({ id: a.id, type: a.type, label: a.label })),
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  };
}
