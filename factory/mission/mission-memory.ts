import type { Delegation, MissionContext, MissionEventSink } from "./mission.js";
import type { MissionState } from "./state.js";
import type { InMemoryEventSink, MissionEventPublisher } from "./events.js";
import type { AgentResult } from "./mission.js";
import { MissionEventTypes, createMissionEventPublisher } from "./events.js";
import { extractMetadata } from "./adapters.js";

// ── Types ────────────────────────────────────────────────────

export interface MissionMemoryConfig {
  /** Max total chars for the entire context block */
  maxContextChars: number;
  /** Max chars per delegation summary */
  maxDelegationSummaryChars: number;
  /** Max chars for validation error output */
  maxValidationErrorChars: number;
  /** Max number of recent delegations to include */
  maxRecentDelegations: number;
}

export interface DelegationSummary {
  id: string;
  title: string;
  role: string;
  status: string;
  resultSummary: string;
  errorSummary: string;
}

export interface ValidationErrorRecord {
  command: string;
  exitCode: number;
  stderr: string;
  timestamp: string;
}

export interface TriageRecord {
  category: string;
  action: string;
  targetRole: string;
  reason: string;
}

export interface MemoryContext {
  missionGoal: string;
  missionContext: MissionContext | undefined;
  completedDelegations: DelegationSummary[];
  failedDelegations: DelegationSummary[];
  recentValidationErrors: ValidationErrorRecord[];
  triageHistory: TriageRecord[];
}

// ── Defaults ─────────────────────────────────────────────────

const DEFAULT_CONFIG: MissionMemoryConfig = {
  maxContextChars: 4000,
  maxDelegationSummaryChars: 200,
  maxValidationErrorChars: 1500,
  maxRecentDelegations: 5,
};

// ── Helpers ──────────────────────────────────────────────────

function extractRole(delegation: Delegation): string {
  // Try ROLE: marker in description
  const metadata = extractMetadata(delegation);
  if (metadata.role) return metadata.role;

  // Try stepIds
  if (delegation.stepIds && delegation.stepIds.length > 0) {
    return delegation.stepIds[0];
  }

  // Fallback: try to extract from title pattern [N] Role: ...
  const titleMatch = delegation.title.match(/\]\s*(\w+)/);
  if (titleMatch) return titleMatch[1].toLowerCase();

  return "unknown";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function summarizeResult(result: string | undefined, maxLen: number): string {
  if (!result) return "(no output)";
  // Take first and last lines for a quick summary
  const lines = result.split("\n").filter((l) => l.trim());
  if (lines.length <= 3) return truncate(result, maxLen);
  const first = lines[0];
  const last = lines[lines.length - 1];
  const summary = `${first}\n...\n${last}`;
  return truncate(summary, maxLen);
}

// ── MissionMemory ────────────────────────────────────────────

/**
 * Lightweight shared memory for a mission.
 *
 * Wraps MissionState and InMemoryEventSink to build bounded context
 * blocks that are injected into repair/triage agent prompts.
 *
 * No separate storage — queries existing state on demand.
 */
export class MissionMemory {
  private readonly state: MissionState;
  private readonly eventSink: InMemoryEventSink;
  private readonly config: MissionMemoryConfig;
  private readonly publisher: MissionEventPublisher;

  constructor(
    state: MissionState,
    eventSink: MissionEventSink,
    config?: Partial<MissionMemoryConfig>,
  ) {
    this.state = state;
    // InMemoryEventSink is the only implementation with recent()/subscribe()
    // MissionEventSink only has publish(). We cast since MissionMemory requires event history.
    this.eventSink = eventSink as unknown as InMemoryEventSink;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.publisher = createMissionEventPublisher(eventSink);
  }

  /**
   * Build a bounded context block to inject into a new delegation's prompt.
   *
   * Returns a string like:
   * ```
   * === MISSION CONTEXT ===
   * Goal: Build a Phaser game
   * Engine: web | Stack: phaser
   *
   * === EXECUTION HISTORY ===
   * [1] Build Project (builder) — PASSED
   *     Output: Build succeeded with 0 warnings...
   *
   * === RECENT FAILURES ===
   * [2] Fix Tests (tester) — FAILED
   *     Error: Test suite failed...
   *
   * === VALIDATION ERRORS ===
   * Command: npm run build — exit 1
   * stderr: TS2345: Argument of type...
   *
   * === TRIAGE HISTORY ===
   * syntax_error → repair (builder): Matched rule "javascript_syntax_error"
   * ```
   */
  buildContextBlock(excludeDelegationId?: string): string {
    const sections: string[] = [];
    let totalChars = 0;
    const max = this.config.maxContextChars;

    // Section 1: Mission goal and context
    const goalSection = this.buildGoalSection();
    sections.push(goalSection);
    totalChars += goalSection.length;

    // Section 2: Execution history (delegations)
    const historySection = this.buildExecutionHistorySection(excludeDelegationId);
    if (totalChars + historySection.length <= max) {
      sections.push(historySection);
      totalChars += historySection.length;
    }

    // Section 3: Recent validation errors
    const validationSection = this.buildValidationErrorsSection();
    if (totalChars + validationSection.length <= max) {
      sections.push(validationSection);
      totalChars += validationSection.length;
    }

    // Section 4: Triage history
    const triageSection = this.buildTriageHistorySection();
    if (totalChars + triageSection.length <= max) {
      sections.push(triageSection);
      totalChars += triageSection.length;
    }

    return sections.join("\n");
  }

