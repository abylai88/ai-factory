import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";
import { MissionPlanner, createMissionPlanner, type PlanningModel } from "../mission-planner.js";
import type { Delegation, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "replan-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────

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

function getEvents(eventSink: InMemoryEventSink, type: string) {
  return eventSink.recent().filter((e) => e.type === type);
}

function createReplannerModel(response: string | Error): PlanningModel {
  return {
    async generatePlan(): Promise<string> {
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

async function setupOrchestrator(config: {
  adapter: FactoryExecutionAdapter;
  replanner?: MissionPlanner;
  maxReplanAttempts?: number;
  validation?: { buildCommand?: string; testCommand?: string; maxRepairAttempts?: number };
}) {
  const mission = createMission("Build a game that needs replanning", {
    projectId: "test-game",
    engine: "web",
    stack: "phaser",
    workspace: path.join(tmpDir, "project"),
  });

  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const state = new MissionState(stateDir, mission.id);
  await state.init();
  await state.setMission(mission);

  const eventSink = new InMemoryEventSink();

  const orchestrator = new MissionOrchestrator({
    maxRepairs: 3,
    baseDir: tmpDir,
    project: path.join(tmpDir, "project"),
    factoryAdapter: config.adapter,
    auditor: createPassingAuditor(),
    eventSink,
    missionState: state,
    replanner: config.replanner,
    maxReplanAttempts: config.maxReplanAttempts ?? 2,
    validation: config.validation,
  });

  return { orchestrator, mission, eventSink, state };
}

// ── Tests ────────────────────────────────────────────────────

describe("Replanning after failure", () => {
  it("repeated repair failures trigger replanning", async () => {
    let executionCount = 0;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        executionCount++;
        if (del.id.startsWith("replan-")) {
          // Replanned delegation succeeds
          return { delegationId: del.id, status: "passed", output: "Replan succeeded", durationMs: 10 };
        }
        // First delegation always fails validation
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    // Replanner that produces a new delegation
    const replanPlan = JSON.stringify({
      goal: "Build a game",
      delegations: [
        {
          id: "replan-fix",
          title: "Replanned Fix",
          role: "Architect",
          task: "Redesign and fix the issue",
          dependsOn: [],
          validation: null,
        },
      ],
    });

    const replanner = createMissionPlanner(createReplannerModel(replanPlan));
    const { orchestrator, mission, eventSink, state } = await setupOrchestrator({
      adapter,
      replanner,
      maxReplanAttempts: 2,
      validation: { buildCommand: "echo fail", maxRepairAttempts: 1 },
    });

    const del1 = createDelegation(mission.id, "obj-1", "Build Game", "ROLE: builder\nBUILD_COMMAND: echo fail", "engineering", {
      stepIds: ["build"],
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: ["Build succeeds"],
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [{ id: "vg-1", delegationId: del1.id, criteria: ["Build succeeds"] }],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    const result = await orchestrator.executeMission(mission, plan);

    // Check that replan events were emitted
    const replanStarted = getEvents(eventSink, "mission.replan_started" as any);
    const replanCompleted = getEvents(eventSink, "mission.replan_completed" as any);

    expect(replanStarted.length).toBeGreaterThanOrEqual(1);
    expect(replanCompleted.length).toBeGreaterThanOrEqual(1);
  });

  it("replanner changes strategy", async () => {
    const executedRoles: string[] = [];

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        const roleMatch = del.description.match(/ROLE:\s*(\w+)/);
        if (roleMatch) executedRoles.push(roleMatch[1]);
        // Always return passed — validation gate handles the failure
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const replanPlan = JSON.stringify({
      goal: "Build a game",
      delegations: [
        {
          id: "replan-architect",
          title: "Architecture Review",
          role: "Architect",
          task: "Review and redesign architecture",
          dependsOn: [],
          validation: null,
        },
        {
          id: "replan-developer",
          title: "New Implementation",
          role: "Developer",
          task: "Implement based on new architecture",
          dependsOn: ["replan-architect"],
          validation: null,
        },
      ],
    });

    const replanner = createMissionPlanner(createReplannerModel(replanPlan));
    const { orchestrator, mission, state, eventSink } = await setupOrchestrator({
      adapter,
      replanner,
      maxReplanAttempts: 1,
      validation: { buildCommand: "echo fail", maxRepairAttempts: 1 },
    });

    const del1 = createDelegation(mission.id, "obj-1", "Build", "ROLE: builder\nBUILD_COMMAND: echo fail", "engineering", {
      stepIds: ["build"],
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: ["Build succeeds"],
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [{ id: "vg-1", delegationId: del1.id, criteria: ["Build succeeds"] }],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    await orchestrator.executeMission(mission, plan);

    const allDelegations = state.getDelegations();
    const replanDelegations = allDelegations.filter(d => d.id.startsWith("replan-"));

    expect(replanDelegations.length).toBeGreaterThanOrEqual(1);
    expect(replanDelegations.some(d => d.description.includes("architect"))).toBe(true);
    expect(replanDelegations.some(d => d.description.includes("developer"))).toBe(true);
  });

  it("max replan attempts is respected", async () => {
    let replanCount = 0;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(): Promise<AgentResult> {
        return { delegationId: "test", status: "passed", output: "Done", durationMs: 10 };
      },
    };

    // Replanner that always produces a new plan (to trigger more replanning)
    const replannerModel: PlanningModel = {
      async generatePlan(): Promise<string> {
        replanCount++;
        return JSON.stringify({
          goal: "Build a game",
          delegations: [
            {
              id: `replan-attempt-${replanCount}`,
              title: `Replan Attempt ${replanCount}`,
              role: "Developer",
              task: "Try again",
              dependsOn: [],
              validation: null,
            },
          ],
        });
      },
    };

    const replanner = createMissionPlanner(replannerModel);
    const { orchestrator, mission, state } = await setupOrchestrator({
      adapter,
      replanner,
      maxReplanAttempts: 2,
    });

    const del1 = createDelegation(mission.id, "obj-1", "Build", "ROLE: builder\nBUILD_COMMAND: echo fail", "engineering", {
      stepIds: ["build"],
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: ["Build succeeds"],
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [{ id: "vg-1", delegationId: del1.id, criteria: ["Build succeeds"] }],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    await orchestrator.executeMission(mission, plan);

    // replanner should have been called at most 2 times
    expect(replanCount).toBeLessThanOrEqual(2);
  });
});
