import { z } from "zod";
import { randomUUID } from "node:crypto";

export const MissionStatusSchema = z.enum([
  "draft",
  "planned",
  "approved",
  "running",
  "auditing",
  "repairing",
  "completed",
  "failed",
  "blocked",
  "cancelled"
]);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const MissionContextSchema = z.object({
  projectId: z.string().optional(),
  engine: z.string().optional(),
  stack: z.string().optional(),
  template: z.string().optional(),
  workspace: z.string().optional(),
  existingPipelineId: z.string().optional(),
  requiresVisualQa: z.boolean().optional(),
});
export type MissionContext = z.infer<typeof MissionContextSchema>;

export const MissionConstraintsSchema = z.object({
  maxRepairs: z.number().int().positive().default(3),
  maxDelegations: z.number().int().positive().default(20),
  allowedPipelines: z.array(z.enum(["game", "engineering"])).default(["game", "engineering"]),
  requireApproval: z.boolean().default(false),
});
export type MissionConstraints = z.infer<typeof MissionConstraintsSchema>;

// ─── Phase 8A: Visual QA ─────────────────────────────────────────────

export const VisualQaArtifactRefSchema = z.object({
  id: z.string(),
  type: z.enum(["screenshot", "trace", "report"]),
  label: z.string(),
});
export type VisualQaArtifactRef = z.infer<typeof VisualQaArtifactRefSchema>;

export const VisualQaCheckResultSchema = z.object({
  name: z.string(),
  viewport: z.string(),
  status: z.enum(["passed", "failed"]),
  message: z.string().optional(),
});
export type VisualQaCheckResult = z.infer<typeof VisualQaCheckResultSchema>;

export const VisualQaResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped"]),
  passed: z.boolean(),
  checks: z.number().int().nonnegative(),
  failedChecks: z.number().int().nonnegative(),
  checkDetails: z.array(VisualQaCheckResultSchema).optional(),
  errors: z.array(z.string()),
  artifacts: z.array(VisualQaArtifactRefSchema),
  runId: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string(),
});
export type VisualQaResult = z.infer<typeof VisualQaResultSchema>;

export const MissionSchema = z.object({
  id: z.string(),
  goal: z.string().min(1),
  context: MissionContextSchema.optional(),
  constraints: MissionConstraintsSchema.optional(),
  status: MissionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  planId: z.string().optional(),
  currentDelegationIndex: z.number().int().nonnegative().default(0),
  visualQa: VisualQaResultSchema.optional(),
});
export type Mission = z.infer<typeof MissionSchema>;

export const DelegationStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "skipped",
  "blocked"
]);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

export const DelegationSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  objectiveId: z.string(),
  title: z.string(),
  description: z.string(),
  pipelineType: z.enum(["game", "engineering"]),
  stepIds: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).default([]),
  parallelizable: z.boolean().default(false),
  acceptanceCriteria: z.array(z.string()).default([]),
  status: DelegationStatusSchema,
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  pipelineId: z.string().optional(),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type Delegation = z.infer<typeof DelegationSchema>;

export const ObjectiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  delegations: z.array(z.string()),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const RiskSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().optional(),
});
export type Risk = z.infer<typeof RiskSchema>;

export const ValidationGateSchema = z.object({
  id: z.string(),
  delegationId: z.string(),
  criteria: z.array(z.string()),
});
export type ValidationGate = z.infer<typeof ValidationGateSchema>;

