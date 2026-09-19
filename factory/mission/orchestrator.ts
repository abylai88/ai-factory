import * as pty from "node-pty";
import {
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
  AuditResult,
  RepairPlan,
  MissionStatus,
  DelegationStatus,
  createAuditResult,
  createRepairPlan,
  AcceptanceCriteriaResult,
  VisualQaResult,
  DiagnosisInput,
  createDelegation,
} from "./mission.js";
import { normalizeVisualQaEvidence } from "./visual-qa-evidence.js";
import { MissionState } from "./state.js";
import { MissionEventSink } from "./mission.js";
import type { ModelRouter } from "./model-router.js";
import { MissionEventPublisher, createMissionEventPublisher, MissionEventTypes } from "./events.js";
import { ValidationGate, type ValidationConfig, type ValidationResult } from "./validation-gate.js";
import { runGoal } from "../pipeline/pipeline-runner.js";
import type { VisualQaAdapter } from "./visual-qa-adapter.js";
import type { RepairExecutor, RepairExecutionResult } from "./repair-executor.js";
import { classifyDiagnosis, generateRepairPlan } from "./diagnosis.js";
import { classifyFailure, buildTriagePrompt, type TriageResult } from "./failure-triage.js";
import { MissionMemory, createMissionMemory } from "./mission-memory.js";
import type { MissionPlanner } from "./mission-planner.js";
import { deriveBlueprintFromGoal, blueprintSliceForRole } from "./blueprint.js";
import { buildDirectorVision, renderDirectorVision } from "./director-vision.js";
import { RepairHistory } from "./repair-history.js";
import { PeerReviewSystem, defaultReviewExecutor, type ReviewExecutor, type ReviewRequest, type ReviewResult } from "./peer-review.js";
import { ArtifactStore, type MissionArtifact } from "./artifact-store.js";
import type { MissionSupervisor } from "./mission-supervisor.js";
import type { SupervisorDecision } from "./mission-supervisor.js";
import { isModelProviderFailure } from "./model-failure-classifier.js";
import { randomUUID } from "node:crypto";

export interface FactoryExecutionAdapter {
  runDelegation(delegation: Delegation, mission: Mission, config: { baseDir: string; project: string; fromStep?: string; model?: string; signal?: AbortSignal }): Promise<AgentResult>;
}

export interface Auditor {
  audit(delegation: Delegation, result: AgentResult, mission: Mission, plan: ExecutionPlan): Promise<AuditResult>;
}

export interface OrchestratorConfig {
  maxRepairs: number;
  baseDir: string;
  project: string;
  factoryAdapter: FactoryExecutionAdapter;
  auditor: Auditor;
  eventSink: MissionEventSink;
  missionState: MissionState;
  visualQaAdapter?: VisualQaAdapter;
  repairExecutor?: RepairExecutor;
  validation?: ValidationConfig;
  replanner?: MissionPlanner;
  maxDynamicDelegations?: number;
  maxReplanAttempts?: number;
  // Phase 8: Peer review
  peerReview?: PeerReviewSystem;
  reviewExecutor?: ReviewExecutor;
  // Phase 8: Model fallback
  modelRouter?: ModelRouter;
  maxModelFallbackAttempts?: number;
  // Phase 9: Supervisor
  supervisor?: MissionSupervisor;
  maxDelegationDurationMs?: number;
  // Global mission timeout
  maxMissionDurationMs?: number;
  // Resume mode: skip startMission, use persisted state
  resume?: boolean;
}

const DEFAULT_MAX_REPAIRS = 3;
// Cap output at 10MB to prevent memory exhaustion from runaway agent output
const MAX_OUTPUT_CHARS = 10_000_000;
// Default global mission timeout: 2 hours
const DEFAULT_MAX_MISSION_DURATION_MS = 2 * 60 * 60 * 1000;