  /**
   * Record a delegation completion (called by orchestrator).
   * Emits a memory.updated event for future analytics.
   */
  recordDelegationCompletion(delegationId: string, result: AgentResult): void {
    this.publisher.publish({
      missionId: this.state.getMission()?.id ?? "",
      type: "memory.delegation.recorded" as any,
      payload: {
        delegationId,
        status: result.status,
        durationMs: result.durationMs,
      },
    });
  }

  // ── Section builders ──────────────────────────────────────

  private buildGoalSection(): string {
    const mission = this.state.getMission();
    if (!mission) return "";

    const lines: string[] = ["=== MISSION CONTEXT ==="];
    lines.push(`Goal: ${truncate(mission.goal, 300)}`);

    if (mission.context) {
      const ctx = mission.context;
      const parts: string[] = [];
      if (ctx.engine) parts.push(`Engine: ${ctx.engine}`);
      if (ctx.stack) parts.push(`Stack: ${ctx.stack}`);
      if (ctx.projectId) parts.push(`Project: ${ctx.projectId}`);
      if (parts.length > 0) {
        lines.push(parts.join(" | "));
      }
    }

    return lines.join("\n");
  }

  private buildExecutionHistorySection(excludeDelegationId?: string): string {
    const delegations = this.state.getDelegations();
    if (!delegations || delegations.length === 0) return "";

    // Filter out the delegation we're creating context for
    const filtered = excludeDelegationId
      ? delegations.filter((d) => d.id !== excludeDelegationId)
      : delegations;

    // Split into completed and failed
    const completed = filtered.filter((d) => d.status === "passed");
    const failed = filtered.filter((d) => d.status === "failed");
    const running = filtered.filter((d) => d.status === "running" || d.status === "queued");

    const lines: string[] = ["", "=== EXECUTION HISTORY ==="];

    // Show failed delegations first (most relevant for repair)
    if (failed.length > 0) {
      lines.push("Failed:");
      const limit = Math.min(failed.length, this.config.maxRecentDelegations);
      for (const d of failed.slice(-limit)) {
        lines.push(this.summarizeDelegation(d, "FAILED"));
      }
    }

    // Show completed delegations
    if (completed.length > 0) {
      lines.push("Completed:");
      const limit = Math.min(completed.length, this.config.maxRecentDelegations);
      for (const d of completed.slice(-limit)) {
        lines.push(this.summarizeDelegation(d, "PASSED"));
      }
    }

    // Show running/queued
    if (running.length > 0) {
      lines.push("In Progress:");
      for (const d of running.slice(-3)) {
        lines.push(this.summarizeDelegation(d, d.status.toUpperCase()));
      }
    }

    return lines.join("\n");
  }

  private summarizeDelegation(d: Delegation, statusLabel: string): string {
    const role = extractRole(d);
    const resultSummary = summarizeResult(d.result, this.config.maxDelegationSummaryChars);
    const errorSummary = d.error ? truncate(d.error, 200) : "";

    let line = `  [${d.id.slice(-6)}] ${d.title} (${role}) — ${statusLabel}`;
    if (resultSummary && resultSummary !== "(no output)") {
      line += `\n    Output: ${resultSummary}`;
    }
    if (errorSummary) {
      line += `\n    Error: ${errorSummary}`;
    }
    return line;
  }

  private buildValidationErrorsSection(): string {
    const events = this.eventSink.recent();
    const validationFailed = events
      .filter((e) => e.type === MissionEventTypes.DELEGATION_VALIDATION_FAILED)
      .slice(-3); // Last 3 validation failures

    if (validationFailed.length === 0) return "";

    const lines: string[] = ["", "=== RECENT VALIDATION ERRORS ==="];

    for (const evt of validationFailed) {
      const p = evt.payload as Record<string, unknown>;
      const command = (p.command as string) ?? "unknown";
      const exitCode = (p.exitCode as number) ?? 0;
      const stderr = truncate((p.stderr as string) ?? "", this.config.maxValidationErrorChars);

      lines.push(`Command: ${command} — exit ${exitCode}`);
      if (stderr) {
        lines.push(`stderr: ${stderr}`);
      }
      lines.push("");
    }

    return lines.join("\n").trimEnd();
  }

  private buildTriageHistorySection(): string {
    const events = this.eventSink.recent();
    const triageEvents = events
      .filter((e) => e.type === MissionEventTypes.DELEGATION_TRIAGE)
      .slice(-5); // Last 5 triage decisions

    if (triageEvents.length === 0) return "";

    const lines: string[] = ["", "=== TRIAGE HISTORY ==="];

    for (const evt of triageEvents) {
      const p = evt.payload as Record<string, unknown>;
      const category = (p.category as string) ?? "unknown";
      const action = (p.action as string) ?? "repair";
      const targetRole = (p.targetRole as string) ?? "builder";
      const reason = truncate((p.reason as string) ?? "", 150);

      lines.push(`${category} → ${action} (${targetRole}): ${reason}`);
    }

    return lines.join("\n");
  }
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Create a MissionMemory instance if state and eventSink are available.
 * Returns null if not configured — caller should skip memory enrichment.
 */
export function createMissionMemory(
  state: MissionState,
  eventSink: MissionEventSink,
  config?: Partial<MissionMemoryConfig>,
): MissionMemory {
  return new MissionMemory(state, eventSink, config);
}
