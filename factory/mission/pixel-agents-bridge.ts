import type { MissionEvent } from "./mission.js";
import type { InMemoryEventSink } from "./events.js";

export interface PixelAgentsBridgeConfig {
  /** Pixel Agents server URL, e.g. "http://127.0.0.1:3845" */
  serverUrl: string;
  /** Bearer auth token for Pixel Agents */
  authToken: string;
  /** The event sink to subscribe to */
  eventSink: InMemoryEventSink;
  /** Optional logger */
  log?: (msg: string) => void;
}

/**
 * Bridges AI Factory MissionEvents to Pixel Agents via the hook endpoint.
 *
 * Each event is POSTed to `POST /api/hooks/ai-factory` with:
 *   - session_id: deterministic per-mission or per-delegation
 *   - hook_event_name: the MissionEvent type value
 *   - mission_id: the mission this event belongs to
 *   - payload: the event payload
 *
 * The AI Factory HookProvider in Pixel Agents normalizes these into AgentEvents
 * that drive the animated office visualization.
 */
export class PixelAgentsBridge {
  private readonly eventSink: InMemoryEventSink;
  private readonly serverUrl: string;
  private readonly authToken: string;
  private readonly log: (msg: string) => void;
  private unsubscribe: (() => void) | null = null;
  private running = false;

  constructor(config: PixelAgentsBridgeConfig) {
    this.eventSink = config.eventSink;
    this.serverUrl = config.serverUrl.replace(/\/$/, "");
    this.authToken = config.authToken;
    this.log = config.log ?? console.log;
  }

  /**
   * Start bridging events. Subscribes to the event sink and forwards every
   * event to Pixel Agents.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.eventSink.subscribe((event) => {
      this.forward(event).catch((err) => {
        this.log(`[PixelAgentsBridge] Error forwarding event ${event.type}: ${err}`);
      });
    });
    this.log("[PixelAgentsBridge] Started");
  }

  /**
   * Stop bridging events and close the subscription.
   */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.running = false;
    this.log("[PixelAgentsBridge] Stopped");
  }

  /**
   * Forward a single event to Pixel Agents. Exposed for testing.
   */
  async forward(event: MissionEvent): Promise<void> {
    const sessionId = this.buildSessionId(event);
    const body = JSON.stringify({
      session_id: sessionId,
      hook_event_name: event.type,
      mission_id: event.missionId,
      payload: event.payload,
    });

    const res = await fetch(`${this.serverUrl}/api/hooks/ai-factory`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authToken}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  }

  /**
   * Deterministic session ID:
   *   - delegation events → "ai-factory:<missionId>:<delegationId>"
   *   - mission-level events → "ai-factory:<missionId>"
   */
  private buildSessionId(event: MissionEvent): string {
    const delegationId =
      typeof event.payload.delegationId === "string"
        ? event.payload.delegationId
        : undefined;

    if (delegationId) {
      return `ai-factory:${event.missionId}:${delegationId}`;
    }
    return `ai-factory:${event.missionId}`;
  }
}
