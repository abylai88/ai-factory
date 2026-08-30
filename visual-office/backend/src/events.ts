import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { FactoryEvent, PipelineSnapshot, TaskSnapshot } from "../../shared/src/index.js";

export class EventBus {
  private readonly emitter = new EventEmitter(); private readonly history: FactoryEvent[] = [];
  publish(event: Omit<FactoryEvent, "id" | "occurredAt">) { const full: FactoryEvent = { id: randomUUID(), occurredAt: new Date().toISOString(), ...event }; this.history.unshift(full); this.history.splice(200); this.emitter.emit("event", full); return full; }
  recent() { return [...this.history]; }
  subscribe(listener: (event: FactoryEvent) => void) { this.emitter.on("event", listener); return () => this.emitter.off("event", listener); }
}
export function normalizePipeline(previous: PipelineSnapshot | undefined, next: PipelineSnapshot): Omit<FactoryEvent, "id" | "occurredAt">[] {
  const base = { pipelineId: next.id, severity: "info" as const }; const events: Omit<FactoryEvent, "id" | "occurredAt">[] = [];
  if (!previous) events.push({ ...base, type: "pipeline.started", payload: { status: next.status } });
  if (previous?.status !== next.status) events.push({ ...base, type: "pipeline.status.changed", severity: next.status === "failed" ? "error" : "info", payload: { previous: previous?.status ?? "unknown", status: next.status } });
  if (previous?.currentStepId !== next.currentStepId && next.currentStepId) events.push({ ...base, type: "pipeline.step.started", payload: { stepId: next.currentStepId } });
  const before = new Map(previous?.steps.map(s => [s.id, s]) ?? []);
  for (const step of next.steps) if (step.status === "passed" || step.status === "failed") { const old = before.get(step.id); if (old?.status !== step.status) events.push({ ...base, type: "pipeline.step.completed", severity: step.status === "failed" ? "error" : "info", payload: { stepId: step.id, status: step.status } }); }
  return events;
}
export function normalizeTasks(projectId: string, previous: TaskSnapshot[], next: TaskSnapshot[]): Omit<FactoryEvent, "id" | "occurredAt">[] {
  const known = new Map(previous.map(t => [t.id, t])); const events: Omit<FactoryEvent, "id" | "occurredAt">[] = [];
  for (const task of next) { const old = known.get(task.id); const base = { projectId, taskId: task.id, severity: "info" as const };
    if (!old) events.push({ ...base, type: "task.created", payload: { title: task.title, status: task.status } });
    if (old?.status !== task.status) events.push({ ...base, type: "task.status.changed", severity: task.status === "failed" ? "error" : "info", payload: { previous: old?.status ?? "unknown", status: task.status } });
    if (old?.attempts !== task.attempts && task.attempts > 0) events.push({ ...base, type: task.status === "running" ? "task.attempt.started" : "task.attempt.completed", payload: { attempt: task.attempts, model: task.model ?? "unknown" } });
    if (task.result && task.result !== old?.result) events.push({ ...base, type: "agent.output", payload: { agent: task.agent ?? "unknown", task: task.title } });
  } return events;
}
