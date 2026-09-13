import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes, createMissionEventPublisher } from "../events.js";
import { createMissionSupervisor } from "../mission-supervisor.js";
import { PeerReviewSystem, type ReviewExecutor } from "../peer-review.js";
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan, AgentRole } from "../mission.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "supervisor-recovery-quality-gates-"));
  projectPath = path.join(tmpDir, "projects", "test-game");
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ name: "test-game", scripts: { build: "echo ok" } }, null, 2)
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Mocks ──────────────────────────────────────────────────

function createFailingThenPassingAdapter(callLog: string[]): FactoryExecutionAdapter {
  let firstCall = true;
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      callLog.push(del.id);
      if (firstCall && !del.id.startsWith("repair-")) {
        firstCall = false;
        return {
          delegationId: del.id,
          status: "failed",
          output: "",
          error: "TypeScript error: Property 'x' does not exist",
          durationMs: 100,
        };
      }
      return {
        delegationId: del.id,
        status: "passed",
        output: "Fixed the code",
        durationMs: 100,
      };
    },
  };
}

function createProviderFailureThenPassingAdapter(callLog: string[]): FactoryExecutionAdapter {
  let firstCall = true;
  return {
    async runDelegation(del: Delegation, mission: Mission, config: any): Promise<AgentResult> {
      callLog.push(`${del.id}:model=${config.model ?? "default"}`);
      // First call (original delegation, no model specified) fails with provider error
      if (firstCall && !del.id.startsWith("repair-") && config.model === undefined) {
        firstCall = false;
        return {
          delegationId: del.id,
          status: "failed",
          output: "",
          error: "Provider timeout: anthropic API unavailable",
          durationMs: 100,
        };
      }
      // Fallback model or retry succeeds
      return {
        delegationId: del.id,
        status: "passed",
        output: "Fixed with fallback model",
        durationMs: 100,
      };
    },
  };
}

function createAlwaysPassingAdapter(): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      return {
        delegationId: del.id,
        status: "passed",
        output: "Work completed successfully",
        durationMs: 100,
      };
    },
  };
}

function createPassingAuditor(): Auditor {
  return {
    async audit(delegation: Delegation, result: AgentResult, mission: Mission, plan: ExecutionPlan): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: result.status === "passed" ? "PASS" : "FAIL",
        summary: result.status === "passed" ? "All checks passed" : "Failed",
        findings: [],
        acceptanceCriteriaResults: (delegation.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          passed: result.status === "passed",
          evidence: result.status === "passed" ? "Verified" : "Failed",
        })),
      };
    },
  };
}

function createFailingAuditor(): Auditor {
  return {
    async audit(delegation: Delegation, result: AgentResult, mission: Mission, plan: ExecutionPlan): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: "FAIL",
        summary: "Audit failed",
        findings: ["Audit failure"],
        acceptanceCriteriaResults: (delegation.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          passed: false,
          evidence: "Audit failed",
        })),
      };
    },
  };
}

function createPassingReviewExecutor(): ReviewExecutor {
  return async (request) => ({
    id: `res-${request.id}`,
    requestId: request.id,
    delegationId: request.delegationId,
    passed: true,
    issues: [],
    reviewerRole: request.reviewerRole,
    summary: "Review passed",
    createdAt: new Date().toISOString(),
  });
}

function createFailingReviewExecutor(): ReviewExecutor {
  return async (request) => ({
    id: `res-${request.id}`,
    requestId: request.id,
    delegationId: request.delegationId,
    passed: false,
    issues: [{ severity: "high", description: "Review failed" }],
    reviewerRole: request.reviewerRole,
    summary: "Review failed",
    createdAt: new Date().toISOString(),
  });
}

async function setupOrchestratorWithSupervisor(config: {
  factoryAdapter: FactoryExecutionAdapter;
  auditor: Auditor;
  validation?: { buildCommand?: string; testCommand?: string; maxRepairAttempts?: number };
  peerReview?: PeerReviewSystem;
  reviewExecutor?: ReviewExecutor;
  requiresReview?: boolean;
  modelRouter?: any;
}) {
  const mission = createMission(
    "Build and test the game",
    {
      projectId: "test-game",
      engine: "web",
      stack: "phaser",
      workspace: projectPath,
    }
  );

  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const state = new MissionState(stateDir, mission.id);
  await state.init();
  await state.setMission(mission);

  const buildDel = createDelegation(
    mission.id,
    "obj-build",
    "Build Project",
    "ROLE: builder\nBUILD_COMMAND: echo ok",
    "engineering",
    {
      stepIds: ["build"],
      dependsOn: [],
      acceptanceCriteria: ["Build succeeds"],
      role: "Developer",
      requiresReview: config.requiresReview ?? false,
    }
  );

  const plan: ExecutionPlan = {
    id: "plan-1",
    missionId: mission.id,
    objectives: [{ id: "obj-build", title: "Build", description: "Build the project", delegations: [buildDel.id] }],
    delegations: [buildDel],
    risks: [],
    validationGates: [],
    createdAt: new Date().toISOString(),
  };

  await state.setPlan(plan);
  await state.addDelegation(buildDel);

  const eventSink = new InMemoryEventSink();
  const publisher = createMissionEventPublisher(eventSink);
  const supervisor = createMissionSupervisor({
    missionState: state,
    eventSink,
    publisher,
    modelRouter: config.modelRouter,
    maxRecoveryAttempts: 3,
    maxStuckRecoveries: 2,
    maxDelegationDurationMs: 5 * 60 * 1000,
    stuckDetectionIntervalMs: 30 * 1000,
    maxReplanAttempts: 2,
    maxModelFallbackAttempts: 3,
    maxDynamicDelegations: 10,
  });

  const orchestrator = new MissionOrchestrator({
    maxRepairs: 3,
    baseDir: tmpDir,
    project: projectPath,
    factoryAdapter: config.factoryAdapter,
    auditor: config.auditor,
    eventSink,
    missionState: state,
    validation: config.validation,
    supervisor,
    peerReview: config.peerReview,
    reviewExecutor: config.reviewExecutor,
    modelRouter: config.modelRouter,
  });

  return { orchestrator, mission, eventSink, state, buildDel, plan, supervisor };
}

