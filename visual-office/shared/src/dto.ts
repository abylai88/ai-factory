import { z } from "zod";

const taskStatuses = ["queued", "running", "review", "passed", "failed", "done"] as const;
export const TaskStatusSchema = z.enum(taskStatuses);

export const PipelineStateFileSchema = z.object({
  state: z.object({
    pipelineId: z.string(), goal: z.string().optional(), project: z.string().optional(), status: z.string(),
    currentStepId: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(),
    engine: z.string().optional(), stack: z.string().optional(), template: z.string().optional(), workspace: z.string().optional(),
    bugfixIterations: z.number().int().nonnegative().optional(), maxFixIterations: z.number().int().positive().optional(),
    errors: z.array(z.object({ stepId: z.string().optional(), message: z.string(), iteration: z.number().optional(), timestamp: z.string() })).optional()
  }),
  entries: z.array(z.object({ stepId: z.string(), title: z.string(), role: z.string(), status: z.string(), output: z.string(), timestamp: z.string() })).optional()
});
export const TaskFileSchema = z.array(z.object({
  id: z.string(), title: z.string(), description: z.string().optional(), role: z.string(), agent: z.string().optional(), model: z.string().optional(),
  status: TaskStatusSchema, createdAt: z.string(), updatedAt: z.string(), attempts: z.number().int().nonnegative().optional(), result: z.string().optional(), error: z.string().optional(), attemptHistory: z.string().optional()
}));

export const PipelineStepSchema = z.object({
  id: z.string(), title: z.string().optional(), role: z.string().optional(), agent: z.string().optional(),
  status: z.enum(["queued", "running", "passed", "failed", "skipped", "unknown"]), attempt: z.number().int().nonnegative().optional(),
  model: z.string().optional(), durationMs: z.number().nonnegative().optional(), error: z.string().optional()
});
export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export const PipelineSnapshotSchema = z.object({
  id: z.string(), goal: z.string(), project: z.string(), type: z.enum(["game", "engineering", "unknown"]), status: z.enum(["running", "passed", "failed", "unknown"]),
  currentStepId: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional(),
  entries: z.array(z.object({ stepId: z.string(), title: z.string(), role: z.string(), status: z.string(), output: z.string(), timestamp: z.string() })),
  steps: z.array(PipelineStepSchema), errors: z.array(z.object({ stepId: z.string().optional(), message: z.string(), timestamp: z.string() })), engine: z.string().optional(), stack: z.string().optional()
});
export type PipelineSnapshot = z.infer<typeof PipelineSnapshotSchema>;
export const AttemptSchema = z.object({ status: z.string(), errorType: z.string(), errorMessage: z.string(), model: z.string(), attempt: z.number(), timedOut: z.boolean(), retryable: z.boolean() });
export const TaskSnapshotSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), role: z.string(), agent: z.string().optional(), model: z.string().optional(), status: TaskStatusSchema,
  createdAt: z.string(), updatedAt: z.string(), attempts: z.number(), result: z.string().optional(), error: z.string().optional(), attemptHistory: z.array(AttemptSchema).optional()
});
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export const AgentDescriptorSchema = z.object({ name: z.string(), role: z.string(), description: z.string().optional(), canEdit: z.boolean().optional(), source: z.string() });
export type AgentDescriptor = z.infer<typeof AgentDescriptorSchema>;
export const ProjectSnapshotSchema = z.object({
  id: z.string(), name: z.string(), path: z.string(), pipelineType: z.enum(["game", "engineering", "unknown"]), status: z.enum(["running", "passed", "failed", "unknown"]), currentStepId: z.string().optional(),
  progress: z.object({ complete: z.number(), total: z.number() }), lastRunAt: z.string().optional(), buildStatus: z.literal("unknown"), qaStatus: z.literal("unknown")
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export const FactoryEventSchema = z.object({
  id: z.string(), occurredAt: z.string(), type: z.enum(["pipeline.started", "pipeline.step.started", "pipeline.step.completed", "pipeline.status.changed", "task.created", "task.status.changed", "task.attempt.started", "task.attempt.completed", "agent.output", "factory.log", "visual_qa.started", "visual_qa.check.completed", "visual_qa.artifact.created", "visual_qa.completed", "diagnostic"]),
  severity: z.enum(["info", "warning", "error"]), pipelineId: z.string().optional(), projectId: z.string().optional(), taskId: z.string().optional(), payload: z.record(z.string(), z.unknown())
});
export type FactoryEvent = z.infer<typeof FactoryEventSchema>;
export const ArtifactSchema = z.object({ id: z.string(), type: z.enum(["screenshot", "trace", "report"]), createdAt: z.string(), label: z.string(), available: z.boolean() });
export type Artifact = z.infer<typeof ArtifactSchema>;

export const DiagnosticRecordSchema = z.object({
  source: z.string(),
  message: z.string(),
  occurredAt: z.string().optional()
});
export type DiagnosticRecord = z.infer<typeof DiagnosticRecordSchema>;

export const VisualQaStatusSchema = z.object({
  status: z.literal("not_available"),
  message: z.string(),
  artifacts: z.array(ArtifactSchema)
});
export type VisualQaStatus = z.infer<typeof VisualQaStatusSchema>;

export const HermesStatusSchema = z.object({
  available: z.boolean(),
  summary: z.string()
});
export type HermesStatus = z.infer<typeof HermesStatusSchema>;