export class MissionOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly publisher: MissionEventPublisher;
  private readonly validationGate: ValidationGate | null;
  private memory: MissionMemory | null = null;
  private currentMission: Mission | null = null;
  private currentPlan: ExecutionPlan | null = null;
  private isRunning = false;
  private readonly readOnlyDelegations = new Set<string>();
  private dynamicDelegations: Delegation[] = [];
  private dynamicDelegationCount = 0;
  private replanCount = 0;
  private artifactStore: ArtifactStore | null = null;
  private repairHistory: RepairHistory | null = null;
  private delegationStartTimes = new Map<string, number>();
  private currentAbortController: AbortController | null = null;

  constructor(config: OrchestratorConfig) {
    this.config = {
      maxRepairs: config.maxRepairs ?? DEFAULT_MAX_REPAIRS,
      maxDynamicDelegations: config.maxDynamicDelegations ?? 10,
      maxReplanAttempts: config.maxReplanAttempts ?? 2,
      baseDir: config.baseDir,
      project: config.project,
      factoryAdapter: config.factoryAdapter,
      auditor: config.auditor,
      eventSink: config.eventSink,
      missionState: config.missionState,
      visualQaAdapter: config.visualQaAdapter,
      repairExecutor: config.repairExecutor,
      validation: config.validation,
      replanner: config.replanner,
      peerReview: config.peerReview,
      reviewExecutor: config.reviewExecutor,
      modelRouter: config.modelRouter,
      maxModelFallbackAttempts: config.maxModelFallbackAttempts,
      maxDelegationDurationMs: config.maxDelegationDurationMs,
      maxMissionDurationMs: config.maxMissionDurationMs,
      supervisor: config.supervisor,
      resume: config.resume,
    };

    // Fail fast if peer review is enabled but no review executor is provided
    if (this.config.peerReview && !this.config.reviewExecutor) {
      throw new Error(
        "Peer review is enabled but no reviewExecutor is configured. " +
        "A real ReviewExecutor must be provided for production use. " +
        "For tests, provide a mock executor that returns passed: true."
      );
    }
    this.publisher = createMissionEventPublisher(this.config.eventSink);
    this.validationGate = config.validation ? new ValidationGate(config.validation) : null;
  }

  async executeMission(mission: Mission, plan: ExecutionPlan): Promise<Mission> {
    this.currentMission = mission;
    this.currentPlan = plan;
    this.isRunning = true;
    this.memory = createMissionMemory(this.config.missionState, this.config.eventSink);
    this.artifactStore = new ArtifactStore(mission.id);
    this.repairHistory = new RepairHistory(this.config.maxRepairs ?? 3);
    this.dynamicDelegations = [];
    this.dynamicDelegationCount = 0;
    this.replanCount = 0;

    // Restore persisted memory from MissionState (survives process restarts;
    // on a fresh mission these are empty). Invalid entries are skipped.
    try {
      const persistedArtifacts = this.config.missionState.getArtifacts();
      if (persistedArtifacts.length > 0) {
        this.artifactStore.importState(persistedArtifacts);
      }
      const persistedRepairs = this.config.missionState.getRepairRecords();
      if (persistedRepairs.length > 0) {
        this.repairHistory.importState(persistedRepairs);
      }
    } catch {
      // Memory hydration never blocks execution.
    }

    // Production Blueprint: structured pre-implementation contract derived
    // from the goal (the Director refines it; specialists consume slices).
    // Derived here so EVERY mission — including resumed ones — has one.
    try {
      const blueprint = deriveBlueprintFromGoal(mission.goal);
      this.currentMission = { ...this.currentMission, blueprint } as Mission;
      this.publisher.publish({
        missionId: mission.id,
        type: "mission.blueprint.created" as any,
        payload: {
          genre: blueprint.genre,
          platform: blueprint.platform,
          coreLoop: blueprint.coreLoop,
          systems: blueprint.requiredSystems,
        },
      });
      // Persist the blueprint decision (platform/genre/core loop) so resume
      // restores direction without re-deriving. Idempotent: skip when an
      // equivalent blueprint decision already exists.
      try {
        const existing = this.config.missionState.getDecisions("blueprint");
        const same = existing.some((d) => d.detail.includes(blueprint.coreLoop));
        if (!same) {
          await this.config.missionState.recordDecision({
            category: "blueprint",
            title: `Blueprint: ${blueprint.genre} (${blueprint.platform})`,
            detail: `Core loop: ${blueprint.coreLoop}. Systems: ${blueprint.requiredSystems.join(", ")}. Acceptance: ${blueprint.acceptanceCriteria.join("; ")}`,
            rationale: `Derived from goal before implementation; Director contract for all specialists.`,
            createdBy: "director",
          });
          const vision = buildDirectorVision(blueprint);
          await this.config.missionState.recordDecision({
            category: "design",
            title: `Director vision: ${blueprint.genre}`,
            detail: renderDirectorVision(vision).slice(0, 2000),
            createdBy: "director",
          });
        }
      } catch {
        // Decision persistence never blocks execution.
      }
    } catch {
      // Blueprint derivation never blocks execution.
    }

    if (this.config.resume) {
      // Resume mode: mission was already started, don't emit started event again.
      // The prepareForResume() call in the CLI already set status to running.
    } else {
      await this.config.missionState.startMission();
    }

    // Phase 9: Emit supervisor started event
    this.publisher.publish({
      missionId: mission.id,
      type: "mission.supervisor.started" as any,
      payload: { missionId: mission.id },
    });

    // Global mission timeout
    const maxMissionDuration = this.config.maxMissionDurationMs ?? DEFAULT_MAX_MISSION_DURATION_MS;
    let missionTimeoutHandle: NodeJS.Timeout | null = null;
    const missionTimeoutPromise = new Promise<Mission>((resolve) => {
      missionTimeoutHandle = setTimeout(() => {
        if (this.isRunning) {
          this.isRunning = false;

          // Abort any in-flight delegation execution
          if (this.currentAbortController) {
            this.currentAbortController.abort();
          }

          this.publisher.publish({
            missionId: mission.id,
            type: "mission.timeout" as any,
            payload: { missionId: mission.id, timeoutMs: maxMissionDuration },
          });
          this.config.missionState.completeMission("failed").then(() => {
            this.currentMission = { ...this.currentMission!, status: "failed" };
            resolve(this.currentMission!);
          });
        }
      }, maxMissionDuration);
    });

    // Phase 9: Stuck detection interval
    let stuckDetectionHandle: NodeJS.Timeout | null = null;
    const stuckDetectionIntervalMs = this.config.maxDelegationDurationMs ?? 30000;
    const runStuckDetection = async () => {
      // Guard: only run if mission is still running and state is initialized
      if (!this.isRunning || !this.config.supervisor || !this.currentMission) return;
      try {
        // Use monotonic time for stuck detection
        const stuckIds = this.config.supervisor.checkStuckDelegations(performance.now());
        for (const stuckId of stuckIds) {
          const stuckDel = this.config.missionState.getDelegation(stuckId);
          if (stuckDel && stuckDel.status === "running") {
            const decision = await this.config.supervisor.handleStuckDelegation(stuckId, mission.id);
            if (decision) {
              // Execute the stuck recovery decision
              const agentResult: AgentResult = {
                delegationId: stuckId,
                status: "failed",
                output: "",
                error: "Stuck delegation",
                durationMs: 0,
              };
              await this.executeRecoveryDecision(stuckDel, agentResult, decision);
            }
          }
        }
      } catch {
        // Ignore errors in stuck detection to avoid crashing the mission
      }
    };
    stuckDetectionHandle = setInterval(runStuckDetection, stuckDetectionIntervalMs);

    try {
      const executionPromise = (async () => {
        const graphSuccess = await this.executeDelegationGraph(plan.delegations);

        if (!graphSuccess) {
          // Phase 9: Check for stuck delegations before failing
          const stuckIds = this.config.supervisor?.checkStuckDelegations(performance.now()) ?? [];
          for (const stuckId of stuckIds) {
            const stuckDel = this.config.missionState.getDelegation(stuckId);
            if (stuckDel) {
              await this.config.supervisor?.handleStuckDelegation(stuckId, mission.id);
            }
          }

          await this.config.missionState.completeMission("failed");
          this.currentMission = { ...this.currentMission!, status: "failed" };
          return this.currentMission;
        }

        // Execute any dynamically added delegations
        while (this.dynamicDelegations.length > 0 && this.isRunning) {
          const batch = this.dynamicDelegations.splice(0);
          for (const del of batch) {
            if (!this.isRunning) break;
            if (!this.canRunDelegation(del)) {
              await this.config.missionState.completeDelegation(del.id, "blocked", undefined, "Dependencies not met");
              continue;
            }
            await this.processSingleDelegation(del);
          }
        }

        if (!this.isRunning) {
          await this.config.missionState.completeMission("failed");
          this.currentMission = { ...this.currentMission!, status: "failed" };
          return this.currentMission;
        }

        await this.config.missionState.completeMission("completed");
        this.currentMission = { ...this.currentMission!, status: "completed" };
        return this.currentMission;
      })();

      return await Promise.race([executionPromise, missionTimeoutPromise]);
    } finally {
      if (missionTimeoutHandle) {
        clearTimeout(missionTimeoutHandle);
      }
      if (stuckDetectionHandle) {
        clearInterval(stuckDetectionHandle);
      }
      this.isRunning = false;
    }
  }

  private async executeDelegationGraph(allDelegations: Delegation[]): Promise<boolean> {
    const delegations = [...allDelegations];

    // Initialize completed/failed sets from persisted state for resume support.
    // On fresh missions, these sets are empty. On resume, they contain
    // delegations that already completed successfully or failed permanently
    // (budget exhausted). Repair delegations (retryOf set) are always skipped.
    // Resumable delegations (failed with budget, blocked, queued) are NOT
    // added to either set — they'll be processed normally by the graph loop.
    const completed = new Set<string>();
    const failed = new Set<string>();

    if (this.config.resume) {
      const resumeState = this.config.missionState.getResumeState();
      for (const id of resumeState.completed) completed.add(id);
      for (const id of resumeState.failed) failed.add(id);
      // resumeState.resumable delegations are NOT added to failed — they will
      // be processed by the graph loop like any other queued delegation.
    }

    // Track delegations that failed during THIS graph execution (blocked or
    // executed-but-failed). Pre-existing failures from resume state are NOT
    // included — they only cause graph failure if their downstreams are blocked.
    const failedDuringExecution = new Set<string>();

    while (delegations.length > 0 && this.isRunning) {
      const ready: Delegation[] = [];
      const waiting: Delegation[] = [];

      for (const del of delegations) {
        // Skip delegations that already completed (resume support)
        if (completed.has(del.id) || failed.has(del.id)) {
          continue;
        }

        const depsMet = del.dependsOn.every((depId) => completed.has(depId));
        const depsNotFailed = del.dependsOn.every((depId) => !failed.has(depId));

        if (depsMet && depsNotFailed) {
          ready.push(del);
        } else if (!depsNotFailed) {
          // A dependency failed. During resume, check if the failed dependency
          // produced partial artifacts that satisfy the downstream task.
          const failedDeps = del.dependsOn.filter((depId) => failed.has(depId));
          const allFailedDepsHaveArtifacts = failedDeps.every((depId) =>
            this.config.missionState.hasDelegationArtifact(depId)
          );

          if (allFailedDepsHaveArtifacts && this.config.resume) {
            // Failed deps have partial artifacts — treat as effectively satisfied
            // so downstream can use existing artifacts to continue.
            ready.push(del);
          } else {
            // Truly blocked — upstream has no usable artifact or not resume mode
            const reason = this.config.resume
              ? "Upstream dependency failed with no usable artifact"
              : "Upstream dependency failed";
            await this.config.missionState.completeDelegation(del.id, "blocked", undefined, reason);
            failed.add(del.id);
            failedDuringExecution.add(del.id);
          }
        } else {
          waiting.push(del);
        }
      }

      // Emit blocked events for waiting delegations
      for (const del of waiting) {
        this.publisher.publish({
          missionId: del.missionId,
          type: "delegation.blocked" as any,
          payload: { delegationId: del.id, waitingFor: del.dependsOn.filter(d => !completed.has(d)) },
        });
      }

      if (ready.length === 0) {
        if (waiting.length > 0) {
          // Deadlock — all remaining are waiting but none completed
          for (const del of waiting) {
            await this.config.missionState.completeDelegation(del.id, "blocked", undefined, "Deadlock: dependencies cannot be satisfied");
            failed.add(del.id);
            failedDuringExecution.add(del.id);
          }
        }
        break;
      }

      // Separate into parallel and sequential
      const parallel = ready.filter((d) => d.parallelizable);
      const sequential = ready.filter((d) => !d.parallelizable);

      // Execute parallel delegations concurrently (or single parallel sequentially)
      if (parallel.length > 1) {
        const results = await Promise.allSettled(
          parallel.map(async (del) => {
            this.publisher.publish({
              missionId: del.missionId,
              type: "delegation.ready" as any,
              payload: { delegationId: del.id },
            });
            return this.processSingleDelegation(del);
          })
        );

        for (let i = 0; i < parallel.length; i++) {
          const del = parallel[i];
          const result = results[i];
          if (result.status === "fulfilled" && result.value.status === "passed") {
            completed.add(del.id);
          } else {
            failed.add(del.id);
            failedDuringExecution.add(del.id);
          }
        }

        // Also execute sequential delegations one at a time
        for (const del of sequential) {
          if (!this.isRunning) break;
          this.publisher.publish({
            missionId: del.missionId,
            type: "delegation.ready" as any,
            payload: { delegationId: del.id },
          });
          const result = await this.processSingleDelegation(del);
          if (result.status === "passed") {
            completed.add(del.id);
          } else {
            failed.add(del.id);
            failedDuringExecution.add(del.id);
          }
        }
      } else {
        // Execute all ready delegations sequentially (0 or 1 parallel + sequential)
        const allReady = [...parallel, ...sequential];
        for (const del of allReady) {
          if (!this.isRunning) break;
          this.publisher.publish({
            missionId: del.missionId,
            type: "delegation.ready" as any,
            payload: { delegationId: del.id },
          });
          const result = await this.processSingleDelegation(del);
          if (result.status === "passed") {
            completed.add(del.id);
          } else {
            failed.add(del.id);
            failedDuringExecution.add(del.id);
          }
        }
      }

      // Remove processed delegations
      for (const del of ready) {
        const idx = delegations.indexOf(del);
        if (idx !== -1) delegations.splice(idx, 1);
      }
    }

    // Fail the graph if any delegation failed or was blocked during THIS execution.
    // Pre-existing failures from resume state are tolerated if their downstreams
    // can proceed via partial artifacts.
    if (failedDuringExecution.size > 0) {
      return false;
    }
    return true;
  }

  private async processSingleDelegation(delegation: Delegation): Promise<AgentResult> {
    // Phase 9: Record delegation start time for stuck detection
    if (!this.delegationStartTimes.has(delegation.id)) {
      this.delegationStartTimes.set(delegation.id, Date.now());
    }

    // Track current execution for cancellation support
    const executionPromise = this.executeDelegation(delegation);
    this.currentExecution = executionPromise;

    let agentResult: AgentResult;
    try {
      agentResult = await executionPromise;
    } finally {
      this.currentExecution = null;
    }

    if (!this.isRunning) return agentResult;

    // Phase 8: track whether audit repair elevated a failed delegation to passed
    let auditRecovered = false;
    // Track whether supervisor recovery (REPAIR/CHANGE_MODEL) succeeded
    let supervisorRecovered = false;

    // ── Phase 9: Notify supervisor of delegation failure ──
    let supervisorDecision: SupervisorDecision | undefined;
    if (agentResult.status === "failed" && this.config.supervisor) {
      supervisorDecision = await this.config.supervisor.handleDelegationFailure(delegation, agentResult);
    }

    // Execute recovery decision if supervisor provided one
    if (supervisorDecision && this.isRunning) {
      const recoverySuccess = await this.executeRecoveryDecision(delegation, agentResult, supervisorDecision);
      if (recoverySuccess) {
        // For REPAIR and CHANGE_MODEL, the original delegation is updated in MissionState.
        // Re-fetch the agentResult to get the recovered output.
        // For REPLAN, the original delegation is NOT fixed; don't mark as recovered.
        if (supervisorDecision.type === "REPAIR" || supervisorDecision.type === "CHANGE_MODEL") {
          agentResult = await this.getAgentResult(delegation.id);
          supervisorRecovered = true;
        }
        // For REPLAN: recoverySuccess means a new plan was created, but the original
        // delegation remains failed. Let it proceed through gates (will fail) or be
        // handled by the new dynamic delegations.
      }
    }

    // Validation gate
    if (this.validationGate && agentResult.status === "passed" && !agentResult.readOnly) {
      const validationResult = await this.runValidation(delegation, agentResult);
      if (!validationResult.passed) {
        const repaired = await this.repairValidationFailure(delegation, validationResult);
        if (!repaired) {
          // Check if replanning should be attempted
          if (this.config.replanner && this.replanCount < (this.config.maxReplanAttempts ?? 2)) {
            const replanned = await this.attemptReplan(delegation);
            if (replanned) return { ...agentResult, status: "passed" };
          }
          return { ...agentResult, status: "failed" };
        }
      }
    }

    // Visual QA
    const isBuilder = delegation.description.includes("ROLE: builder") || delegation.description.includes("BUILD_COMMAND:");
    if (isBuilder && agentResult.status === "passed" && this.currentMission?.context?.requiresVisualQa) {
      await this.runVisualQa(delegation);

      const currentQa = this.currentMission?.visualQa;
      if (currentQa && currentQa.status === "failed" && this.config.repairExecutor) {
        const healed = await this.selfHealingLoop(delegation);
        if (!healed) {
          return { ...agentResult, status: "failed" };
        }
        return { ...agentResult, status: "passed" };
      }
    }

    // Audit
    const auditResult = await this.auditDelegation(delegation);

    if (auditResult.status === "FAIL") {
      const repaired = await this.repairDelegation(delegation, auditResult);
      if (!repaired) {
        // Check if replanning should be attempted after audit repair failure
        if (this.config.replanner && this.replanCount < (this.config.maxReplanAttempts ?? 2)) {
          const replanned = await this.attemptReplan(delegation);
          if (replanned) return { ...agentResult, status: "passed" };
        }
        return { ...agentResult, status: "failed" };
      }

      const reauditResult = await this.auditDelegation(delegation);
      if (reauditResult.status === "FAIL") {
        // Check if replanning should be attempted after re-audit failure
        if (this.config.replanner && this.replanCount < (this.config.maxReplanAttempts ?? 2)) {
          const replanned = await this.attemptReplan(delegation);
          if (replanned) return { ...agentResult, status: "passed" };
        }
        return { ...agentResult, status: "failed" };
      }

      // Audit repair succeeded and re-audit passed: the delegation has been recovered
      auditRecovered = true;
    }

    // Phase 8: Independent peer review
    // The agent must NOT be the only authority validating its own work.
    // If the delegation requires review, route to an independent reviewer.
    if (delegation.requiresReview && agentResult.status === "passed" && this.config.peerReview) {
      const reviewed = await this.peerReviewDelegation(delegation, agentResult);
      if (!reviewed) {
        return { ...agentResult, status: "failed" };
      }
      // Peer review passed (including any review-driven repairs).
      // Re-audit the delegation to ensure the final artifact passes audit.
      const reauditResult = await this.auditDelegation(delegation);
      if (reauditResult.status === "FAIL") {
        // Check if replanning should be attempted after re-audit failure
        if (this.config.replanner && this.replanCount < (this.config.maxReplanAttempts ?? 2)) {
          const replanned = await this.attemptReplan(delegation);
          if (replanned) return { ...agentResult, status: "passed" };
        }
        return { ...agentResult, status: "failed" };
      }
    }

    // If audit repair or supervisor recovery (REPAIR/CHANGE_MODEL) recovered a failed
    // agentResult, return passed. Otherwise preserve the original agentResult status.
    if (auditRecovered || supervisorRecovered) {
      return { ...agentResult, status: "passed" };
    }

    // Phase 8 Gap 2: Automatically register artifacts from successful delegations
    if (agentResult.status === "passed" && this.artifactStore) {
      this.collectAndRegisterArtifacts(delegation, agentResult);
      // Persist artifacts so they survive process restarts (meaningful
      // transition: delegation completed with new artifacts).
      await this.persistArtifactStore();
    }

    // Phase 9: Notify supervisor of completion
    this.config.supervisor?.observeDelegationCompleted(delegation.id, agentResult);

    return agentResult;
  }

  /**
   * Execute a recovery decision using existing orchestrator mechanisms.
   * Handles: REPAIR, REPLAN, CHANGE_MODEL, ESCALATE, ABORT decisions.
   * Returns true if recovery was attempted (may still fail), false if no action needed.
   */
  private async executeRecoveryDecision(
    delegation: Delegation,
    agentResult: AgentResult,
    decision: SupervisorDecision,
  ): Promise<boolean> {
    switch (decision.type) {
      case "REPAIR": {
        // Use the orchestrator's existing repair mechanism
        const repaired = await this.repairDelegation(delegation, {
          recommendedRepair: {
            description: agentResult.error ?? `Fix failed delegation: ${delegation.title}`,
            focusAreas: ["general repair"],
          },
        } as AuditResult);
        return repaired !== false;
      }

      case "REPLAN": {
        if (this.config.replanner && this.replanCount < (this.config.maxReplanAttempts ?? 2)) {
          const replanned = await this.attemptReplan(delegation);
          return replanned;
        }
        return false;
      }

      case "CHANGE_MODEL": {
        if (this.config.modelRouter) {
          const route = this.config.modelRouter.chooseModel({
            delegation,
            role: delegation.role ?? "Developer",
            mission: this.currentMission!,
          });
          let currentModel = route.primary;
          for (let i = 0; i < (this.config.maxModelFallbackAttempts ?? 3); i++) {
            const nextModel = this.config.modelRouter!.nextFallback(route, currentModel);
            if (!nextModel) break;
            currentModel = nextModel;
            // Execute with the specific fallback model
            const result = await this.executeDelegation(delegation, currentModel);
            if (result.status === "passed") return true;
          }
          return false;
        }
        return false;
      }

      case "ESCALATE": {
        // Escalation is handled by the supervisor's escalation logic;
        // the orchestrator logs the escalation. Returns false because escalation
        // does not recover the delegation — it signals the delegation needs attention.
        this.publisher.publish({
          missionId: delegation.missionId,
          type: MissionEventTypes.DELEGATION_ESCALATED,
          payload: {
            delegationId: delegation.id,
            reason: decision.reason,
          },
        });
        return false;
      }

      case "ABORT": {
        // Abort the delegation - mark as failed and do not retry.
        // Return false to indicate recovery was NOT successful; the delegation has failed.
        await this.config.missionState.completeDelegation(delegation.id, "failed",
          agentResult.output, agentResult.error);
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Build the bounded role-specific handoff block for a delegation.
   * Returns "" when there is nothing to add (keeps prompts unchanged).
   */
  private buildHandoffBlock(delegation: Delegation): string {
    const parts: string[] = [];
    const role = delegation.role ?? "Developer";
    const blueprint = (this.currentMission as any)?.blueprint;
    if (blueprint && typeof blueprint === "object") {
      try {
        parts.push(`BLUEPRINT:\n${blueprintSliceForRole(blueprint as any, String(role)).slice(0, 1000)}`);
      } catch {
        // Blueprint slice never blocks execution.
      }
    }
    if (this.memory) {
      try {
        const mem = this.memory.buildContextBlock(delegation.id);
        if (mem && mem.trim()) parts.push(`MISSION MEMORY:\n${mem.slice(0, 1500)}`);
      } catch {
        // Memory enrichment is best-effort.
      }
    }
    if (this.artifactStore) {
      try {
        const arts = this.artifactStore.buildArtifactContext({ delegation, maxChars: 800 });
        if (arts && !/\(none\)/.test(arts)) parts.push(arts.slice(0, 800));
      } catch {
        // Artifact context is best-effort.
      }
    }
    if (parts.length === 0) return "";
    const block = `CONTEXT HANDOFF (summarized — original task above is authoritative):\n${parts.join("\n\n")}`;
    return block.slice(0, 3000);
  }

  /**
   * Phase 8 Gap 2: Automatically register artifacts produced by a delegation.
   * Parses the agent output for file paths and registers lightweight metadata.
   * Does not store raw file contents.
   */
  private collectAndRegisterArtifacts(delegation: Delegation, agentResult: AgentResult): void {
    if (!this.artifactStore || !this.currentMission) return;

    // Infer artifact type from role/description
    const artifactType = this.inferArtifactType(delegation);

    // Extract file paths from output (common patterns in delegation results)
    const filePaths = this.extractFilePathsFromOutput(agentResult.output);

    // If output declares specific paths, use those
    const declaredOutputs = this.extractDeclaredOutputs(delegation);

    const pathsToRegister = [...new Set([...filePaths, ...declaredOutputs])];

    // Register each artifact (bounded by store limits)
    for (const filePath of pathsToRegister.slice(0, 10)) {
      const artifact = this.artifactStore.registerArtifact({
        delegationId: delegation.id,
        type: artifactType,
        title: `${delegation.title} - ${filePath.split("/").pop() ?? filePath}`,
        summary: `Created/modified by ${delegation.title}`,
        createdByRole: delegation.role ?? "Developer",
        path: filePath,
      });

      this.publisher.publish({
        missionId: delegation.missionId,
        type: "delegation.artifact.created" as any,
        payload: {
          delegationId: delegation.id,
          artifactId: artifact.id,
          type: artifact.type,
          path: filePath,
        },
      });
    }

    // If no paths found but delegation produced output, register a single report artifact
    if (pathsToRegister.length === 0 && agentResult.output.length > 0) {
      const artifact = this.artifactStore.registerArtifact({
        delegationId: delegation.id,
        type: "report",
        title: `${delegation.title} output`,
        summary: agentResult.output.slice(0, 200),
        createdByRole: delegation.role ?? "Developer",
      });

      this.publisher.publish({
        missionId: delegation.missionId,
        type: "delegation.artifact.created" as any,
        payload: {
          delegationId: delegation.id,
          artifactId: artifact.id,
          type: artifact.type,
        },
      });
    }
  }

  /**
   * Persist the in-memory ArtifactStore into MissionState (the single
   * persistence system). Best-effort: never blocks delegation execution.
   */
  private async persistArtifactStore(): Promise<void> {
    if (!this.artifactStore) return;
    try {
      await this.config.missionState.syncArtifacts(this.artifactStore.exportState());
    } catch {
      // Persistence is best-effort at this layer; snapshot retry happens on
      // the next meaningful transition.
    }
  }

  /**
   * Persist the in-memory RepairHistory into MissionState so repeat
   * detection survives restarts. Best-effort.
   */
  private async persistRepairHistory(): Promise<void> {
    if (!this.repairHistory) return;
    try {
      await this.config.missionState.syncRepairRecords(this.repairHistory.exportState());
    } catch {
      // Best-effort; retried on the next repair transition.
    }
  }

  /**
   * Infer artifact type from delegation role and description.
   */
  private inferArtifactType(delegation: Delegation): MissionArtifact["type"] {
    const desc = delegation.description.toLowerCase();
    const role = delegation.role;

    if (role === "QA" || desc.includes("test")) return "test";
    if (role === "Researcher" || desc.includes("research") || desc.includes("analysis")) return "research";
    if (role === "Designer" || desc.includes("design") || desc.includes("ui")) return "design";
    if (desc.includes("build") || desc.includes("compile")) return "code";
    return "code"; // default for Developer/Repair/Architect
  }

  /**
   * Extract file paths from delegation output text.
   * Looks for common patterns like src/..., tests/..., *.ts, *.js files.
   */
  private extractFilePathsFromOutput(output: string): string[] {
    const paths: string[] = [];
    // Match common file path patterns
    const pathRegex = /(?:^|\s)((?:src|lib|tests?|app|pages|components?|utils?|public|assets?)\/[\w./-]+\.\w{1,5})\b/gm;
    let match;
    while ((match = pathRegex.exec(output)) !== null) {
      const p = match[1]?.trim();
      if (p && p.length < 200 && !paths.includes(p)) {
        paths.push(p);
      }
    }
    return paths.slice(0, 10); // bound
  }

  /**
   * Extract declared outputs from delegation description/metadata.
   */
  private extractDeclaredOutputs(delegation: Delegation): string[] {
    const outputs: string[] = [];
    // Look for FILE: markers in description
    const fileRegex = /FILE:\s*([\w./-]+\.\w{1,5})/gi;
    let match;
    while ((match = fileRegex.exec(delegation.description)) !== null) {
      const p = match[1]?.trim();
      if (p && p.length < 200 && !outputs.includes(p)) {
        outputs.push(p);
      }
    }
    return outputs.slice(0, 10);
  }

  /**
   * Phase 8 Gap 1: Run an independent peer review on a delegation with a
   * bounded retry loop. On each failure, create a repair delegation and
   * re-review. Loop respects PeerReviewSystem.maxReviewAttempts.
   *
   * Returns true if the delegation is approved (review passed or skipped).
   * Returns false if all review attempts were exhausted.
   */
  private async peerReviewDelegation(
    delegation: Delegation,
    agentResult: AgentResult,
  ): Promise<boolean> {
    const reviewSystem = this.config.peerReview;
    if (!reviewSystem || !this.currentMission) return true;

    const executor = this.config.reviewExecutor;
    const maxAttempts = Math.max(1, reviewSystem.getMaxAttempts());

    // Track the latest review target (the original on the first attempt,
    // a fresh review request on each retry) and the most recent review result.
    let lastReviewRequest: ReviewRequest | null = null;
    let attempt = 0;

    // Helper to get current artifact paths from the artifact store
    // Includes artifacts from the original delegation AND any repair delegations
    const getCurrentArtifactPaths = (): string[] => {
      if (!this.artifactStore) return [];
      const artifacts = this.artifactStore.getArtifactsForDelegation(delegation.id);
      // Also include artifacts from repair delegations (retryOf = original delegation ID)
      const allArtifacts = this.artifactStore.getArtifactsForMission();
      const repairArtifacts = allArtifacts.filter(a => a.delegationId !== delegation.id &&
        // Check if this artifact's delegation is a repair of the original
        // We can identify repairs by checking if there's a delegation with retryOf = delegation.id
        // For simplicity, include all artifacts from delegations that depend on the original
        allArtifacts.some(a2 => a2.delegationId === a.delegationId &&
          this.config.missionState.getDelegation(a.delegationId)?.retryOf === delegation.id));
      const combined = [...artifacts, ...repairArtifacts];
      return combined.map(a => a.path).filter((p): p is string => Boolean(p));
    };

    while (attempt < maxAttempts) {
      attempt++;

      // Get current artifact paths for this review attempt (reflects any repairs)
      const currentArtifactPaths = getCurrentArtifactPaths();

      const request: ReviewRequest | null = lastReviewRequest
        ? reviewSystem.createReviewRequest({
            delegation,
            agentResult: { ...agentResult, status: "passed" as const },
            mission: this.currentMission,
            validationPassed: true,
            currentArtifactPaths,
          })
        : reviewSystem.createReviewRequest({
            delegation,
            agentResult,
            mission: this.currentMission,
            validationPassed: true,
            currentArtifactPaths,
          });

      if (!request) {
        // No review needed (e.g., no role or self-review would be required)
        return true;
      }
      lastReviewRequest = request;

      this.publisher.publish({
        missionId: delegation.missionId,
        type: "delegation.review.started" as any,
        payload: {
          delegationId: delegation.id,
          reviewerRole: request.reviewerRole,
          originalRole: request.originalRole,
          attempt,
          maxAttempts,
        },
      });

      // Run the review using the configured review executor
      if (!executor) {
        // No executor configured but review is required — this is a configuration error.
        // Fail the review to prevent silent bypass of the quality gate.
        this.publisher.publish({
          missionId: delegation.missionId,
          type: "delegation.review.failed" as any,
          payload: {
            delegationId: delegation.id,
            reviewerRole: request.reviewerRole,
            issues: [{ severity: "critical", description: "Peer review required but no review executor configured" }],
            summary: "Review executor not configured",
            attempt,
            maxAttempts,
          },
        });
        return false;
      }

      const result = await reviewSystem.conductReview(request, executor);

      if (result.passed) {
        this.publisher.publish({
          missionId: delegation.missionId,
          type: "delegation.review.passed" as any,
          payload: {
            delegationId: delegation.id,
            reviewerRole: result.reviewerRole,
            summary: result.summary,
            attempt,
          },
        });
        return true;
      }

      // Review failed
      this.publisher.publish({
        missionId: delegation.missionId,
        type: "delegation.review.failed" as any,
        payload: {
          delegationId: delegation.id,
          reviewerRole: result.reviewerRole,
          issues: result.issues,
          summary: result.summary,
          attempt,
          maxAttempts,
        },
      });

      // If we've exhausted the budget, fail
      if (attempt >= maxAttempts) {
        return false;
      }

      // Build a review-driven repair delegation
      const reviewRepairDelegation = this.createReviewRepairDelegation(
        delegation,
        request,
        result,
        attempt,
      );
      await this.config.missionState.addDelegation(reviewRepairDelegation);

      // Run the review-driven repair
      const repairResult = await this.executeDelegation(reviewRepairDelegation);
      if (repairResult.status !== "passed") {
        // Repair itself failed; continue to next attempt for re-review.
        // The next iteration's `agentResult` is the original (unchanged) so
        // the review target stays anchored on the original work.
        continue;
      }

      // Repair succeeded; loop continues with the next re-review.
      // The next iteration creates a new request from the original delegation
      // but with `status: "passed"` so the reviewer can re-evaluate.
    }

    return false;
  }

  /**
   * Create a delegation that performs a repair based on review feedback.
   * Includes attempt number, MissionMemory context, and relevant artifacts.
   */
  private createReviewRepairDelegation(
    original: Delegation,
    request: ReviewRequest,
    result: ReviewResult,
    attempt: number,
  ): Delegation {
    const issuesText = result.issues
      .map((i) => `- [${i.severity}] ${i.description}${i.suggestedAction ? ` (suggested: ${i.suggestedAction})` : ""}`)
      .join("\n");

    const memoryBlock = this.memory?.buildContextBlock(original.id) ?? "";

    const description = [
      `REVIEW REWORK for: ${original.title} (attempt ${attempt})`,
      ``,
      `Original task: ${original.description}`,
      ``,
      `Reviewer (${request.reviewerRole}) found the following issues:`,
      issuesText,
      ``,
      `Address all issues above. The work will be re-reviewed.`,
      ``,
      memoryBlock ? `MISSION CONTEXT:\n${memoryBlock}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `rev-repair-${original.id}-${attempt}-${randomUUID().slice(0, 6)}`,
      missionId: original.missionId,
      objectiveId: original.objectiveId,
      title: `[Review Repair ${attempt}] ${original.title}`,
      description,
      pipelineType: original.pipelineType,
      dependsOn: [original.id],
      parallelizable: false,
      acceptanceCriteria: [
        ...(original.acceptanceCriteria ?? []),
        "All review issues addressed",
      ],
      status: "queued",
      createdAt: new Date().toISOString(),
      role: "Repair",
      retryOf: original.id,
    };
  }

  // ─── Phase 9B: Self-Healing Loop ──────────────────────────────────

  private async selfHealingLoop(buildDelegation: Delegation): Promise<boolean> {
    const executor = this.config.repairExecutor!;
    const maxCycles = 3;

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (!this.isRunning) return false;

      this.currentMission = this.config.missionState.getMission();
      buildDelegation = this.config.missionState.getDelegation(buildDelegation.id) ?? buildDelegation;

      // Step 1: Create Diagnosis
      await this.config.missionState.recordDiagnosisStarted();
      this.publisher.publish({
        missionId: buildDelegation.missionId,
        type: MissionEventTypes.MISSION_DIAGNOSIS_STARTED,
        payload: { cycle },
      });

      const diagnosisInput = this.buildDiagnosisInput(buildDelegation);
      const diagnosis = classifyDiagnosis(diagnosisInput);

      // Step 2: Generate RepairPlan
      const repairPlan = generateRepairPlan(diagnosisInput, diagnosis, maxCycles);

      await this.config.missionState.recordDiagnosisCompleted(diagnosis, repairPlan);
      this.publisher.publish({
        missionId: buildDelegation.missionId,
        type: MissionEventTypes.MISSION_DIAGNOSIS_COMPLETED,
        payload: {
          diagnosisId: diagnosis.id,
          category: diagnosis.category,
          severity: diagnosis.severity,
          confidence: diagnosis.confidence,
          repairPlanId: repairPlan.id,
          actionCount: repairPlan.actions.length,
          cycle,
        },
      });

      // Step 3: Execute Repair
      await this.config.missionState.recordRepairStarted(repairPlan.id, cycle);
      this.publisher.publish({
        missionId: buildDelegation.missionId,
        type: MissionEventTypes.MISSION_REPAIR_STARTED,
        payload: { repairPlanId: repairPlan.id, cycle, actionCount: repairPlan.actions.length },
      });

      let repairResult: RepairExecutionResult;
      try {
        repairResult = await executor.execute(
          this.currentMission!,
          repairPlan,
          this.config.project
        );
      } catch (error) {
        repairResult = {
          status: "failed",
          changedFiles: [],
          actionsCompleted: 0,
          actionsFailed: repairPlan.actions.length,
          summary: `Repair execution error: ${error instanceof Error ? error.message : String(error)}`,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
      }

      if (repairResult.status === "rejected" || repairResult.status === "failed") {
        await this.config.missionState.recordRepairFailed(repairPlan.id, cycle, repairResult.summary);
        this.publisher.publish({
          missionId: buildDelegation.missionId,
          type: MissionEventTypes.MISSION_REPAIR_FAILED,
          payload: {
            repairPlanId: repairPlan.id,
            cycle,
            status: repairResult.status,
            summary: repairResult.summary,
            changedFileCount: repairResult.changedFiles.length,
            actionCount: repairPlan.actions.length,
          },
        });

        if (cycle >= maxCycles) return false;
        continue;
      }

      await this.config.missionState.recordRepairCompleted(repairPlan.id, cycle, {
        status: repairResult.status,
        changedFiles: repairResult.changedFiles,
        actionsCompleted: repairResult.actionsCompleted,
        actionsFailed: repairResult.actionsFailed,
      });
      this.publisher.publish({
        missionId: buildDelegation.missionId,
        type: MissionEventTypes.MISSION_REPAIR_COMPLETED,
        payload: {
          repairPlanId: repairPlan.id,
          cycle,
          status: repairResult.status,
          changedFileCount: repairResult.changedFiles.length,
          actionCount: repairResult.actionsCompleted,
        },
      });

      // Step 4: Rebuild (create fresh build delegation)
      const buildResult = await this.executeRebuildDelegation(buildDelegation, cycle);
      if (buildResult.status === "failed") {
        if (cycle >= maxCycles) return false;
        continue;
      }

      // Step 5: Re-run Visual QA (if verification plan includes it)
      if (repairPlan.verificationPlan.steps.includes("visual-qa")) {
        const freshBuildDelegation = this.createRebuildDelegation(buildDelegation, cycle);
        await this.runVisualQa(freshBuildDelegation);

        const currentQa = this.currentMission?.visualQa;
        if (currentQa && currentQa.status === "failed") {
          if (cycle >= maxCycles) return false;
          continue;
        }
      }

      // Step 6: Fresh audit on post-repair state
      this.currentMission = this.config.missionState.getMission();
      const freshBuildDel = this.createRebuildDelegation(buildDelegation, cycle);
      const auditResult = await this.auditDelegation(freshBuildDel);

      if (auditResult.status === "PASS") {
        return true;
      }

      if (cycle >= maxCycles) return false;
    }

    return false;
  }

  private buildDiagnosisInput(buildDelegation: Delegation): DiagnosisInput {
    const mission = this.currentMission!;
    const qaResult = mission.visualQa;
    const qaEvidence = mission.visualQaEvidence;

    const failedChecks: Array<{ name: string; viewport: string; message?: string }> = [];
    if (qaResult?.checkDetails) {
      for (const check of qaResult.checkDetails) {
        if (check.status === "failed") {
          failedChecks.push({
            name: check.name,
            viewport: check.viewport,
            message: check.message,
          });
        }
      }
    }

    return {
      missionId: mission.id,
      projectId: mission.context?.projectId ?? "unknown",
      projectPath: this.config.project,
      acceptanceCriteria: buildDelegation.acceptanceCriteria,
      buildFailed: buildResultFromDelegation(buildDelegation) === "failed",
      buildError: buildDelegation.error,
      runtimeErrors: qaResult?.errors ?? [],
      visualQaStatus: qaResult?.status ?? "skipped",
      visualQaEvidence: qaEvidence,
      failedChecks,
      artifactMetadata: (qaResult?.artifacts ?? []).map((a) => ({
        id: a.id,
        type: a.type,
        label: a.label,
      })),
      affectedFiles: this.extractAffectedFiles(buildDelegation),
      engine: mission.context?.engine,
    };
  }

  private extractAffectedFiles(delegation: Delegation): string[] {
    const files: string[] = [];
    const output = delegation.result ?? "";
    const filePattern = /\b([\w/.-]+\.(?:ts|js|json|html|css|lua|luau))\b/g;
    let match;
    while ((match = filePattern.exec(output)) !== null) {
      files.push(match[1]);
    }
    return [...new Set(files)];
  }

  private async executeRebuildDelegation(originalDelegation: Delegation, cycle: number): Promise<AgentResult> {
    const rebuildDelegation = this.createRebuildDelegation(originalDelegation, cycle);

    await this.config.missionState.addDelegation(rebuildDelegation);
    await this.config.missionState.startDelegation(rebuildDelegation.id, "");

    this.publisher.publish({
      missionId: rebuildDelegation.missionId,
      type: MissionEventTypes.DELEGATION_STARTED,
      payload: {
        delegationId: rebuildDelegation.id,
        title: rebuildDelegation.title,
      },
    });

    let agentResult: AgentResult;
    try {
      const adapterResult = await this.config.factoryAdapter.runDelegation(
        rebuildDelegation,
        this.currentMission!,
        { baseDir: this.config.baseDir, project: this.config.project }
      );

      agentResult = {
        delegationId: rebuildDelegation.id,
        pipelineId: adapterResult.pipelineId,
        status: adapterResult.status,
        output: adapterResult.output,
        error: adapterResult.error,
        durationMs: adapterResult.durationMs,
      };
    } catch (error) {
      agentResult = {
        delegationId: rebuildDelegation.id,
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      };
    }

    const finalStatus: DelegationStatus = agentResult.status === "passed" ? "passed" : "failed";
    await this.config.missionState.completeDelegation(
      rebuildDelegation.id,
      finalStatus,
      agentResult.output,
      agentResult.error
    );

    this.publisher.publish({
      missionId: rebuildDelegation.missionId,
      type: MissionEventTypes.DELEGATION_COMPLETED,
      payload: {
        delegationId: rebuildDelegation.id,
        title: rebuildDelegation.title,
        status: finalStatus,
        pipelineId: agentResult.pipelineId,
      },
    });

    return agentResult;
  }

  private createRebuildDelegation(original: Delegation, cycle: number): Delegation {
    return {
      ...original,
      id: `rebuild-${original.id}-cycle-${cycle}`,
      title: `[REBUILD cycle ${cycle}] ${original.title}`,
      description: original.description,
      stepIds: undefined,
      dependsOn: [],
      parallelizable: false,
      status: "queued",
      createdAt: new Date().toISOString(),
    };
  }

  async executeDelegation(delegation: Delegation, modelOverride?: string): Promise<AgentResult> {
    await this.config.missionState.startDelegation(delegation.id, "");
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.DELEGATION_STARTED,
      payload: { delegationId: delegation.id, title: delegation.title },
    });

    // Phase 9: Notify supervisor
    this.config.supervisor?.observeDelegationStarted(delegation);

    const startTime = Date.now();
    let agentResult: AgentResult;
    let lastError: string | null = null;
    const attemptedModels: string[] = [];

    // Fetch the current delegation from persisted state — this carries any
    // partial artifacts (result, outputs) from prior failed attempts.
    // The `delegation` parameter may be a stale copy from the plan object.
    const currentDelegation = this.config.missionState.getDelegation(delegation.id) ?? delegation;

    // Context handoff: enrich the delegation prompt with a bounded,
    // role-specific block (blueprint slice + mission memory + artifacts).
    // The ORIGINAL description (ROLE:/FILE:/BUILD_COMMAND: markers) is
    // preserved verbatim — handoff is appended, never substituted.
    const handoffBlock = this.buildHandoffBlock(currentDelegation);
    const enrichedDelegation = handoffBlock
      ? { ...currentDelegation, description: `${currentDelegation.description}\n\n${handoffBlock}` }
      : currentDelegation;
    if (handoffBlock) {
      this.publisher.publish({
        missionId: delegation.missionId,
        type: "delegation.context.handoff" as any,
        payload: { delegationId: delegation.id, chars: handoffBlock.length },
      });
    }

    // Phase 8 Gap 3: Model fallback chain
    const router = this.config.modelRouter;
    const maxFallbackAttempts = this.config.maxModelFallbackAttempts ?? 3;

    // Phase 10: Select initial model from Mission ModelRouter
    // If modelOverride is provided (e.g., from CHANGE_MODEL recovery), use it directly
    let selectedModel: string | undefined = modelOverride;
    if (!selectedModel && router) {
      const initialRoute = router.chooseModel({ delegation: currentDelegation, role: currentDelegation.role ?? "Developer", mission: this.currentMission! });
      selectedModel = initialRoute.primary;
    }

    // Create AbortController for this delegation execution
    // This allows mission timeout to cancel in-flight execution
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    const executeOnce = async (overrideModel?: string): Promise<AgentResult> => {
      try {
        const adapterResult = await this.config.factoryAdapter.runDelegation(enrichedDelegation, this.currentMission!, {
          baseDir: this.config.baseDir,
          project: this.config.project,
          fromStep: currentDelegation.stepIds?.[0],
          model: overrideModel ?? selectedModel,
          signal: abortController.signal,
        });

        const updatedDelegation = this.config.missionState.getDelegation(delegation.id);

        return {
          delegationId: delegation.id,
          pipelineId: adapterResult.pipelineId ?? updatedDelegation?.pipelineId,
          status: adapterResult.status,
          output: adapterResult.output || updatedDelegation?.result || "",
          error: adapterResult.error ?? updatedDelegation?.error,
          durationMs: Date.now() - startTime,
          readOnly: adapterResult.readOnly,
        };
      } catch (error) {
        // If aborted, treat as failed with specific error
        if (error instanceof Error && error.name === "AbortError") {
          return {
            delegationId: delegation.id,
            status: "failed",
            output: "",
            error: "Execution aborted: mission timeout",
            durationMs: Date.now() - startTime,
          };
        }
        return {
          delegationId: delegation.id,
          status: "failed",
          output: "",
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        };
      }
    };

    agentResult = await executeOnce();

    // Clear the abort controller after execution completes
    this.currentAbortController = null;

    // If adapter threw (provider/model failure) and router is configured, retry with fallbacks
    // Only run internal fallback chain if no explicit modelOverride was provided
    if (!modelOverride && router && isModelProviderFailure(agentResult) && agentResult.status === "failed") {
      const route = router.chooseModel({ delegation: currentDelegation, role: currentDelegation.role ?? "Developer", mission: this.currentMission! });
      let currentModel = route.primary;
      attemptedModels.push(currentModel);

      for (let i = 0; i < maxFallbackAttempts; i++) {
        const nextModel = router.nextFallback(route, currentModel);
        if (!nextModel) break;

        attemptedModels.push(nextModel);
        currentModel = nextModel;

        this.publisher.publish({
          missionId: delegation.missionId,
          type: "delegation.model_fallback" as any,
          payload: {
            delegationId: delegation.id,
            previousModel: attemptedModels[attemptedModels.length - 2] ?? "unknown",
            nextModel,
            reason: agentResult.error ?? "Provider failure",
            attemptedModels: [...attemptedModels],
          },
        });

        // Phase 9: Notify supervisor of model fallback
        this.config.supervisor?.observeModelFallback(delegation.id, nextModel);

        agentResult = await executeOnce(nextModel);
        if (!isModelProviderFailure(agentResult) || agentResult.status !== "failed") {
          break;
        }
      }
    }

    // Read-only tracking
    if (agentResult.readOnly) {
      this.readOnlyDelegations.add(delegation.id);
    }

    const finalStatus: DelegationStatus = agentResult.status === "passed" ? "passed" : "failed";
    await this.config.missionState.completeDelegation(delegation.id, finalStatus, agentResult.output, agentResult.error);

    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.DELEGATION_COMPLETED,
      payload: {
        delegationId: delegation.id,
        status: finalStatus,
        result: agentResult.output,
        error: agentResult.error,
      },
    });

    return agentResult;
  }

  private async runValidation(
    delegation: Delegation,
    agentResult: AgentResult,
  ): Promise<ValidationResult> {
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.DELEGATION_VALIDATION_STARTED,
      payload: { delegationId: delegation.id, title: delegation.title },
    });

    const result = await this.validationGate!.validate(
      delegation,
      this.currentMission!,
      this.config.project,
      this.config.validation,
    );

    if (result.passed) {
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.DELEGATION_VALIDATION_PASSED,
        payload: {
          delegationId: delegation.id,
          command: result.command,
          durationMs: result.durationMs,
        },
      });
    } else {
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.DELEGATION_VALIDATION_FAILED,
        payload: {
          delegationId: delegation.id,
          command: result.command,
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 500),
          durationMs: result.durationMs,
        },
      });
    }

    return result;
  }

  private async repairValidationFailure(
    delegation: Delegation,
    validationResult: ValidationResult,
  ): Promise<boolean> {
    const maxAttempts = this.config.validation?.maxRepairAttempts ?? 3;
    const previousErrors: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!this.isRunning) return false;

      // Classify the failure and determine routing
      const triage = classifyFailure({
        delegation,
        validationResult,
        attempt,
        maxAttempts,
        previousErrors,
      });

      // Repair memory: never blindly re-apply the same repair. On repeat
      // failures require a different diagnosis; on exhausted budget escalate
      // to BLOCKED instead of looping forever.
      if (this.repairHistory) {
        const decision = this.repairHistory.decide(
          delegation.id,
          `${validationResult.command} exit ${validationResult.exitCode}: ${validationResult.stderr.slice(0, 300)}`,
          `${triage.targetRole}: ${triage.reason}`,
        );
        if (decision.action === "blocked") {
          this.publisher.publish({
            missionId: delegation.missionId,
            type: "delegation.escalated" as any,
            payload: { delegationId: delegation.id, reason: decision.reason },
          });
          return false;
        }
        if (decision.action === "retry-different" && attempt >= maxAttempts) {
          this.publisher.publish({
            missionId: delegation.missionId,
            type: "delegation.escalated" as any,
            payload: { delegationId: delegation.id, reason: decision.reason },
          });
          return false;
        }
      }

      // Emit triage decision event
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.DELEGATION_TRIAGE,
        payload: {
          delegationId: delegation.id,
          attempt,
          action: triage.action,
          targetRole: triage.targetRole,
          category: triage.category,
          reason: triage.reason,
          priority: triage.priority,
        },
      });

      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.DELEGATION_RETRY_STARTED,
        payload: {
          delegationId: delegation.id,
          attempt,
          maxAttempts,
          reason: triage.reason,
        },
      });

      // Build role-aware prompt using triage result and mission memory
      const repairPrompt = buildTriagePrompt(
        delegation,
        validationResult,
        triage,
        attempt,
        maxAttempts,
        previousErrors,
        this.memory ?? undefined,
      );

      // Create and execute repair delegation
      const repairDelegation = this.createTriageRepairDelegation(
        delegation,
        repairPrompt,
        triage,
        `triage-${triage.action}-${delegation.id}-${attempt}-${randomUUID().slice(0, 6)}`,
      );

      await this.config.missionState.addDelegation(repairDelegation);

      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.DELEGATION_CREATED,
        payload: {
          delegationId: repairDelegation.id,
          title: repairDelegation.title,
          objectiveId: repairDelegation.objectiveId,
        },
      });

      const repairResult = await this.executeDelegation(repairDelegation);

      if (repairResult.status === "failed") {
        previousErrors.push(repairResult.error || "Agent execution failed");
        this.repairHistory?.record({
          delegationId: delegation.id,
          failure: `${validationResult.command} exit ${validationResult.exitCode}`,
          evidence: validationResult.stderr.slice(0, 500),
          diagnosis: triage.reason,
          repairAttempted: `${triage.targetRole}: ${triage.reason}`,
          repairResult: "failed",
        });
        await this.persistRepairHistory();
        continue;
      }

      // Re-run validation
      const revalidation = await this.runValidation(delegation, repairResult);
      if (revalidation.passed) {
        this.repairHistory?.record({
          delegationId: delegation.id,
          failure: `${validationResult.command} exit ${validationResult.exitCode}`,
          evidence: validationResult.stderr.slice(0, 500),
          diagnosis: triage.reason,
          repairAttempted: `${triage.targetRole}: ${triage.reason}`,
          repairResult: "fixed",
        });
        await this.persistRepairHistory();
        return true;
      }

      previousErrors.push(
        `Validation still failing: ${revalidation.command} exit ${revalidation.exitCode}`,
      );
      validationResult = revalidation;
    }

    return false;
  }

  private createTriageRepairDelegation(
    original: Delegation,
    repairPrompt: string,
    triage: TriageResult,
    repairId: string,
  ): Delegation {
    const actionLabel: Record<string, string> = {
      repair: "Repair",
      research: "Research",
      qa_analysis: "QA Analysis",
      architect_review: "Architect Review",
      retry: "Retry",
    };

    return {
      id: repairId,
      missionId: original.missionId,
      objectiveId: original.objectiveId,
      title: `[${actionLabel[triage.action] ?? "Repair"}] ${original.title}`,
      description: repairPrompt,
      pipelineType: original.pipelineType,
      stepIds: undefined,
      dependsOn: [original.id],
      parallelizable: false,
      acceptanceCriteria: [...(original.acceptanceCriteria ?? []), "Validation passes"],
      status: "queued",
      createdAt: new Date().toISOString(),
      retryOf: original.id,
    };
  }

  private async runVisualQa(buildDelegation: Delegation): Promise<void> {
    const adapter = this.config.visualQaAdapter;
    const requiresVisualQa = this.currentMission?.context?.requiresVisualQa ?? false;

    if (!adapter) {
      if (requiresVisualQa) {
        // Visual QA is required but no adapter available — fail the mission
        const now = new Date().toISOString();
        const failedResult: VisualQaResult = {
          status: "failed",
          passed: false,
          checks: 0,
          failedChecks: 0,
          errors: ["Visual QA required but no adapter configured"],
          artifacts: [],
          startedAt: now,
          finishedAt: now,
        };
        await this.config.missionState.recordVisualQaResult(failedResult);
        this.publisher.publish({
          missionId: buildDelegation.missionId,
          type: MissionEventTypes.MISSION_VISUAL_QA_FAILED,
          payload: {
            reason: "Visual QA required but no adapter configured",
            status: "failed",
            passed: false,
            totalChecks: 0,
            passedChecks: 0,
            failedChecks: 0,
            errorCount: 1,
            artifactCount: 0,
          },
        });
        // Refresh current mission from state
        this.currentMission = this.config.missionState.getMission();
        return;
      }
      // No adapter and not required — record skip
      const now = new Date().toISOString();
      const skippedResult: VisualQaResult = {
        status: "skipped",
        passed: false,
        checks: 0,
        failedChecks: 0,
        errors: [],
        artifacts: [],
        startedAt: now,
        finishedAt: now,
      };
      await this.config.missionState.recordVisualQaResult(skippedResult);
      this.publisher.publish({
        missionId: buildDelegation.missionId,
        type: MissionEventTypes.MISSION_VISUAL_QA_SKIPPED,
        payload: {
          reason: "No Visual QA adapter configured",
          status: "skipped",
          passed: false,
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
          errorCount: 0,
          artifactCount: 0,
        },
      });
      // Refresh current mission from state
      this.currentMission = this.config.missionState.getMission();
      return;
    }

    this.publisher.publish({
      missionId: buildDelegation.missionId,
      type: MissionEventTypes.MISSION_VISUAL_QA_STARTED,
      payload: { buildDelegationId: buildDelegation.id },
    });
    await this.config.missionState.recordVisualQaStarted();

    const projectId = this.currentMission?.context?.projectId ?? "unknown";
    const runId = `mission-${this.currentMission?.id ?? "unknown"}-${Date.now()}`;

    const result = await adapter.run({
      projectId,
      projectPath: this.config.project,
      runId,
    });

    await this.config.missionState.recordVisualQaResult(result);

    // Refresh current mission from state so auditor sees the QA result
    this.currentMission = this.config.missionState.getMission();

    const evidence = normalizeVisualQaEvidence(result);

    const eventType = result.status === "passed"
      ? MissionEventTypes.MISSION_VISUAL_QA_COMPLETED
      : MissionEventTypes.MISSION_VISUAL_QA_FAILED;

    this.publisher.publish({
      missionId: buildDelegation.missionId,
      type: eventType,
      payload: {
        status: evidence.status,
        passed: evidence.passed,
        totalChecks: evidence.totalChecks,
        passedChecks: evidence.passedChecks,
        failedChecks: evidence.failedChecks,
        errorCount: evidence.errorCount,
        artifactCount: evidence.artifactCount,
        runId: result.runId,
      },
    });
  }

  async auditDelegation(delegation: Delegation): Promise<AuditResult> {
    await this.config.missionState.startAudit(delegation.id);
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.MISSION_AUDITING,
      payload: { delegationId: delegation.id },
    });

    const agentResult = await this.getAgentResult(delegation.id);
    const auditResult = await this.config.auditor.audit(delegation, agentResult, this.currentMission!, this.currentPlan!);

    if (auditResult.status === "PASS") {
      await this.config.missionState.recordAuditPassed(delegation.id, auditResult);
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.MISSION_AUDIT_PASSED,
        payload: { delegationId: delegation.id, auditResult },
      });
    } else {
      await this.config.missionState.recordAuditFailed(delegation.id, auditResult);
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.MISSION_AUDIT_FAILED,
        payload: { delegationId: delegation.id, auditResult },
      });
    }

    return auditResult;
  }

  async repairDelegation(delegation: Delegation, auditResult: AuditResult): Promise<boolean> {
    // If maxRepairs is 0, skip repair entirely
    if (this.config.maxRepairs <= 0) return false;

    // Check if there's an existing repair plan in MissionState (e.g., after restart)
    const existingRepairPlan = this.config.missionState.getRepairPlan(delegation.id);
    let repairPlan: RepairPlan;
    let startIteration: number;

    if (existingRepairPlan && existingRepairPlan.iteration > 0) {
      // Resume from persisted iteration
      repairPlan = existingRepairPlan;
      startIteration = repairPlan.iteration + 1;
      // Ensure maxIterations matches config
      repairPlan.maxIterations = this.config.maxRepairs;
    } else {
      // Fresh repair plan
      repairPlan = createRepairPlan(
        delegation.id,
        auditResult.recommendedRepair?.description ?? `Fix issues in ${delegation.title}`,
        auditResult.recommendedRepair?.focusAreas ?? ["Unknown"],
        Math.max(1, this.config.maxRepairs)
      );
      startIteration = 1;
    }

    await this.config.missionState.startRepair(delegation.id, repairPlan);
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.MISSION_REPAIRING,
      payload: { delegationId: delegation.id, repairPlan },
    });

    // Use persisted iteration as source of truth
    for (let iteration = startIteration; iteration <= this.config.maxRepairs; iteration++) {
      if (!this.isRunning) return false;

      await this.config.missionState.incrementRepairIteration(delegation.id);

      const repairDelegation = this.createRepairDelegation(delegation, repairPlan, iteration);

      await this.config.missionState.addDelegation(repairDelegation);
      await this.config.missionState.startDelegation(repairDelegation.id, "");
      const repairConfig = {
        baseDir: this.config.baseDir,
        project: this.config.project,
      };

      let repairAgentResult: AgentResult;
      try {
        const adapterResult = await this.config.factoryAdapter.runDelegation(repairDelegation, this.currentMission!, repairConfig);
        const updatedRepairDelegation = this.config.missionState.getDelegation(repairDelegation.id);
        repairAgentResult = {
          delegationId: repairDelegation.id,
          pipelineId: adapterResult.pipelineId ?? updatedRepairDelegation?.pipelineId,
          status: adapterResult.status,
          output: adapterResult.output || updatedRepairDelegation?.result || "",
          error: adapterResult.error ?? updatedRepairDelegation?.error,
          durationMs: 0,
          readOnly: adapterResult.readOnly,
        };
        if (adapterResult.readOnly) {
          this.readOnlyDelegations.add(repairDelegation.id);
        }
      } catch {
        repairAgentResult = {
          delegationId: repairDelegation.id,
          status: "failed",
          output: "",
          durationMs: 0,
        };
      }

      if (repairAgentResult.status === "passed") {
        await this.config.missionState.completeDelegation(repairDelegation.id, "passed", repairAgentResult.output);
        await this.config.missionState.completeDelegation(delegation.id, "passed", repairAgentResult.output);
        if (repairAgentResult.readOnly) {
          this.readOnlyDelegations.add(delegation.id);
        }
        return true;
      }

      await this.config.missionState.completeDelegation(repairDelegation.id, "failed", repairAgentResult.output, repairAgentResult.error);
    }

    return false;
  }

  private createRepairDelegation(original: Delegation, repairPlan: RepairPlan, iteration: number): Delegation {
    return {
      ...original,
      id: `repair-${original.id}-${iteration}`,
      title: `[REPAIR ${iteration}/${repairPlan.maxIterations}] ${original.title}`,
      description: `${repairPlan.description}\n\nFOCUS AREAS:\n${repairPlan.focusAreas.map((a) => `- ${a}`).join("\n")}\n\nITERATION: ${iteration}/${repairPlan.maxIterations}`,
      stepIds: undefined,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [...original.acceptanceCriteria, "Repair verified by auditor"],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
  }

  private async getAgentResult(delegationId: string): Promise<AgentResult> {
    const delegation = this.config.missionState.getDelegation(delegationId);
    if (!delegation) {
      return {
        delegationId,
        status: "failed",
        output: "",
        error: "Delegation not found",
        durationMs: 0,
      };
    }
    return {
      delegationId,
      pipelineId: delegation.pipelineId,
      status: delegation.status === "passed" ? "passed" : "failed",
      output: delegation.result ?? "",
      error: delegation.error,
      durationMs: 0,
      readOnly: this.readOnlyDelegations.has(delegationId),
    };
  }

  // ─── Dynamic Delegation ──────────────────────────────────────

  addDelegation(delegation: Delegation): boolean {
    if (this.dynamicDelegationCount >= (this.config.maxDynamicDelegations ?? 10)) {
      return false;
    }
    this.dynamicDelegations.push(delegation);
    this.dynamicDelegationCount++;
    this.config.missionState.addDelegation(delegation);

    this.publisher.publish({
      missionId: delegation.missionId,
      type: "delegation.created",
      payload: {
        delegationId: delegation.id,
        title: delegation.title,
        pipelineType: delegation.pipelineType,
        dynamic: true,
      },
    });

    return true;
  }

  // ─── Replanning ──────────────────────────────────────────────

  private async attemptReplan(failedDelegation: Delegation): Promise<boolean> {
    if (!this.config.replanner || !this.currentMission || !this.memory) return false;

    this.replanCount++;
    this.publisher.publish({
      missionId: this.currentMission.id,
      type: "mission.replan_started" as any,
      payload: {
        attempt: this.replanCount,
        failedDelegationId: failedDelegation.id,
      },
    });

    try {
      const newPlan = await this.config.replanner.createPlan(this.currentMission, this.memory);
      this.currentPlan = newPlan;

      // Add new delegations from the plan as dynamic delegations
      for (const pd of newPlan.delegations) {
        const existing = this.config.missionState.getDelegation(pd.id);
        if (!existing) {
          this.addDelegation(pd);
        }
      }

      this.publisher.publish({
        missionId: this.currentMission.id,
        type: "mission.replan_completed" as any,
        payload: {
          attempt: this.replanCount,
          delegationCount: newPlan.delegations.length,
        },
      });

      return true;
    } catch {
      this.publisher.publish({
        missionId: this.currentMission.id,
        type: "mission.replan_failed" as any,
        payload: { attempt: this.replanCount },
      });
      return false;
    }
  }

  private currentExecution: Promise<AgentResult> | null = null;

  private canRunDelegation(delegation: Delegation): boolean {
    for (const depId of delegation.dependsOn) {
      const dep = this.config.missionState.getDelegation(depId);
      if (!dep || dep.status !== "passed") {
        return false;
      }
    }
    return true;
  }

  private topologicalSort(delegations: Delegation[]): Delegation[] {
    const map = new Map<string, Delegation>(delegations.map((d: Delegation) => [d.id, d]));
    const visited = new Set<string>();
    const result: Delegation[] = [];

    function visit(id: string): void {
      if (visited.has(id)) return;
      const dep = map.get(id);
      if (!dep) return;

      for (const depId of dep.dependsOn) {
        visit(depId);
      }

      visited.add(id);
      result.push(dep);
    }

    for (const dep of delegations) {
      visit(dep.id);
    }

    return result;
  }

  stop(): void {
    this.isRunning = false;
    // Wait for current execution to complete (with timeout) to allow graceful shutdown
    if (this.currentExecution) {
      const waitPromise = this.currentExecution;
      // Don't await here to avoid blocking, but we could add a timeout
      // For now, just let the execution complete naturally or timeout
      Promise.race([
        waitPromise,
        new Promise(resolve => setTimeout(resolve, 30_000)) // 30s max wait
      ]).catch(() => {
        // Ignore errors during shutdown
      });
    }
  }

  getCurrentMission(): Mission | null {
    return this.currentMission ? { ...this.currentMission } : null;
  }

  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan ? { ...this.currentPlan } : null;
  }
}

// ─── Evidence Evaluation Functions ──────────────────────────────────

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
}

function hasFileReferences(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\.\w{1,5}\b(?:\s|$|,|;|:|\)|\]|")/,
    /\b(?:src|lib|dist|build|public|assets|scenes?|scripts?|components?|modules?|utils?|helpers?|services?|types?|configs?)\b/i,
    /(?:\/|\\)(?:[\w.-]+(?:\/|\\)){1,}/,
    /\b(?:import|require|export|from)\s+['"]/,
    /\b(?:file|directory|folder|path)\b/i,
  ];
  return patterns.some((p) => p.test(cleaned));
}

function hasProjectStructure(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:project|codebase|code\s*base|code\s*structure|file\s*structure|directory\s*structure)\b/i,
    /\b(?:source|src|lib|dist|build|config|assets?)\b/i,
    /\b(?:main|entry|index|app|game|scene|level|menu)\b/i,
    /\b(?:function|class|module|component|service|util|helper|type|interface)\b/i,
    /\b(?:gameplay|physics|rendering|input|audio|ui|gui)\b/i,
    /\b(?:typescript|javascript|phaser|webpack|json|html|css)\b/i,
  ];
  return patterns.filter((p) => p.test(cleaned)).length >= 2;
}

function hasComponentReferences(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:scene|component|module|class|function|util|helper|service|type|interface|config)\b/i,
    /\b(?:game|player|enemy|npc|obstacle|projectile|platform|terrain)\b/i,
    /\b(?:menu|hud|ui|overlay|popup|dialog|screen|view)\b/i,
    /\b(?:physics|rendering|input|audio|animation|collision|spawn|movement)\b/i,
    /\b(?:main|boot|preload|create|update|destroy|init|start|load)\b/i,
    /\.(?:ts|js|json|tsx|jsx|css|html|yaml|yml)\b/,
  ];
  return patterns.filter((p) => p.test(cleaned)).length >= 2;
}

function hasAnalysisLanguage(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:analyzed?|analysis|reviewed?|review|examined?|examination|investigated?|investigation|inspected?|inspection|described?|description|documented?|documentation|identified?|identification|findings?|observed?|observation|consists?|contains?|includes?|comprises?|uses?|utilizes?|implements?|provides?|handles?|manages?|supports?)\b/i,
    /\b(?:overview|summary|report|findings?|results?|conclusions?|recommendations?)\b/i,
    /\b(?:structure|architecture|design|layout|organization|arrangement|composition)\b/i,
  ];
  return patterns.some((p) => p.test(cleaned));
}

function hasArchitectureLanguage(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:architect(?:ure|ural)?|design(?:ed|s| pattern)?|structure[d]?|organized?|organized?)\b/i,
    /\b(?:layer[s]?|tier[s]?|component[s]?|module[s]?|service[s]?|module[s]?)\b/i,
    /\b(?:pattern[s]?|approach(?:es)?|strategy|strategies|framework|system)\b/i,
    /\b(?:scene[s]?|state\s*management|data\s*flow|event|signal|message)\b/i,
    /\b(?:render(?:ing|er)?|physics|input|audio|collision|spawn|movement|animation)\b/i,
    /\b(?:pipeline|workflow|architecture|composition|dependency|injection)\b/i,
  ];
  return patterns.filter((p) => p.test(cleaned)).length >= 2;
}

function hasMinimalSubstance(text: string): boolean {
  const cleaned = stripAnsi(text);
  const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 5) return false;
  const hasFileRef = hasFileReferences(cleaned);
  const hasStructure = hasProjectStructure(cleaned);
  const hasAnalysis = hasAnalysisLanguage(cleaned);
  return (hasFileRef ? 1 : 0) + (hasStructure ? 1 : 0) + (hasAnalysis ? 1 : 0) >= 2;
}

function evaluateCodebaseAnalyzed(output: string): { passed: boolean; evidence: string } {
  const cleaned = stripAnsi(output);
  if (cleaned.trim().length < 50) {
    return { passed: false, evidence: "Output too short for codebase analysis" };
  }
  if (!hasMinimalSubstance(output)) {
    return { passed: false, evidence: "Output lacks substantive codebase analysis evidence" };
  }
  const evidenceParts: string[] = [];
  if (hasFileReferences(output)) evidenceParts.push("file/module references");
  if (hasProjectStructure(output)) evidenceParts.push("project structure described");
  if (hasAnalysisLanguage(output)) evidenceParts.push("analysis language present");
  return {
    passed: true,
    evidence: `Substantive analysis detected: ${evidenceParts.join(", ")}`,
  };
}

function evaluateArchitectureDocumented(output: string): { passed: boolean; evidence: string } {
  const cleaned = stripAnsi(output);
  if (cleaned.trim().length < 50) {
    return { passed: false, evidence: "Output too short for architecture documentation" };
  }
  if (!hasArchitectureLanguage(output)) {
    return { passed: false, evidence: "Output lacks architecture-related language" };
  }
  const evidenceParts: string[] = [];
  if (hasArchitectureLanguage(output)) evidenceParts.push("architecture terminology");
  if (hasProjectStructure(output)) evidenceParts.push("project structure described");
  if (hasComponentReferences(output)) evidenceParts.push("component references");
  return {
    passed: true,
    evidence: `Architecture documentation detected: ${evidenceParts.join(", ")}`,
  };
}

function evaluateKeyComponentsIdentified(output: string): { passed: boolean; evidence: string } {
  const cleaned = stripAnsi(output);
  if (cleaned.trim().length < 50) {
    return { passed: false, evidence: "Output too short for component identification" };
  }
  if (!hasComponentReferences(output)) {
    return { passed: false, evidence: "Output lacks concrete component/module references" };
  }
  const evidenceParts: string[] = [];
  if (hasComponentReferences(output)) evidenceParts.push("concrete component references");
  if (hasFileReferences(output)) evidenceParts.push("file references");
  if (hasProjectStructure(output)) evidenceParts.push("project structure");
  return {
    passed: true,
    evidence: `Key components identified: ${evidenceParts.join(", ")}`,
  };
}

function evaluateNoFilesModified(result: AgentResult): { passed: boolean; evidence: string } {
  if (result.readOnly === true) {
    return { passed: true, evidence: "Execution metadata confirms read-only adapter" };
  }
  const lowerOutput = stripAnsi(result.output).toLowerCase();
  const writeIndicators = [
    /\bwrote\b/i,
    /\bcreated\s+file/i,
    /\bmodified\s+file/i,
    /\bdeleted\s+file/i,
    /\bsaved\s+to\b/i,
    /\bwritten\s+to\b/i,
    /\bfile\s+created/i,
    /\bfile\s+modified/i,
    /\bfile\s+saved/i,
    /\bpatch\s+applied/i,
    /\bcommit(?:ted|ting)?\b/i,
    /\bgit\s+(?:add|commit|push|rm)/i,
  ];
  const hasWriteEvidence = writeIndicators.some((p) => p.test(lowerOutput));
  if (hasWriteEvidence) {
    return { passed: false, evidence: "Output contains write operation indicators" };
  }
  return { passed: true, evidence: "No write operation evidence detected in output" };
}

function evaluateGenericCriterion(criterion: string, output: string): { passed: boolean; evidence: string } {
  const lowerOutput = stripAnsi(output).toLowerCase();
  const keywords = criterion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const matched = keywords.filter((k) => lowerOutput.includes(k));
  if (matched.length > 0) {
    return { passed: true, evidence: `Keywords matched: ${matched.join(", ")}` };
  }
  return { passed: false, evidence: "No criterion keywords found in output" };
}

function buildResultFromDelegation(delegation: Delegation): "passed" | "failed" {
  return delegation.status === "passed" ? "passed" : "failed";
}

// ─── DeterministicAuditor ───────────────────────────────────────────

export class DeterministicAuditor implements Auditor {
  async audit(delegation: Delegation, result: AgentResult, mission: Mission, plan: ExecutionPlan): Promise<AuditResult> {
    const findings: string[] = [];
    const acceptanceResults: AcceptanceCriteriaResult[] = [];

    if (result.status === "failed") {
      findings.push(`Delegation failed: ${result.error ?? "Unknown error"}`);
      for (const criterion of delegation.acceptanceCriteria) {
        acceptanceResults.push({ criterion, passed: false, evidence: result.error });
      }
      return createAuditResult(
        delegation.id,
        "FAIL",
        `Delegation "${delegation.title}" failed execution`,
        findings,
        acceptanceResults,
        {
          description: `Fix the failure in ${delegation.title}`,
          focusAreas: ["Error resolution", "Verify fix"],
        }
      );
    }

    for (const criterion of delegation.acceptanceCriteria) {
      const evaluation = this.evaluateCriterion(criterion, result);
      acceptanceResults.push({
        criterion,
        passed: evaluation.passed,
        evidence: evaluation.evidence,
      });
      if (!evaluation.passed) {
        findings.push(`Acceptance criterion not met: ${criterion}`);
      }
    }

    const allPassed = acceptanceResults.every((r) => r.passed);

    if (allPassed) {
      return createAuditResult(
        delegation.id,
        "PASS",
        `Delegation "${delegation.title}" passed all acceptance criteria`,
        ["All criteria satisfied"],
        acceptanceResults
      );
    }

    return createAuditResult(
      delegation.id,
      "FAIL",
      `Delegation "${delegation.title}" failed ${findings.length} acceptance criteria`,
      findings,
      acceptanceResults,
      {
        description: `Address failing acceptance criteria for ${delegation.title}`,
        focusAreas: findings.map((f) => f.replace("Acceptance criterion not met: ", "")),
      }
    );
  }

  private evaluateCriterion(criterion: string, result: AgentResult): { passed: boolean; evidence: string } {
    const lowerCriterion = criterion.toLowerCase();

    if (lowerCriterion.includes("no files modified") || lowerCriterion.includes("no file modified")) {
      return evaluateNoFilesModified(result);
    }
    if (lowerCriterion.includes("codebase analyzed") || lowerCriterion.includes("codebase analysis")) {
      return evaluateCodebaseAnalyzed(result.output);
    }
    if (lowerCriterion.includes("architecture documented") || lowerCriterion.includes("architecture analysis")) {
      return evaluateArchitectureDocumented(result.output);
    }
    if (lowerCriterion.includes("key components identified") || lowerCriterion.includes("components identified")) {
      return evaluateKeyComponentsIdentified(result.output);
    }

    return evaluateGenericCriterion(lowerCriterion, result.output);
  }
}

export class RealFactoryAdapter implements FactoryExecutionAdapter {
  async runDelegation(delegation: Delegation, mission: Mission, config: { baseDir: string; project: string; fromStep?: string; model?: string; signal?: AbortSignal }): Promise<AgentResult> {
    const goalResult = await runGoal(
      delegation.description,
      config.baseDir,
      config.project,
      {
        pipelineType: delegation.pipelineType,
        fromStep: config.fromStep,
        engine: mission.context?.engine,
        stack: mission.context?.stack,
        template: mission.context?.template,
        workspace: mission.context?.workspace,
        model: config.model,
        signal: config.signal,
      }
    );
    return {
      delegationId: delegation.id,
      status: goalResult.status,
      output: goalResult.output,
      durationMs: 0,
    };
  }
}

export interface ReadOnlyAdapterConfig {
  agent?: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_READ_ONLY_AGENT = "researcher";
const DEFAULT_READ_ONLY_TIMEOUT_MS = 180_000;

export class ReadOnlyFactoryAdapter implements FactoryExecutionAdapter {
  private readonly config: ReadOnlyAdapterConfig;

  constructor(config?: ReadOnlyAdapterConfig) {
    this.config = config ?? {};
  }

  async runDelegation(delegation: Delegation, _mission: Mission, config: { baseDir: string; project: string; fromStep?: string; model?: string; signal?: AbortSignal }): Promise<AgentResult> {
    const agent = this.config.agent ?? DEFAULT_READ_ONLY_AGENT;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_READ_ONLY_TIMEOUT_MS;

    // Reject immediately if already aborted
    if (config.signal?.aborted) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: "Execution aborted: mission timeout",
        durationMs: 0,
        readOnly: true,
      };
    }

    const prompt = `
You are a read-only investigation agent.

MISSION OBJECTIVE:
${delegation.description}

PROJECT:
${config.project}

RULES:
1. You MUST NOT modify any files.
2. You MUST NOT create any files.
3. You MUST NOT delete any files.
4. You MUST NOT execute write commands.
5. Read files using: cat, head, tail, ls, find, grep
6. Run read-only git commands: git log, git diff, git status
7. Analyze the project structure and architecture.
8. Provide a comprehensive report of your findings.
9. Report the gameplay architecture, file structure, and key components.
10. At the end, provide a structured summary.

IMPORTANT: This is a READ-ONLY mission. Do NOT modify anything.
`;

    const startTime = Date.now();

    try {
      const result = await this.runOpenCode(agent, prompt, config.project, timeoutMs, config.model, config.signal);
      const durationMs = Date.now() - startTime;

      if (result.timedOut) {
        return {
          delegationId: delegation.id,
          status: "failed",
          output: result.output,
          error: `Agent timed out after ${timeoutMs}ms`,
          durationMs,
          readOnly: true,
        };
      }

      if (result.code !== 0) {
        return {
          delegationId: delegation.id,
          status: "failed",
          output: result.output,
          error: `Agent exited with code ${result.code}`,
          durationMs,
          readOnly: true,
        };
      }

      return {
        delegationId: delegation.id,
        status: "passed",
        output: result.output,
        durationMs,
        readOnly: true,
      };
    } catch (error) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        readOnly: true,
      };
    }
  }

  private runOpenCode(
    agent: string,
    prompt: string,
    project: string,
    timeoutMs: number,
    model?: string,
    signal?: AbortSignal,
  ): Promise<{ code: number; output: string; timedOut: boolean; truncated?: boolean }> {
    // Reject immediately if already aborted
    if (signal?.aborted) {
      return Promise.resolve({
        code: -1,
        output: "",
        timedOut: false,
        truncated: false,
      });
    }

    return new Promise((resolve) => {
      let output = "";
      let truncated = false;
      let settled = false;

      const args = ["run", "--agent", agent];
      if (model) {
        args.push("-m", model);
      }
      args.push(prompt);

      const child = pty.spawn(
        "/home/asila/.opencode/bin/opencode",
        args,
        {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd: project,
          env: {
            ...process.env,
            HOME: "/home/asila",
            PATH: `/home/asila/.opencode/bin:${process.env.PATH ?? ""}`,
          },
        }
      );

      child.onData((data: string) => {
        if (output.length + data.length > MAX_OUTPUT_CHARS) {
          if (!truncated) {
            output += "\n[Output truncated: exceeded " + MAX_OUTPUT_CHARS + " characters]";
            truncated = true;
          }
          // Stop accumulating but let process continue
          return;
        }
        output += data;
      });

      // Helper: kill process group or single process
      const killProcess = () => {
        const pid = child.pid;
        if (pid && pid > 0) {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            // Process group may already be gone
          }
        } else {
          try {
            child.kill("SIGTERM");
          } catch {
            // Process may already be gone
          }
        }
        setTimeout(() => {
          if (pid && pid > 0) {
            try {
              process.kill(-pid, "SIGKILL");
            } catch {
              // Process group may already be gone
            }
          } else {
            try {
              child.kill("SIGKILL");
            } catch {
              // Process may already be gone
            }
          }
        }, 5_000);
      };

      // Abort signal: terminate the PTY process
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        killProcess();
        resolve({
          code: -1,
          output: output + "\n[Terminated: aborted]",
          timedOut: false,
          truncated,
        });
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        killProcess();
        resolve({
          code: -1,
          output: output + "\n[Terminated: timeout exceeded]",
          timedOut: true,
          truncated,
        });
      }, timeoutMs);

      child.onExit(({ exitCode }: { exitCode: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve({
          code: exitCode ?? 1,
          output,
          timedOut: false,
          truncated,
        });
      });
    });
  }
}