export const ExecutionPlanSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  objectives: z.array(ObjectiveSchema),
  delegations: z.array(DelegationSchema),
  risks: z.array(RiskSchema),
  validationGates: z.array(ValidationGateSchema),
  createdAt: z.string(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const AgentResultSchema = z.object({
  delegationId: z.string(),
  pipelineId: z.string().optional(),
  status: z.enum(["passed", "failed", "blocked"]),
  output: z.string(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
  readOnly: z.boolean().optional(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const AcceptanceCriteriaResultSchema = z.object({
  criterion: z.string(),
  passed: z.boolean(),
  evidence: z.string().optional(),
});
export type AcceptanceCriteriaResult = z.infer<typeof AcceptanceCriteriaResultSchema>;

export const AuditResultSchema = z.object({
  delegationId: z.string(),
  status: z.enum(["PASS", "FAIL"]),
  summary: z.string(),
  findings: z.array(z.string()),
  acceptanceCriteriaResults: z.array(AcceptanceCriteriaResultSchema),
  recommendedRepair: z.object({
    description: z.string(),
    focusAreas: z.array(z.string()),
  }).optional(),
});
export type AuditResult = z.infer<typeof AuditResultSchema>;

export const RepairPlanSchema = z.object({
  delegationId: z.string(),
  description: z.string(),
  focusAreas: z.array(z.string()),
  maxIterations: z.number().int().positive().default(3),
  iteration: z.number().int().nonnegative().default(0),
});
export type RepairPlan = z.infer<typeof RepairPlanSchema>;

export const MissionEventSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  missionId: z.string(),
  type: z.enum([
    "mission.created",
    "mission.planned",
    "mission.approved",
    "mission.started",
    "delegation.created",
    "delegation.started",
    "delegation.completed",
    "mission.auditing",
    "mission.audit.passed",
    "mission.audit.failed",
    "mission.repairing",
    "mission.completed",
    "mission.failed",
    "mission.visual_qa.started",
    "mission.visual_qa.completed",
    "mission.visual_qa.failed",
    "mission.visual_qa.skipped",
  ]),
  payload: z.record(z.string(), z.unknown()),
});
export type MissionEvent = z.infer<typeof MissionEventSchema>;

// ─── Phase 7: Controlled Code + Build Execution ──────────────────────

export const CodingOperationSchema = z.object({
  projectId: z.string(),
  file: z.string(),
  operation: z.enum(["read", "replace"]),
  oldString: z.string().optional(),
  newString: z.string().optional(),
  field: z.string().optional(),
  value: z.string().optional(),
});
export type CodingOperation = z.infer<typeof CodingOperationSchema>;

export const BuildResultSchema = z.object({
  command: z.string(),
  status: z.enum(["success", "failure"]),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().nonnegative(),
});
export type BuildResult = z.infer<typeof BuildResultSchema>;

export const CodingResultSchema = z.object({
  projectId: z.string(),
  file: z.string(),
  operation: z.string(),
  beforeContent: z.string(),
  afterContent: z.string(),
  fieldChanged: z.string().optional(),
  oldValue: z.string().optional(),
  newValue: z.string().optional(),
});
export type CodingResult = z.infer<typeof CodingResultSchema>;

export interface DelegationMetadata {
  role?: "coder" | "builder" | "researcher" | "auditor";
  codingOperation?: CodingOperation;
  buildCommand?: string;
  projectId?: string;
  protectedPaths?: string[];
  allowedProjectRoot?: string;
}

export interface MissionEventSink {
  publish(event: Omit<MissionEvent, "id" | "occurredAt">): MissionEvent;
}

export function createMission(goal: string, context?: MissionContext, constraints?: MissionConstraints): Mission {
  if (!goal || goal.trim().length === 0) {
    throw new Error("Mission goal must be a non-empty string");
  }
  const now = new Date().toISOString();
  return {
    id: `mission-${randomUUID().slice(0, 8)}`,
    goal,
    context,
    constraints: MissionConstraintsSchema.parse(constraints ?? {}),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    currentDelegationIndex: 0,
  };
}

export function createExecutionPlan(mission: Mission, objectives: Objective[], delegations: Delegation[], risks: Risk[], validationGates: ValidationGate[]): ExecutionPlan {
  return {
    id: `plan-${randomUUID().slice(0, 8)}`,
    missionId: mission.id,
    objectives,
    delegations,
    risks,
    validationGates,
    createdAt: new Date().toISOString(),
  };
}

export function createDelegation(
  missionId: string,
  objectiveId: string,
  title: string,
  description: string,
  pipelineType: "game" | "engineering",
  options?: {
    stepIds?: string[];
    dependsOn?: string[];
    parallelizable?: boolean;
    acceptanceCriteria?: string[];
  }
): Delegation {
  return {
    id: `del-${randomUUID().slice(0, 8)}`,
    missionId,
    objectiveId,
    title,
    description,
    pipelineType,
    stepIds: options?.stepIds,
    dependsOn: options?.dependsOn ?? [],
    parallelizable: options?.parallelizable ?? false,
    acceptanceCriteria: options?.acceptanceCriteria ?? [],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

export function createAuditResult(
  delegationId: string,
  status: "PASS" | "FAIL",
  summary: string,
  findings: string[],
  acceptanceCriteriaResults: AcceptanceCriteriaResult[],
  recommendedRepair?: { description: string; focusAreas: string[] }
): AuditResult {
  return {
    delegationId,
    status,
    summary,
    findings,
    acceptanceCriteriaResults,
    recommendedRepair,
  };
}

export function createRepairPlan(delegationId: string, description: string, focusAreas: string[], maxIterations = 3): RepairPlan {
  return {
    delegationId,
    description,
    focusAreas,
    maxIterations,
    iteration: 0,
  };
}