function getEvents(eventSink: InMemoryEventSink, type: string) {
  return eventSink.recent().filter((e) => e.type === type);
}

// ── Tests ──────────────────────────────────────────────────

describe("Supervisor recovery quality gate integration", () => {
  describe("Supervisor REPAIR recovery runs all quality gates", () => {
    it("runs validation after successful supervisor REPAIR recovery", async () => {
      const callLog: string[] = [];
      const { orchestrator, mission, eventSink, plan } = await setupOrchestratorWithSupervisor({
        factoryAdapter: createFailingThenPassingAdapter(callLog),
        auditor: createPassingAuditor(),
        validation: { buildCommand: "echo ok" },
      });

      const result = await orchestrator.executeMission(mission, plan);

      // Mission should complete successfully
      expect(result.status).toBe("completed");

      // Initial delegation should have been called, then repair delegation
      expect(callLog.length).toBeGreaterThanOrEqual(2);
      expect(callLog.some((id) => id.startsWith("repair-"))).toBe(true);

      // Validation should run AFTER repair recovery
      const valStarted = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_STARTED);
      const valPassed = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_PASSED);
      expect(valStarted.length).toBeGreaterThanOrEqual(1);
      expect(valPassed.length).toBeGreaterThanOrEqual(1);

      // Audit should run AFTER repair recovery
      const auditPassed = getEvents(eventSink, MissionEventTypes.MISSION_AUDIT_PASSED);
      expect(auditPassed.length).toBeGreaterThanOrEqual(1);
    });

    it("runs audit after successful supervisor REPAIR recovery", async () => {
      const callLog: string[] = [];
      const { orchestrator, mission, eventSink, plan } = await setupOrchestratorWithSupervisor({
        factoryAdapter: createFailingThenPassingAdapter(callLog),
        auditor: createPassingAuditor(),
        // No validation config - only audit
      });

      const result = await orchestrator.executeMission(mission, plan);

      expect(result.status).toBe("completed");

      // Audit should run after repair recovery
      const auditPassed = getEvents(eventSink, MissionEventTypes.MISSION_AUDIT_PASSED);
      expect(auditPassed.length).toBeGreaterThanOrEqual(1);
    });

    it("runs peer review after successful supervisor REPAIR recovery when requiresReview", async () => {
      const callLog: string[] = [];
      const peerReview = new PeerReviewSystem();
      const { orchestrator, mission, eventSink, plan } = await setupOrchestratorWithSupervisor({
        factoryAdapter: createFailingThenPassingAdapter(callLog),
        auditor: createPassingAuditor(),
        peerReview,
        reviewExecutor: createPassingReviewExecutor(),
        requiresReview: true,
      });

      const result = await orchestrator.executeMission(mission, plan);

      expect(result.status).toBe("completed");

      // Peer review should run after repair recovery
      const reviewStarted = getEvents(eventSink, "delegation.review.started" as any);
      const reviewPassed = getEvents(eventSink, "delegation.review.passed" as any);
      expect(reviewStarted.length).toBeGreaterThanOrEqual(1);
      expect(reviewPassed.length).toBeGreaterThanOrEqual(1);
    });

    it("fails mission if validation fails after supervisor REPAIR recovery", async () => {
      const callLog: string[] = [];
      const { orchestrator, mission, eventSink, plan } = await setupOrchestratorWithSupervisor({
        factoryAdapter: createFailingThenPassingAdapter(callLog),
        auditor: createPassingAuditor(),
        validation: { buildCommand: "false", maxRepairAttempts: 1 },
      });

      const result = await orchestrator.executeMission(mission, plan);

      // Mission should fail because validation fails after repair
      expect(result.status).toBe("failed");

      // Validation should have run and failed
      const valFailed = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_FAILED);
      expect(valFailed.length).toBeGreaterThanOrEqual(1);
    });

    it("fails mission if peer review fails after supervisor REPAIR recovery", async () => {
      const callLog: string[] = [];
      const peerReview = new PeerReviewSystem();
      const { orchestrator, mission, eventSink, plan } = await setupOrchestratorWithSupervisor({
        factoryAdapter: createFailingThenPassingAdapter(callLog),
        auditor: createPassingAuditor(),
        peerReview,
        reviewExecutor: createFailingReviewExecutor(),
        requiresReview: true,
      });

      const result = await orchestrator.executeMission(mission, plan);

      // Mission should fail because peer review fails after repair
      expect(result.status).toBe("failed");

      // Peer review should have run and failed
      const reviewFailed = getEvents(eventSink, "delegation.review.failed" as any);
      expect(reviewFailed.length).toBeGreaterThanOrEqual(1);
    });
  });

  });