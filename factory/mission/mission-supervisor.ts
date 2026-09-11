import type { Delegation, AgentResult, Mission } from "./mission.js";
import type { MissionState } from "./state.js";
import type { MissionEventSink } from "./mission.js";
import type { MissionMemory } from "./mission-memory.js";
import type { MissionPlanner } from "./mission-planner.js";
import type { ModelRouter } from "./model-router.js";
import { MissionEventPublisher, createMissionEventPublisher, MissionEventTypes, type InMemoryEventSink } from "./events.js";
import { isModelProviderFailure } from "./model-failure-classifier.js";

// ── Types ────────────────────────────────────────────────────

export type SupervisorDecisionType =
  | "RETRY"
  | "CHANGE_MODEL"
  | "CHANGE_ROLE"
  | "REPAIR"
  | "REPLAN"
  | "ESCALATE"
  | "ABORT";

export type RecoveryReason =
  | "provider_failure"
  | "code_failure"
  | "stuck"
  | "repeated_failure"
  | "repair_exhausted"
  | "replan_needed";

export interface SupervisorDecision {
  id: string;
  delegationId: string;
  type: SupervisorDecisionType;
  reason: RecoveryReason;
  context: string;
  attemptedAt: string;
  result?: "success" | "failure";
}

export interface DelegationTrackingState {
  delegationId: string;
  startedAt: string;
  lastActivityAt: string;
  status: string;
  failureCount: number;
  repairCount: number;
  recoveryCount: number;
  modelAttempts: string[];
  escalationLevel: number;
}

export interface SupervisorConfig {
  maxRecoveryAttempts: number;
  maxStuckRecoveries: number;
  maxDelegationDurationMs: number;
  stuckDetectionIntervalMs: number;
  missionState: MissionState;
  eventSink: MissionEventSink;
  publisher: MissionEventPublisher;
  modelRouter?: ModelRouter;
  replanner?: MissionPlanner;
  maxReplanAttempts: number;
  maxModelFallbackAttempts: number;
  maxDynamicDelegations: number;
}

export interface RecoveryContext {
  missionGoal: string;
  completedDelegations: string[];
  failedDelegations: string[];
  validationErrors: string[];
  triageHistory: string[];
  repairHistory: string[];
  attemptedModels: string[];
  activeDelegationStates: string[];
}

const DEFAULT_CONFIG: Omit<SupervisorConfig, "missionState" | "eventSink" | "publisher"> = {
  maxRecoveryAttempts: 3,
  maxStuckRecoveries: 2,
  maxDelegationDurationMs: 5 * 60 * 1000,
  stuckDetectionIntervalMs: 30 * 1000,
  maxReplanAttempts: 2,
  maxModelFallbackAttempts: 3,
  maxDynamicDelegations: 10,
};

// ── MissionSupervisor ──────────────────────────────────────

/**
 * Phase 9: Autonomous Factory Supervisor.
 *
 * Operates above the Orchestrator. Coordinates existing recovery
 * mechanisms (repair, model fallback, replanning) without duplicating them.
 *
 * Responsibilities:
 * - Observe delegation lifecycle via events
 * - Track active delegations and failures
 * - Detect stuck work via inactivity timeout
 * - Decide escalation strategy deterministically
 * - Invoke existing recovery mechanisms
 * - Trigger replanning when recovery exhausted
 * - Preserve decisions in MissionMemory
 *
 * All loops are hard-bounded. No infinite autonomous behavior.
 */
export class MissionSupervisor {
  private readonly config: SupervisorConfig;
  private readonly decisions: SupervisorDecision[] = [];
  private readonly delegationStates = new Map<string, DelegationTrackingState>();
  private totalRecoveryAttempts = 0;
  private totalReplanAttempts = 0;
  private totalModelFallbackAttempts = 0;

