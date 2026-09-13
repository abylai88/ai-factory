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
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "peer-review-re-audit-"));
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

function createPassingAdapter(): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      return {
        delegationId: del.id,
        status: "passed",
        output: "Work completed",
        durationMs: 100,
      };
    },
  };
}

function createPassingAuditor(): Auditor {
  return {
    async audit(delegation: Delegation, result: AgentResult): Promise<AuditResult> {
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
    async audit(delegation: Delegation, result: AgentResult): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: "FAIL",
        summary: "Audit failed after peer review repair",
        findings: ["Post-review audit failure"],
        acceptanceCriteriaResults: (delegation.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          passed: false,
          evidence: "Failed",
        })),
      };
    },
  };
}

function createPassingAuditorWithCallLog(callLog: string[]): Auditor {
  let callCount = 0;
  return {
    async audit(delegation: Delegation, result: AgentResult): Promise<AuditResult> {
      callCount++;
      callLog.push(`audit:${callCount}`);
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

function createFailingAuditorWithCallLog(callLog: string[]): Auditor {
  let callCount = 0;
  return {
    async audit(delegation: Delegation, result: AgentResult): Promise<AuditResult> {
      callCount++;
      callLog.push(`audit:${callCount}`);
      return {
        delegationId: delegation.id,
        status: "FAIL",
        summary: "Audit failed",
        findings: ["Audit failure"],
        acceptanceCriteriaResults: (delegation.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          passed: false,
          evidence: "Failed",
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

function createFailingThenPassingReviewExecutor(failCount: number, callLog: string[]): ReviewExecutor {
  let callCount = 0;
  return async (request) => {
    callCount++;
    callLog.push(`review:${callCount}`);
    if (callCount <= failCount) {
      return {
        id: `res-${request.id}`,
        requestId: request.id,
        delegationId: request.delegationId,
        passed: false,
        issues: [{ severity: "high", description: "Review failed" }],
        reviewerRole: request.reviewerRole,
        summary: "Review failed",
        createdAt: new Date().toISOString(),
      };
    }
    return {
      id: `res-${request.id}`,
      requestId: request.id,
      delegationId: request.delegationId,
      passed: true,
      issues: [],
      reviewerRole: request.reviewerRole,
      summary: "Review passed",
      createdAt: new Date().toISOString(),
    };
  };
}

async function setupOrchestrator(config: {
  factoryAdapter: FactoryExecutionAdapter;
  auditor: Auditor;
  peerReview?: PeerReviewSystem;
  reviewExecutor?: ReviewExecutor;
}) {
  const mission = createMission(
    "Build the game",
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
      requiresReview: true,
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
    supervisor,
    peerReview: config.peerReview,
    reviewExecutor: config.reviewExecutor,
  });

  return { orchestrator, mission, eventSink, state, buildDel, plan };
}

function getEvents(eventSink: InMemoryEventSink, type: string) {
  return eventSink.recent().filter((e) => e.type === type);
}

// ── Tests ──────────────────────────────────────────────────

describe("Peer review repair must be re-audited", () => {
  it("runs re-audit after successful peer review", async () => {
    const auditCallLog: string[] = [];
    const reviewCallLog: string[] = [];
    const peerReview = new PeerReviewSystem({ maxReviewAttempts: 2 });

    // Wrap the review executor to log calls
    const originalExecutor = createPassingReviewExecutor();
    const loggingExecutor: ReviewExecutor = async (request) => {
      reviewCallLog.push(`review:executor`);
      return originalExecutor(request);
    };

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      auditor: createPassingAuditorWithCallLog(auditCallLog),
      peerReview,
      reviewExecutor: loggingExecutor,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should complete successfully
    expect(result.status).toBe("completed");

    // First audit should run (before peer review)
    // Peer review should run
    // Re-audit should run (after peer review)
    expect(auditCallLog).toContain("audit:1");
    expect(auditCallLog).toContain("audit:2");
    expect(reviewCallLog).toContain("review:executor");

    // Audit passed events: initial audit + re-audit
    const auditPassedEvents = getEvents(eventSink, MissionEventTypes.MISSION_AUDIT_PASSED);
    expect(auditPassedEvents.length).toBe(2);
  });

  it("fails mission if re-audit fails after peer review repair", async () => {
    const auditCallLog: string[] = [];
    const peerReview = new PeerReviewSystem({ maxReviewAttempts: 2 });

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      auditor: createFailingAuditorWithCallLog(auditCallLog), // Always fails
      peerReview,
      reviewExecutor: createPassingReviewExecutor(),
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should fail because re-audit fails
    expect(result.status).toBe("failed");

    // Audit failed event should be emitted for re-audit
    const auditFailedEvents = getEvents(eventSink, MissionEventTypes.MISSION_AUDIT_FAILED);
    expect(auditFailedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("runs re-audit after peer review repair (review fails once, then passes)", async () => {
    const auditCallLog: string[] = [];
    const reviewCallLog: string[] = [];
    const peerReview = new PeerReviewSystem({ maxReviewAttempts: 2 });

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      auditor: createPassingAuditorWithCallLog(auditCallLog),
      peerReview,
      reviewExecutor: createFailingThenPassingReviewExecutor(1, reviewCallLog), // First review fails, second passes
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should complete successfully (review fails once, repair runs, re-review passes, re-audit passes)
    expect(result.status).toBe("completed");

    // Should have 2 review attempts (1 fail + 1 pass)
    expect(reviewCallLog).toContain("review:1");
    expect(reviewCallLog).toContain("review:2");

    // Should have 2 audits (initial + re-audit after review passes)
    expect(auditCallLog).toContain("audit:1");
    expect(auditCallLog).toContain("audit:2");
  });

  it("does not run re-audit when peer review is not required", async () => {
    const auditCallLog: string[] = [];

    // Create a new mission with a delegation that doesn't require review
    const mission2 = createMission(
      "Build without review",
      {
        projectId: "test-game-2",
        engine: "web",
        stack: "phaser",
        workspace: projectPath,
      }
    );

    const stateDir2 = path.join(tmpDir, "state2");
    await fs.mkdir(stateDir2, { recursive: true });
    const state2 = new MissionState(stateDir2, mission2.id);
    await state2.init();
    await state2.setMission(mission2);

    const buildDel = createDelegation(
      mission2.id,
      "obj-build",
      "Build Project",
      "ROLE: builder\nBUILD_COMMAND: echo ok",
      "engineering",
      {
        stepIds: ["build"],
        dependsOn: [],
        acceptanceCriteria: ["Build succeeds"],
        role: "Developer",
        requiresReview: false, // No review required
      }
    );

    const plan2: ExecutionPlan = {
      id: "plan-2",
      missionId: mission2.id,
      objectives: [{ id: "obj-build", title: "Build", description: "Build the project", delegations: [buildDel.id] }],
      delegations: [buildDel],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state2.setPlan(plan2);
    await state2.addDelegation(buildDel);

    const eventSink2 = new InMemoryEventSink();
    const publisher2 = createMissionEventPublisher(eventSink2);
    const supervisor2 = createMissionSupervisor({
      missionState: state2,
      eventSink: eventSink2,
      publisher: publisher2,
      maxRecoveryAttempts: 3,
      maxStuckRecoveries: 2,
      maxDelegationDurationMs: 5 * 60 * 1000,
      stuckDetectionIntervalMs: 30 * 1000,
      maxReplanAttempts: 2,
      maxModelFallbackAttempts: 3,
      maxDynamicDelegations: 10,
    });

    const orchestrator2 = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: createPassingAdapter(),
      auditor: createPassingAuditorWithCallLog(auditCallLog),
      eventSink: eventSink2,
      missionState: state2,
      supervisor: supervisor2,
      // No peerReview configured
    });

    const result = await orchestrator2.executeMission(mission2, plan2);

    expect(result.status).toBe("completed");

    // Only initial audit should run, no re-audit
    expect(auditCallLog).toContain("audit:1");
    expect(auditCallLog).not.toContain("audit:2");
  });
});