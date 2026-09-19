/**
 * Hermes mission status contract.
 *
 * Hermes is NOT a core dependency and NOT a second orchestrator — it is a
 * thin external view over Mission state. This module is the single place
 * that maps internal MissionStatus values to the externally representable
 * Hermes stage set, plus the progress/evidence fields Hermes may display.
 * No secrets, tokens, or file contents cross this boundary.
 */

export const HERMES_STAGES = [
  "queued",
  "planning",
  "researching",
  "building",
  "testing",
  "repairing",
  "blocked",
  "passed",
  "failed",
] as const;
export type HermesStage = (typeof HERMES_STAGES)[number];

export interface HermesMissionStatus {
  missionId: string;
  project?: string;
  stage: HermesStage;
  activeRole?: string;
  task?: string;
  completedDelegations: number;
  totalDelegations: number;
  failureCategory?: string;
  retryCount: number;
  evidenceRefs: string[];
  updatedAt: string;
}

const INTERNAL_TO_STAGE: Record<string, HermesStage> = {
  draft: "queued",
  planned: "planning",
  approved: "queued",
  running: "building",
  auditing: "testing",
  repairing: "repairing",
  "diagnosis-planned": "repairing",
  completed: "passed",
  failed: "failed",
  blocked: "blocked",
  cancelled: "failed",
};

export function toHermesStage(internal: string, opts?: { researching?: boolean; testing?: boolean }): HermesStage {
  if (opts?.researching && internal === "running") return "researching";
  if (opts?.testing && internal === "running") return "testing";
  return INTERNAL_TO_STAGE[internal] ?? "blocked";
}

export function buildHermesStatus(input: {
  missionId: string;
  internalStatus: string;
  project?: string;
  activeRole?: string;
  task?: string;
  completedDelegations?: number;
  totalDelegations?: number;
  failureCategory?: string;
  retryCount?: number;
  evidenceRefs?: string[];
  researching?: boolean;
  testing?: boolean;
}): HermesMissionStatus {
  return {
    missionId: input.missionId,
    project: input.project,
    stage: toHermesStage(input.internalStatus, input),
    activeRole: input.activeRole,
    task: input.task?.slice(0, 300),
    completedDelegations: input.completedDelegations ?? 0,
    totalDelegations: input.totalDelegations ?? 0,
    failureCategory: input.failureCategory,
    retryCount: input.retryCount ?? 0,
    evidenceRefs: (input.evidenceRefs ?? []).slice(0, 10),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build a Hermes status from a MissionState status summary (see
 * MissionState.getStatusSummary()). Works identically before and after a
 * process restart — everything it needs is in the persisted snapshot.
 * No secrets, tokens, or file contents cross this boundary.
 */
export function missionSummaryToHermesStatus(summary: {
  missionId: string;
  status: string;
  project?: string;
  engine?: string;
  completedDelegations: number;
  totalDelegations: number;
  activeRole?: string;
  activeTask?: string;
  failureSummary?: string;
  repairAttempts: number;
  evidenceRefs: string[];
}): HermesMissionStatus {
  const researching = summary.activeRole === "Researcher";
  const testing = summary.activeRole === "QA";
  return buildHermesStatus({
    missionId: summary.missionId,
    internalStatus: summary.status,
    project: summary.project ?? summary.engine,
    activeRole: summary.activeRole,
    task: summary.activeTask,
    completedDelegations: summary.completedDelegations,
    totalDelegations: summary.totalDelegations,
    failureCategory: summary.failureSummary,
    retryCount: summary.repairAttempts,
    evidenceRefs: summary.evidenceRefs,
    researching,
    testing,
  });
}