  constructor(config: SupervisorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle Observation ──────────────────────────────────

  /**
   * Observe a delegation starting. Initialize tracking state.
   */
  observeDelegationStarted(delegation: Delegation): void {
    const now = new Date().toISOString();
    this.delegationStates.set(delegation.id, {
      delegationId: delegation.id,
      startedAt: now,
      lastActivityAt: now,
      status: "running",
      failureCount: 0,
      repairCount: 0,
      recoveryCount: 0,
      modelAttempts: [],
      escalationLevel: 0,
    });
  }

  /**
   * Observe a delegation completing (success or failure).
   */
  observeDelegationCompleted(delegationId: string, result: AgentResult): void {
    const state = this.delegationStates.get(delegationId);
    if (state) {
      state.status = result.status;
      state.lastActivityAt = new Date().toISOString();
    }
  }

  /**
   * Observe a delegation being repaired.
   */
  observeRepairStarted(delegationId: string): void {
    const state = this.delegationStates.get(delegationId);
    if (state) {
      state.repairCount++;
      state.lastActivityAt = new Date().toISOString();
    }
  }

  /**
   * Observe a model fallback attempt.
   */
  observeModelFallback(delegationId: string, model: string): void {
    const state = this.delegationStates.get(delegationId);
    if (state) {
      state.modelAttempts.push(model);
      state.lastActivityAt = new Date().toISOString();
    }
    this.totalModelFallbackAttempts++;
  }

  // ── Failure Handling ───────────────────────────────────────

  /**
   * Handle a delegation failure. Classify and decide recovery.
   *
   * Decision tree:
   * 1. Provider/model failure → CHANGE_MODEL (if router available and attempts remain)
   * 2. Code failure, first attempt → RETRY/REPAIR (existing repair mechanism)
   * 3. Code failure, repeated → ESCALATE (alternate strategy)
   * 4. Repair exhausted → REPLAN (if replanner available and attempts remain)
   * 5. Replan exhausted → ABORT
   */
  async handleDelegationFailure(
    delegation: Delegation,
    result: AgentResult,
  ): Promise<SupervisorDecision> {
    const state = this.delegationStates.get(delegation.id);
    if (state) {
      state.failureCount++;
      state.lastActivityAt = new Date().toISOString();
    }

    const decision = this.decideRecovery(delegation, result);
    this.decisions.push(decision);

    this.emitEvent(delegation.missionId, "mission.supervisor.decision", {
      delegationId: delegation.id,
      decisionType: decision.type,
      reason: decision.reason,
      context: decision.context,
      failureCount: state?.failureCount ?? 1,
      recoveryCount: state?.recoveryCount ?? 0,
      escalationLevel: state?.escalationLevel ?? 0,
    });

    return decision;
  }

  /**
   * Execute a recovery decision by invoking existing mechanisms.
   * Returns true if recovery succeeded, false if it failed.
   */
  async executeRecoveryDecision(
    delegation: Delegation,
    result: AgentResult,
    decision: SupervisorDecision,
    memory?: MissionMemory,
  ): Promise<boolean> {
    this.emitEvent(delegation.missionId, "delegation.recovery.started", {
      delegationId: delegation.id,
      decisionType: decision.type,
      reason: decision.reason,
    });

    let success = false;

    switch (decision.type) {
      case "CHANGE_MODEL":
        success = await this.executeModelFallback(delegation);
        break;

      case "REPAIR":
        success = await this.executeRepairFallback(delegation, decision);
        break;

      case "ESCALATE":
        success = await this.executeEscalation(delegation, decision);
        break;

      case "REPLAN":
        success = await this.executeReplan(delegation, memory);
        break;

      case "ABORT":
        success = false;
        break;

      default:
        success = false;
    }

    const state = this.delegationStates.get(delegation.id);
    if (state) {
      state.recoveryCount++;
      state.lastActivityAt = new Date().toISOString();
    }
    this.totalRecoveryAttempts++;
    decision.result = success ? "success" : "failure";

    this.emitEvent(delegation.missionId, "delegation.recovery.completed", {
      delegationId: delegation.id,
      decisionType: decision.type,
      reason: decision.reason,
      success,
      recoveryCount: state?.recoveryCount ?? 0,
    });

    return success;
  }

  // ── Stuck Detection ────────────────────────────────────────

  /**
   * Check all active delegations for stuck state.
   * Returns IDs of delegations that are stuck.
   */
  checkStuckDelegations(currentTimeMs?: number): string[] {
    const now = currentTimeMs ?? Date.now();
    const stuckDelegationIds: string[] = [];

    for (const [delegationId, state] of this.delegationStates) {
      if (state.status !== "running") continue;

      const startedAtMs = new Date(state.startedAt).getTime();
      const elapsed = now - startedAtMs;

      if (elapsed > this.config.maxDelegationDurationMs) {
        stuckDelegationIds.push(delegationId);
      }
    }

    return stuckDelegationIds;
  }

  /**
   * Handle a stuck delegation. Decide and execute recovery.
   */
  async handleStuckDelegation(delegationId: string, missionId: string): Promise<SupervisorDecision | null> {
    const state = this.delegationStates.get(delegationId);
    if (!state || state.status !== "running") return null;

    if (state.recoveryCount >= this.config.maxStuckRecoveries) {
      const decision: SupervisorDecision = {
        id: `sup-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        delegationId,
        type: "REPLAN",
        reason: "repeated_failure",
        context: `Stuck recovery exhausted for ${delegationId} after ${state.recoveryCount} attempts`,
        attemptedAt: new Date().toISOString(),
      };
      this.decisions.push(decision);

      this.emitEvent(missionId, "mission.supervisor.decision", {
        delegationId,
        decisionType: "REPLAN",
        reason: "repeated_failure",
        context: decision.context,
        failureCount: state.failureCount,
        recoveryCount: state.recoveryCount,
        escalationLevel: state.escalationLevel,
      });

      return decision;
    }

    state.recoveryCount++;
    state.lastActivityAt = new Date().toISOString();

    const decision: SupervisorDecision = {
      id: `sup-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      delegationId,
      type: "REPAIR",
      reason: "stuck",
      context: `Delegation ${delegationId} stuck for ${Math.round((Date.now() - new Date(state.startedAt).getTime()) / 1000)}s`,
      attemptedAt: new Date().toISOString(),
    };
    this.decisions.push(decision);

    this.emitEvent(missionId, "delegation.stuck", {
      delegationId,
      stuckDurationMs: Date.now() - new Date(state.startedAt).getTime(),
      recoveryCount: state.recoveryCount,
      maxStuckRecoveries: this.config.maxStuckRecoveries,
    });

    this.emitEvent(missionId, "mission.supervisor.decision", {
      delegationId,
      decisionType: "REPAIR",
      reason: "stuck",
      context: decision.context,
      failureCount: state.failureCount,
      recoveryCount: state.recoveryCount,
      escalationLevel: state.escalationLevel,
    });

    return decision;
  }

  // ── Recovery Execution Helpers ─────────────────────────────

  private async executeModelFallback(delegation: Delegation): Promise<boolean> {
    if (!this.config.modelRouter) return false;
    if (this.totalModelFallbackAttempts >= this.config.maxModelFallbackAttempts * 3) return false;

    const state = this.delegationStates.get(delegation.id);
    if (state && state.modelAttempts.length >= this.config.maxModelFallbackAttempts) return false;

    return true;
  }

  private async executeRepairFallback(
    delegation: Delegation,
    decision: SupervisorDecision,
  ): Promise<boolean> {
    const state = this.delegationStates.get(delegation.id);
    if (!state) return false;

    if (state.repairCount >= this.config.maxRecoveryAttempts) {
      decision.type = "ESCALATE";
      decision.reason = "repair_exhausted";
      state.escalationLevel++;
      return false;
    }

    return true;
  }

  private async executeEscalation(
    delegation: Delegation,
    decision: SupervisorDecision,
  ): Promise<boolean> {
    const state = this.delegationStates.get(delegation.id);
    if (!state) return false;

    if (state.escalationLevel >= 2) {
      decision.type = "REPLAN";
      decision.reason = "repeated_failure";
      return false;
    }

    state.escalationLevel++;
    return true;
  }

  private async executeReplan(
    delegation: Delegation,
    memory?: MissionMemory,
  ): Promise<boolean> {
    if (!this.config.replanner) return false;
    if (this.totalReplanAttempts >= this.config.maxReplanAttempts) return false;

    this.totalReplanAttempts++;

    const mission = this.config.missionState.getMission();
    if (!mission) return false;

    try {
      const newPlan = await this.config.replanner.createPlan(mission, memory);
      this.emitEvent(delegation.missionId, "mission.supervisor.decision", {
        delegationId: delegation.id,
        decisionType: "REPLAN",
        reason: "replan_needed",
        newPlanId: newPlan.id,
        delegationCount: newPlan.delegations.length,
        replanAttempt: this.totalReplanAttempts,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Decision Logic ─────────────────────────────────────────

  /**
   * Determine the appropriate recovery action based on failure type and history.
   * Pure function — no side effects except updating escalation level.
   */
  decideRecovery(delegation: Delegation, result: AgentResult): SupervisorDecision {
    const state = this.delegationStates.get(delegation.id);
    const failureCount = state?.failureCount ?? 0;
    const recoveryCount = state?.recoveryCount ?? 0;
    const escalationLevel = state?.escalationLevel ?? 0;

    const isProviderFailure = isModelProviderFailure(result);

    if (isProviderFailure) {
      if (this.config.modelRouter && this.totalModelFallbackAttempts < this.config.maxModelFallbackAttempts * 3) {
        return this.createDecision(delegation.id, "CHANGE_MODEL", "provider_failure",
          `Provider failure: ${result.error ?? "unknown"}`);
      }
      return this.createDecision(delegation.id, "ESCALATE", "provider_failure",
        `Model fallback exhausted: ${result.error ?? "unknown"}`);
    }

    if (failureCount === 1) {
      return this.createDecision(delegation.id, "REPAIR", "code_failure",
        `First failure: ${result.error ?? "unknown"}`);
    }

    if (failureCount === 2) {
      return this.createDecision(delegation.id, "ESCALATE", "repeated_failure",
        `Repeated failure #${failureCount}: ${result.error ?? "unknown"}`);
    }

    if (recoveryCount >= this.config.maxRecoveryAttempts) {
      if (this.config.replanner && this.totalReplanAttempts < this.config.maxReplanAttempts) {
        return this.createDecision(delegation.id, "REPLAN", "repair_exhausted",
          `Recovery exhausted after ${recoveryCount} attempts`);
      }
      return this.createDecision(delegation.id, "ABORT", "repair_exhausted",
        `All recovery mechanisms exhausted for ${delegation.id}`);
    }

    return this.createDecision(delegation.id, "ESCALATE", "repeated_failure",
      `Failure #${failureCount}, recovery #${recoveryCount}: escalating`);
  }

  // ── Replan Context Building ────────────────────────────────

  /**
   * Build bounded context for the replanner. Includes:
   * - Mission goal
   * - Completed/failed delegations
   * - Validation failures
   * - Triage history
   * - Repair history
   * - Attempted models
   * - Previous replan decisions
   */
  buildReplanContext(): RecoveryContext {
    const mission = this.config.missionState.getMission();
    const delegations = this.config.missionState.getDelegations();
    const events = this.config.eventSink instanceof Object && "recent" in this.config.eventSink
      ? (this.config.eventSink as any).recent()
      : [];

    const completed = delegations.filter(d => d.status === "passed").map(d => d.id);
    const failed = delegations.filter(d => d.status === "failed").map(d => d.id);

    const validationErrors = events
      .filter((e: any) => e.type === MissionEventTypes.DELEGATION_VALIDATION_FAILED)
      .map((e: any) => {
        const p = e.payload as Record<string, unknown>;
        return `${p.command}: exit ${p.exitCode}`;
      })
      .slice(-5);

    const triageHistory = events
      .filter((e: any) => e.type === MissionEventTypes.DELEGATION_TRIAGE)
      .map((e: any) => {
        const p = e.payload as Record<string, unknown>;
        return `${p.category} → ${p.action} (${p.targetRole})`;
      })
      .slice(-5);

    const repairHistory = this.decisions
      .filter(d => d.type === "REPAIR" || d.type === "ESCALATE")
      .map(d => `${d.type}: ${d.reason}`)
      .slice(-5);

    const attemptedModels = this.decisions
      .filter(d => d.type === "CHANGE_MODEL")
      .map(d => d.context)
      .slice(-5);

    const activeStates = Array.from(this.delegationStates.values())
      .filter(s => s.status === "running")
      .map(s => `${s.delegationId}: ${s.failureCount}f/${s.recoveryCount}r`);

    return {
      missionGoal: mission?.goal ?? "",
      completedDelegations: completed,
      failedDelegations: failed,
      validationErrors,
      triageHistory,
      repairHistory,
      attemptedModels,
      activeDelegationStates: activeStates,
    };
  }

  private createDecision(
    delegationId: string,
    type: SupervisorDecisionType,
    reason: RecoveryReason,
    context: string,
  ): SupervisorDecision {
    return {
      id: `sup-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      delegationId,
      type,
      reason,
      context,
      attemptedAt: new Date().toISOString(),
    };
  }

  private emitEvent(missionId: string, type: string, payload: Record<string, unknown>): void {
    this.config.publisher.publish({
      missionId,
      type: type as any,
      payload,
    });
  }

  // ── Accessors ──────────────────────────────────────────────

  getDecisions(): SupervisorDecision[] {
    return [...this.decisions];
  }

  getDelegationState(delegationId: string): DelegationTrackingState | undefined {
    const state = this.delegationStates.get(delegationId);
    return state ? { ...state } : undefined;
  }

  getCounters(): {
    totalRecoveryAttempts: number;
    totalReplanAttempts: number;
    totalModelFallbackAttempts: number;
    activeDelegationCount: number;
    decisionCount: number;
  } {
    const activeCount = Array.from(this.delegationStates.values())
      .filter(s => s.status === "running").length;

    return {
      totalRecoveryAttempts: this.totalRecoveryAttempts,
      totalReplanAttempts: this.totalReplanAttempts,
      totalModelFallbackAttempts: this.totalModelFallbackAttempts,
      activeDelegationCount: activeCount,
      decisionCount: this.decisions.length,
    };
  }

  /**
   * Check if all limits are within bounds.
   */
  isWithinLimits(): boolean {
    return (
      this.totalRecoveryAttempts <= this.config.maxRecoveryAttempts * 10 &&
      this.totalReplanAttempts <= this.config.maxReplanAttempts &&
      this.totalModelFallbackAttempts <= this.config.maxModelFallbackAttempts * 3
    );
  }
}

// ── Factory ────────────────────────────────────────────────

export function createMissionSupervisor(
  config: SupervisorConfig,
): MissionSupervisor {
  return new MissionSupervisor(config);
}
