import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation, createRepairPlan } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes, createMissionEventPublisher } from "../events.js";
import { createMissionSupervisor } from "../mission-supervisor.js";
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan, RepairPlan } from "../mission.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repair-iteration-restart-"));
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

function createFailingThenPassingAdapter(callLog: string[], failCount: number): FactoryExecutionAdapter {
  let calls = 0;
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      callLog.push(`${del.id}`);
      if (del.id.startsWith("repair-")) {
        calls++;
        if (calls <= failCount) {
          return {
            delegationId: del.id,
            status: "failed",
            output: "",
            error: "Repair failed",
            durationMs: 100,
          };
        }
        return {
          delegationId: del.id,
          status: "passed",
          output: "Fixed",
          durationMs: 100,
        };
      }
      // Original delegation fails
      return {
        delegationId: del.id,
        status: "failed",
        output: "",
        error: "Original failed",
        durationMs: 100,
      };
    },
  };
}

function createAlwaysFailingAdapter(): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      return {
        delegationId: del.id,
        status: "failed",
        output: "",
        error: "Always fails",
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

async function setupOrchestrator(config: {
  factoryAdapter: FactoryExecutionAdapter;
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
    auditor: createPassingAuditor(),
    eventSink,
    missionState: state,
    supervisor,
  });

  return { orchestrator, mission, eventSink, state, buildDel, plan };
}

// ── Tests ──────────────────────────────────────────────────

describe("Repair iteration persists across restart", () => {
  it("resumes from persisted iteration on state reload", async () => {
    const callLog: string[] = [];
    
    // First run: original fails, repairs fail twice then succeed on 3rd attempt
    // After completion, iteration should be 3 (maxRepairs)
    const { orchestrator: orchestrator1, mission, state, plan } = await setupOrchestrator({
      factoryAdapter: createFailingThenPassingAdapter(callLog, 2),
    });

    await orchestrator1.executeMission(mission, plan);

    // Verify state persisted iteration = 3 (maxRepairs reached after success)
    const delegations = state.getDelegations();
    const buildDel = delegations.find(d => d.title === "Build Project");
    expect(buildDel).toBeDefined();
    
    const persistedPlan = state.getRepairPlan(buildDel!.id);
    expect(persistedPlan).toBeDefined();
    // After successful repair on 3rd attempt, iteration = 3 (maxRepairs)
    expect(persistedPlan!.iteration).toBe(3);

    // Simulate restart: create new orchestrator with same state
    const stateDir = path.join(tmpDir, "state");
    const state2 = new MissionState(stateDir, mission.id);
    await state2.init();

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

    // Try to repair again - should fail immediately since already at maxRepairs
    const callLog2: string[] = [];
    const orchestrator2 = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: createFailingThenPassingAdapter(callLog2, 0),
      auditor: createPassingAuditor(),
      eventSink: eventSink2,
      missionState: state2,
      supervisor: supervisor2,
    });

    const delegations2 = state2.getDelegations();
    const buildDel2 = delegations2.find(d => d.title === "Build Project");
    expect(buildDel2).toBeDefined();

    const result2 = await orchestrator2.repairDelegation(buildDel2!, {
      delegationId: buildDel2!.id,
      status: "FAIL",
      summary: "Audit failed",
      findings: ["Test"],
      acceptanceCriteriaResults: [],
      recommendedRepair: { description: "Fix", focusAreas: ["test"] },
    });

    // Should fail immediately without attempting repair since iteration == maxRepairs
    expect(result2).toBe(false);
    // No repair should have been attempted
    expect(callLog2.filter(log => log.startsWith("repair-")).length).toBe(0);
  });

  it("does not attempt repair when already at maxRepairs", async () => {
    const stateDir = path.join(tmpDir, "state");
    const state = new MissionState(stateDir, "test-mission-2");
    await state.init();

    const mission = createMission(
      "Test mission 2",
      { projectId: "test2", workspace: projectPath }
    );
    await state.setMission(mission);

    const buildDel = createDelegation(
      mission.id,
      "obj-1",
      "Test",
      "Test",
      "engineering",
      { dependsOn: [], acceptanceCriteria: ["Test"] }
    );
    await state.addDelegation(buildDel);

    // Pre-populate repair plan with iteration = 3 (already at max)
    const existingPlan = createRepairPlan(
      buildDel.id,
      "Fix issues",
      ["test"],
      3
    );
    existingPlan.iteration = 3; // Already at max
    await state.startRepair(buildDel.id, existingPlan);

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

    let repairCalled = false;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id.startsWith("repair-")) {
          repairCalled = true;
        }
        return { delegationId: del.id, status: "passed", output: "Fixed", durationMs: 100 };
      }
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      supervisor,
    });

    const auditResult: AuditResult = {
      delegationId: buildDel.id,
      status: "FAIL",
      summary: "Audit failed",
      findings: ["Test"],
      acceptanceCriteriaResults: [],
      recommendedRepair: { description: "Fix", focusAreas: ["test"] },
    };

    const result = await orchestrator.repairDelegation(buildDel, auditResult);

    // Should fail immediately without attempting repair since iteration == maxRepairs
    expect(result).toBe(false);
    expect(repairCalled).toBe(false);
  });

  it("increments iteration on each repair attempt", async () => {
    const callLog: string[] = [];
    const { orchestrator, state, plan, mission } = await setupOrchestrator({
      factoryAdapter: createFailingThenPassingAdapter(callLog, 1), // 1 failure, then pass
    });

    await orchestrator.executeMission(mission, plan);

    // Verify iteration was incremented to 2 (1 failure + 1 success = 2 attempts)
    const delegations = state.getDelegations();
    const buildDel = delegations.find(d => d.title === "Build Project");
    expect(buildDel).toBeDefined();
    
    const finalPlan = state.getRepairPlan(buildDel!.id);
    expect(finalPlan).toBeDefined();
    expect(finalPlan!.iteration).toBe(2);
  });
});