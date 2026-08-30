import { randomUUID } from "node:crypto";
import { MissionEvent, MissionEventSink } from "./mission.js";

export interface MissionEventPublisher {
  publish(event: Omit<MissionEvent, "id" | "occurredAt">): MissionEvent;
}

export class InMemoryEventSink implements MissionEventSink {
  private events: MissionEvent[] = [];
  private subscribers: Set<(event: MissionEvent) => void> = new Set();

  publish(event: Omit<MissionEvent, "id" | "occurredAt">): MissionEvent {
    const full: MissionEvent = {
      id: `evt-${randomUUID().slice(0, 8)}`,
      occurredAt: new Date().toISOString(),
      ...event,
    };
    this.events.unshift(full);
    if (this.events.length > 500) this.events.splice(500);
    for (const sub of this.subscribers) {
      try {
        sub(full);
      } catch {
        // ignore subscriber errors
      }
    }
    return full;
  }

  recent(): MissionEvent[] {
    return [...this.events];
  }

  subscribe(listener: (event: MissionEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  clear(): void {
    this.events = [];
  }
}

export class NoopEventSink implements MissionEventSink {
  publish(event: Omit<MissionEvent, "id" | "occurredAt">): MissionEvent {
    return {
      id: `evt-${randomUUID().slice(0, 8)}`,
      occurredAt: new Date().toISOString(),
      ...event,
    };
  }
}

export function createMissionEventPublisher(sink: MissionEventSink): MissionEventPublisher {
  return {
    publish: (event) => sink.publish(event),
  };
}

export const MissionEventTypes = {
  MISSION_CREATED: "mission.created",
  MISSION_PLANNED: "mission.planned",
  MISSION_APPROVED: "mission.approved",
  MISSION_STARTED: "mission.started",
  DELEGATION_CREATED: "delegation.created",
  DELEGATION_STARTED: "delegation.started",
  DELEGATION_COMPLETED: "delegation.completed",
  MISSION_AUDITING: "mission.auditing",
  MISSION_AUDIT_PASSED: "mission.audit.passed",
  MISSION_AUDIT_FAILED: "mission.audit.failed",
  MISSION_REPAIRING: "mission.repairing",
  MISSION_COMPLETED: "mission.completed",
  MISSION_FAILED: "mission.failed",
  MISSION_VISUAL_QA_STARTED: "mission.visual_qa.started",
  MISSION_VISUAL_QA_COMPLETED: "mission.visual_qa.completed",
  MISSION_VISUAL_QA_FAILED: "mission.visual_qa.failed",
  MISSION_VISUAL_QA_SKIPPED: "mission.visual_qa.skipped",
  MISSION_DIAGNOSIS_STARTED: "mission.diagnosis.started",
  MISSION_DIAGNOSIS_COMPLETED: "mission.diagnosis.completed",
  MISSION_REPAIR_STARTED: "mission.repair.started",
  MISSION_REPAIR_COMPLETED: "mission.repair.completed",
  MISSION_REPAIR_FAILED: "mission.repair.failed",
} as const;