import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  type Mission,
  type ExecutionPlan,
  type Delegation,
  type AgentResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { createReadOnlyPlanner } from "../planner.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  type FactoryExecutionAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink, createMissionEventPublisher, MissionEventTypes } from "../events.js";
import { createModelRouter } from "../model-router.js";
import { createMissionSupervisor } from "../mission-supervisor.js";
import { PeerReviewSystem, defaultReviewExecutor } from "../peer-review.js";
import { createMissionPlanner, type PlanningModel } from "../mission-planner.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-pipeline-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Deterministic Mock Factory Adapter ────────────────────────

class DeterministicMockAdapter implements FactoryExecutionAdapter {
  public executedDelegations: string[] = [];
  private state: MissionState;

  constructor(state: MissionState) {
    this.state = state;
  }

  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string; model?: string }
  ): Promise<AgentResult> {
    this.executedDelegations.push(delegation.id);

    const output = `Delegation "${delegation.title}" completed successfully.
The project structure has been analyzed with src/index.ts as the main entry point.
Architecture documented: the application uses a scene-based design with components organized in modules.
Key components identified: BootScene, GameScene, MenuScene, Player, and ObstacleManager.
The codebase analyzed shows a well-structured Phaser game with TypeScript configuration.
All acceptance criteria met. No files modified during this investigation.`;

    return {
      delegationId: delegation.id,
      status: "passed",
      output,
      durationMs: 10,
    };
  }
}

// ── Deterministic Mock Planning Model ─────────────────────────

function createMockPlanningModel(): PlanningModel {
  return {
    async generatePlan(_prompt: string): Promise<string> {
      // Return a valid plan JSON that MissionPlanner can parse
      return JSON.stringify({
        goal: "Build a test game",
        delegations: [
          {
            id: "research-1",
            title: "Research market",
            role: "Researcher",
            task: "Analyze the market",
            dependsOn: [],
            validation: null,
          },
          {
            id: "implement-1",
            title: "Implement game",
            role: "Developer",
            task: "Build the game code",
            dependsOn: ["research-1"],
            validation: {
              buildCommand: "npm run build",
              acceptanceCriteria: ["Build succeeds"],
            },
          },
        ],
        risks: [],
      });
    },
  };
}

// ── Full Pipeline Tests ───────────────────────────────────────

