import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes, createMissionEventPublisher } from "../events.js";
import { createMissionSupervisor } from "../mission-supervisor.js";
import { PeerReviewSystem, defaultReviewExecutor } from "../peer-review.js";
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "peer-review-executor-safety-"));
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
    async audit(delegation: Delegation): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: "PASS",
        summary: "All checks passed",
        findings: [],
        acceptanceCriteriaResults: (delegation.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          passed: true,
          evidence: "Verified",
        })),
      };
    },
  };
}

async function setupTestState() {
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

  return { mission, state, buildDel, plan, eventSink, publisher, supervisor };
}

// ── Tests ──────────────────────────────────────────────────

describe("Peer review executor production safety", () => {
  let testSetup: Awaited<ReturnType<typeof setupTestState>>;

  beforeEach(async () => {
    testSetup = await setupTestState();
  });

  it("throws at construction when peerReview is enabled but no reviewExecutor provided", () => {
    expect(() => {
      new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: projectPath,
        factoryAdapter: createPassingAdapter(),
        auditor: createPassingAuditor(),
        eventSink: testSetup.eventSink,
        missionState: testSetup.state,
        supervisor: testSetup.supervisor,
        peerReview: new PeerReviewSystem(),
        // No reviewExecutor provided
      });
    }).toThrow(/Peer review is enabled but no reviewExecutor is configured/);
  });

  it("allows construction when peerReview is enabled AND reviewExecutor is provided", () => {
    expect(() => {
      new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: projectPath,
        factoryAdapter: createPassingAdapter(),
        auditor: createPassingAuditor(),
        eventSink: testSetup.eventSink,
        missionState: testSetup.state,
        supervisor: testSetup.supervisor,
        peerReview: new PeerReviewSystem(),
        reviewExecutor: defaultReviewExecutor, // Explicit executor
      });
    }).not.toThrow();
  });

  it("allows construction when peerReview is NOT enabled (no reviewExecutor needed)", () => {
    expect(() => {
      new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: projectPath,
        factoryAdapter: createPassingAdapter(),
        auditor: createPassingAuditor(),
        eventSink: testSetup.eventSink,
        missionState: testSetup.state,
        supervisor: testSetup.supervisor,
        // No peerReview, no reviewExecutor needed
      });
    }).not.toThrow();
  });

  it("allows construction with peerReview but explicit mock executor for tests", () => {
    const mockExecutor = async () => ({
      id: "res-mock",
      requestId: "req-mock",
      delegationId: "del-mock",
      passed: true,
      issues: [],
      reviewerRole: "QA" as const,
      summary: "Mock review passed",
      createdAt: new Date().toISOString(),
    });

    expect(() => {
      new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: projectPath,
        factoryAdapter: createPassingAdapter(),
        auditor: createPassingAuditor(),
        eventSink: testSetup.eventSink,
        missionState: testSetup.state,
        supervisor: testSetup.supervisor,
        peerReview: new PeerReviewSystem(),
        reviewExecutor: mockExecutor,
      });
    }).not.toThrow();
  });
});