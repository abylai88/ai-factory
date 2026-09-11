import type { MissionEvent } from "./mission.js";
import type { InMemoryEventSink } from "./events.js";

// ── Role → Pixel Office role mapping ──────────────────────────

const AGENT_ROLE_MAP: Record<string, string> = {
  market: "Researcher",
  competitor: "Researcher",
  idea: "Designer",
  director: "Designer",
  gameplay: "Designer",
  designer: "Designer",
  architect: "Developer",
  programmer: "Developer",
  builder: "Developer",
  content: "Designer",
  monetization: "Researcher",
  tester: "QA",
  reviewer: "QA",
};

function pixelOfficeRole(agentName: string): string {
  return AGENT_ROLE_MAP[agentName] ?? "Developer";
}

// ── Config ────────────────────────────────────────────────────

export interface PixelOfficeReporterConfig {
  /** Pixel Office server URL, e.g. "http://127.0.0.1:3999" */
  serverUrl: string;
  /** Bearer auth token for Pixel Office */
  authToken: string;
  /** The event sink to subscribe to */
  eventSink: InMemoryEventSink;
  /** Optional logger */
  log?: (msg: string) => void;
}

// ── PixelOfficeReporter ──────────────────────────────────────

/**
 * Reports AI Factory delegation lifecycle events to Pixel Office.
 *
 * Translates MissionEvents into the simple Pixel Office event format:
 *   - delegation.created  → agent.started
 *   - delegation.started  → agent.started (dedup)
 *   - delegation.completed → agent.completed / agent.failed
 *
 * Each delegation maps to a stable agent in Pixel Office using its
 * delegation ID as the external agent ID.
 */
export class PixelOfficeReporter {
  private readonly eventSink: InMemoryEventSink;
  private readonly serverUrl: string;
  private readonly authToken: string;
  private readonly log: (msg: string) => void;
  private unsubscribe: (() => void) | null = null;
  private running = false;

  /** Track which delegations have been created (dedup guard) */
  private readonly created = new Set<string>();

  constructor(config: PixelOfficeReporterConfig) {
    this.eventSink = config.eventSink;
    this.serverUrl = config.serverUrl.replace(/\/$/, "");
    this.authToken = config.authToken;
    this.log = config.log ?? console.log;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.eventSink.subscribe((event) => {
      this.handleEvent(event).catch((err) => {
        this.log(`[Pixel Office Reporter] Error handling ${event.type}: ${err}`);
      });
    });
    this.log("[Pixel Office Reporter] Started");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.running = false;
    this.log("[Pixel Office Reporter] Stopped");
  }

  // ── Event routing ──────────────────────────────────────────

  private async handleEvent(event: MissionEvent): Promise<void> {
    switch (event.type) {
      case "delegation.created":
        await this.onDelegationCreated(event);
        break;
      case "delegation.started":
        await this.onDelegationStarted(event);
        break;
      case "delegation.completed":
        await this.onDelegationCompleted(event);
        break;
      case "delegation.validation.failed":
        await this.onValidationFailed(event);
        break;
      case "delegation.retry.started":
        await this.onRetryStarted(event);
        break;
      // Supervisor events
      case "mission.supervisor.decision":
        await this.onSupervisorDecision(event);
        break;
      case "delegation.recovery.started":
        await this.onRecoveryStarted(event);
        break;
      // Mission-level events are not forwarded — agents persist after completion
    }
  }

  // ── Delegation handlers ────────────────────────────────────

  private async onDelegationCreated(event: MissionEvent): Promise<void> {
    const del = event.payload as Record<string, unknown>;
    const delegationId = del.id as string;
    if (!delegationId) return;

    this.created.add(delegationId);

    const agentName = (del.stepIds as string[] | undefined)?.[0] ?? "builder";
    const role = pixelOfficeRole(agentName);
    const name = (del.title as string) ?? agentName;
    const task = (del.description as string)?.slice(0, 200) ?? name;

    this.log(`[Pixel Office Reporter] agent.started: ${delegationId} (${role})`);

    await this.post({
      type: "agent.started",
      missionId: event.missionId,
      agentId: delegationId,
      role,
      name,
      task,
    });
  }

  private async onDelegationStarted(event: MissionEvent): Promise<void> {
    const delegationId = event.payload.delegationId as string;
    if (!delegationId) return;

    // Dedup: delegation.created already sent agent.started
    if (this.created.has(delegationId)) return;

    // Fallback: if we missed created, send started
    this.created.add(delegationId);
    this.log(`[Pixel Office Reporter] agent.started (fallback): ${delegationId}`);

    await this.post({
      type: "agent.started",
      missionId: event.missionId,
      agentId: delegationId,
      role: "Developer",
      name: delegationId,
      task: "Working...",
    });
  }

