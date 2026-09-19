/**
 * Tool observability: structured events for every tool lifecycle transition.
 *
 * Events: tool.started / tool.completed / tool.failed / tool.blocked,
 * studio.connected / studio.disconnected, playtest.started /
 * playtest.completed, screenshot.created, repair.started / repair.completed.
 *
 * The bus is process-local and append-only. Hermes/Telegram consumers read
 * the same event shapes later (§18 of the master task).
 */

export type ToolEventType =
  | "tool.started"
  | "tool.called"
  | "tool.completed"
  | "tool.failed"
  | "tool.blocked"
  | "mission.started"
  | "mission.stage"
  | "mission.blocked"
  | "mission.passed"
  | "mission.failed"
  | "qa.result"
  | "studio.connected"
  | "studio.disconnected"
  | "playtest.started"
  | "playtest.completed"
  | "playtest.state"
  | "screenshot.created"
  | "repair.started"
  | "repair.completed"
  | "studio.load.state"
  | "studio.load.progress";

export interface ToolEvent {
  id: string;
  type: ToolEventType;
  at: string;
  toolId?: string;
  role?: string;
  projectDir?: string;
  message?: string;
  durationMs?: number;
  attempt?: number;
  data?: Record<string, unknown>;
}

let seq = 0;
const events: ToolEvent[] = [];
const listeners = new Set<(e: ToolEvent) => void>();

export function emitToolEvent(
  e: Omit<ToolEvent, "id" | "at">
): ToolEvent {
  const full: ToolEvent = {
    ...e,
    id: `tev-${Date.now()}-${(seq++).toString(36)}`,
    at: new Date().toISOString(),
  };
  events.push(full);
  if (events.length > 1000) events.splice(0, events.length - 1000);
  for (const l of listeners) {
    try {
      l(full);
    } catch {
      // listeners must never break tool execution
    }
  }
  return full;
}

export function onToolEvent(l: (e: ToolEvent) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function recentToolEvents(limit = 100): ToolEvent[] {
  return events.slice(-limit);
}

export function clearToolEvents(): void {
  events.length = 0;
}