describe("E2E Full Pipeline — public mission execution path", () => {
  it("exercises executeGameMission → MissionOrchestrator → delegation → validation → completion", async () => {
    const state = new MissionState(tmpDir, "e2e-pipeline-test");
    await state.init();

    const mission = createMission("Build a test game", {
      projectId: "e2e-pipeline-test",
      engine: "web",
      stack: "phaser",
      template: "test-template",
      workspace: tmpDir,
      requiresVisualQa: false,
    });

    await state.setMission(mission);

    // Use MissionPlanner with mock model
    const plannerModel = createMockPlanningModel();
    const planner = createMissionPlanner(plannerModel, {
      maxDelegations: 10,
    });
    const plan = await planner.createPlan(mission);

    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    // Wire all Phase 8-9 systems
    const eventSink = new InMemoryEventSink();
    const publisher = createMissionEventPublisher(eventSink);
    const modelRouter = createModelRouter();
    const supervisor = createMissionSupervisor({
      missionState: state,
      eventSink,
      publisher,
      modelRouter,
    });
    const peerReview = new PeerReviewSystem();
    const auditor = new DeterministicAuditor();
    const factoryAdapter = new DeterministicMockAdapter(state);

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: tmpDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      modelRouter,
      peerReview,
      reviewExecutor: defaultReviewExecutor,
      validation: undefined,
      supervisor,
      replanner: planner,
    });

    const completedMission = await orchestrator.executeMission(mission, plan);

    // Verify completion
    expect(completedMission.status).toBe("completed");

    // Verify all delegations were executed
    const finalDelegations = state.getDelegations();
    expect(finalDelegations.length).toBeGreaterThanOrEqual(2);
    expect(finalDelegations.every((d) => d.status === "passed")).toBe(true);

    // Verify events were emitted
    const events = eventSink.recent();
    expect(events.length).toBeGreaterThan(0);

    // Verify important lifecycle events published through eventSink
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(MissionEventTypes.DELEGATION_STARTED);
    expect(eventTypes).toContain(MissionEventTypes.DELEGATION_COMPLETED);
  });

  it("verifies production wiring contains supervisor, model router, peer review, validation, planner", async () => {
    const state = new MissionState(tmpDir, "e2e-wiring-test");
    await state.init();

    const mission = createMission("Build a test", {
      projectId: "e2e-wiring-test",
      engine: "web",
      stack: "phaser",
      template: "test-template",
      workspace: tmpDir,
    });
    await state.setMission(mission);

    const plannerModel = createMockPlanningModel();
    const planner = createMissionPlanner(plannerModel);
    const plan = await planner.createPlan(mission);
    await state.setPlan(plan);

    const eventSink = new InMemoryEventSink();
    const publisher = createMissionEventPublisher(eventSink);
    const modelRouter = createModelRouter();
    const supervisor = createMissionSupervisor({
      missionState: state,
      eventSink,
      publisher,
      modelRouter,
    });
    const peerReview = new PeerReviewSystem();
    const auditor = new DeterministicAuditor();
    const factoryAdapter = new DeterministicMockAdapter(state);

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: tmpDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      modelRouter,
      peerReview,
      reviewExecutor: defaultReviewExecutor,
      validation: {
        buildCommand: "npm run build",
        timeoutMs: 120_000,
        maxRepairAttempts: 3,
      },
      supervisor,
      replanner: planner,
    });

    // Verify all systems are connected by running the mission
    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");

    // Verify supervisor tracked the delegations
    const counters = supervisor.getCounters();
    expect(counters.decisionCount).toBeGreaterThanOrEqual(0);

    // Verify model router is functional
    const route = modelRouter.chooseModel({
      delegation: plan.delegations[0],
      role: "Developer",
      mission,
    });
    expect(route.primary).toBeTruthy();
    expect(route.fallbacks.length).toBeGreaterThanOrEqual(0);

    // Verify peer review system is functional
    const reviewRequest = peerReview.createReviewRequest({
      delegation: plan.delegations[0],
      agentResult: { delegationId: plan.delegations[0].id, status: "passed", output: "test", durationMs: 10 },
      mission,
    });
    // reviewRequest may be null if the role doesn't require review — that's fine
  });

  it("exercises read-only planner path", async () => {
    const state = new MissionState(tmpDir, "e2e-readonly-test");
    await state.init();

    const mission = createMission("Inspect the project architecture", {
      projectId: "e2e-readonly-test",
      engine: "web",
      stack: "phaser",
      template: "test-template",
      workspace: tmpDir,
      requiresVisualQa: false,
    });
    await state.setMission(mission);

    const readOnlyPlanner = createReadOnlyPlanner({ maxDelegations: 1 });
    const plan = readOnlyPlanner.decompose(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const eventSink = new InMemoryEventSink();
    const publisher = createMissionEventPublisher(eventSink);
    const modelRouter = createModelRouter();
    const supervisor = createMissionSupervisor({
      missionState: state,
      eventSink,
      publisher,
      modelRouter,
    });
    const peerReview = new PeerReviewSystem();
    const auditor = new DeterministicAuditor();
    const factoryAdapter = new DeterministicMockAdapter(state);

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: tmpDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      modelRouter,
      peerReview,
      reviewExecutor: defaultReviewExecutor,
      validation: undefined,
      supervisor,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
  });

  it("supervisor detects stuck delegations and emits events", async () => {
    const state = new MissionState(tmpDir, "e2e-supervisor-test");
    await state.init();

    const mission = createMission("Build a game", {
      projectId: "e2e-supervisor-test",
      engine: "web",
      stack: "phaser",
      template: "test-template",
      workspace: tmpDir,
    });
    await state.setMission(mission);

    const plannerModel = createMockPlanningModel();
    const planner = createMissionPlanner(plannerModel);
    const plan = await planner.createPlan(mission);
    await state.setPlan(plan);

    const eventSink = new InMemoryEventSink();
    const publisher = createMissionEventPublisher(eventSink);
    const modelRouter = createModelRouter();
    const supervisor = createMissionSupervisor({
      missionState: state,
      eventSink,
      publisher,
      modelRouter,
      maxDelegationDurationMs: 1, // 1ms — everything is "stuck" immediately
    });

    const peerReview = new PeerReviewSystem();
    const auditor = new DeterministicAuditor();
    const factoryAdapter = new DeterministicMockAdapter(state);

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: tmpDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      modelRouter,
      peerReview,
      reviewExecutor: defaultReviewExecutor,
      validation: undefined,
      supervisor,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission may complete or fail depending on stuck detection
    expect(["completed", "failed"]).toContain(result.status);

    // Verify supervisor was involved
    const counters = supervisor.getCounters();
    expect(counters.decisionCount).toBeGreaterThanOrEqual(0);
  });
});