  private async onDelegationCompleted(event: MissionEvent): Promise<void> {
    const delegationId = event.payload.delegationId as string;
    const status = event.payload.status as string;
    if (!delegationId) return;

    this.created.delete(delegationId);

    // Also clean up any repair agent tracking for this delegation
    for (const id of this.created) {
      if (id.startsWith(`repair-${delegationId}-`)) {
        this.created.delete(id);
      }
    }

    if (status === "passed") {
      this.log(`[Pixel Office Reporter] agent.completed: ${delegationId}`);
      await this.post({
        type: "agent.completed",
        missionId: event.missionId,
        agentId: delegationId,
      });
    } else {
      this.log(`[Pixel Office Reporter] agent.failed: ${delegationId}`);
      await this.post({
        type: "agent.failed",
        missionId: event.missionId,
        agentId: delegationId,
      });
    }
  }

  private async onValidationFailed(event: MissionEvent): Promise<void> {
    const delegationId = event.payload.delegationId as string;
    const command = event.payload.command as string;
    if (!delegationId) return;

    this.log(`[Pixel Office Reporter] agent.failed (validation): ${delegationId} (${command})`);
    await this.post({
      type: "agent.failed",
      missionId: event.missionId,
      agentId: delegationId,
      reason: `Validation failed: ${command}`,
    });
  }

  private async onRetryStarted(event: MissionEvent): Promise<void> {
    const delegationId = event.payload.delegationId as string;
    const attempt = event.payload.attempt as number;
    const maxAttempts = event.payload.maxAttempts as number;
    if (!delegationId) return;

    const repairId = `repair-${delegationId}-${attempt}`;
    this.created.add(repairId);

    this.log(`[Pixel Office Reporter] agent.started (repair ${attempt}/${maxAttempts}): ${repairId}`);
    await this.post({
      type: "agent.started",
      missionId: event.missionId,
      agentId: repairId,
      role: "Developer",
      name: `Repair ${attempt}/${maxAttempts}`,
      task: `Repairing validation failure for ${delegationId}`,
    });
  }

  // ── Supervisor event handlers ──────────────────────────────

  private async onSupervisorDecision(event: MissionEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const decisionType = payload.decisionType as string;
    const reason = payload.reason as string;
    const delegationId = payload.delegationId as string;

    if (!delegationId) return;

    switch (decisionType) {
      case "CHANGE_MODEL":
        this.log(`[Pixel Office Reporter] supervisor: model change for ${delegationId} (${reason})`);
        break;
      case "REPAIR":
        this.log(`[Pixel Office Reporter] supervisor: repair initiated for ${delegationId} (${reason})`);
        break;
      case "ESCALATE":
        this.log(`[Pixel Office Reporter] supervisor: escalation for ${delegationId} (${reason})`);
        break;
      case "REPLAN":
        this.log(`[Pixel Office Reporter] supervisor: replan for ${delegationId} (${reason})`);
        break;
      case "ABORT":
        this.log(`[Pixel Office Reporter] supervisor: abort for ${delegationId} (${reason})`);
        break;
      default:
        this.log(`[Pixel Office Reporter] supervisor: unknown decision ${decisionType} for ${delegationId}`);
    }
  }

  private async onRecoveryStarted(event: MissionEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const delegationId = payload.delegationId as string;
    const decisionType = payload.decisionType as string;

    if (!delegationId) return;

    this.log(`[Pixel Office Reporter] recovery started for ${delegationId} (${decisionType})`);
  }

  // ── HTTP transport ─────────────────────────────────────────

  private async post(body: Record<string, unknown>): Promise<void> {
    try {
      const res = await fetch(`${this.serverUrl}/api/ai-factory/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.log(`[Pixel Office Reporter] HTTP ${res.status}: ${text}`);
      }
    } catch (err) {
      // Pixel Office offline — do not crash the mission
      this.log(`[Pixel Office Reporter] Network error (office may be offline): ${err}`);
    }
  }
}

// ── Factory function ──────────────────────────────────────────

/**
 * Create a PixelOfficeReporter if Pixel Office is configured.
 * Returns null if not configured — caller should skip reporter lifecycle.
 */
export function createPixelOfficeReporter(
  eventSink: InMemoryEventSink,
  log?: (msg: string) => void,
): PixelOfficeReporter | null {
  const url = process.env.PIXEL_OFFICE_URL;
  const token = process.env.PIXEL_OFFICE_TOKEN;
  const enabled = process.env.PIXEL_OFFICE_ENABLED;

  if (enabled === "false") return null;
  if (!url || !token) return null;

  return new PixelOfficeReporter({
    serverUrl: url,
    authToken: token,
    eventSink,
    log,
  });
}
