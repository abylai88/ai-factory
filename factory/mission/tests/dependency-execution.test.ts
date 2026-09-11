import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";
import type { Delegation, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dep-exec-"));
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

async function setupOrchestrator(config: {
  adapter: FactoryExecutionAdapter;
  validation?: { buildCommand?: string; testCommand?: string; maxRepairAttempts?: number };
}) {
  const mission = createMission("Build a game with dependencies", {
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
    validation: config.validation,
  });

  return { orchestrator, mission, eventSink, state };
}

// ── Tests ────────────────────────────────────────────────────

describe("Dependency graph execution", () => {
  it("independent tasks execute in parallel", async () => {
    const executionOrder: string[] = [];
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        executionOrder.push(del.id);
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const { orchestrator, mission, state } = await setupOrchestrator({ adapter });

    // Create 3 independent delegations (no dependencies)
    const del1 = createDelegation(mission.id, "obj-1", "Task A", "ROLE: researcher\nAnalyze market", "engineering", {
      stepIds: ["research"],
      dependsOn: [],
      parallelizable: true,
    });
    const del2 = createDelegation(mission.id, "obj-1", "Task B", "ROLE: researcher\nAnalyze competitors", "engineering", {
      stepIds: ["research"],
      dependsOn: [],
      parallelizable: true,
    });
    const del3 = createDelegation(mission.id, "obj-1", "Task C", "ROLE: researcher\nAnalyze trends", "engineering", {
      stepIds: ["research"],
      dependsOn: [],
      parallelizable: true,
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Research", description: "Market research", delegations: [del1.id, del2.id, del3.id] }],
      delegations: [del1, del2, del3],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);
    await state.addDelegation(del2);
    await state.addDelegation(del3);

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    expect(executionOrder).toHaveLength(3);
  });

  it("dependent task waits for dependency", async () => {
    const executionOrder: string[] = [];
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        executionOrder.push(del.id);
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const { orchestrator, mission, state } = await setupOrchestrator({ adapter });

    const del1 = createDelegation(mission.id, "obj-1", "Research", "ROLE: researcher\nResearch", "engineering", {
      stepIds: ["research"],
      dependsOn: [],
      parallelizable: true,
    });
    const del2 = createDelegation(mission.id, "obj-1", "Implement", "ROLE: developer\nBuild", "engineering", {
      stepIds: ["implementation"],
      dependsOn: [del1.id],
      parallelizable: false,
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Dev", description: "Develop", delegations: [del1.id, del2.id] }],
      delegations: [del1, del2],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);
    await state.addDelegation(del2);

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    // del1 must execute before del2
    expect(executionOrder.indexOf(del1.id)).toBeLessThan(executionOrder.indexOf(del2.id));
  });

  it("dependency failure blocks downstream task", async () => {
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id === "del-fail") {
          return { delegationId: del.id, status: "failed", output: "", error: "Failed", durationMs: 10 };
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const { orchestrator, mission, state, eventSink } = await setupOrchestrator({ adapter });

    const del1 = createDelegation(mission.id, "obj-1", "Build", "ROLE: builder\nBuild", "engineering", {
      stepIds: ["build"],
      dependsOn: [],
      parallelizable: false,
    });
    del1.id = "del-fail";
    const del2 = createDelegation(mission.id, "obj-1", "Test", "ROLE: tester\nTest", "engineering", {
      stepIds: ["test"],
      dependsOn: ["del-fail"],
      parallelizable: false,
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "QA", description: "Test", delegations: [del1.id, del2.id] }],
      delegations: [del1, del2],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);
    await state.addDelegation(del2);

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should fail because del1 failed and del2 depends on it
    expect(result.status).toBe("failed");
    const del2State = state.getDelegation(del2.id);
    expect(del2State?.status).toBe("blocked");
  });

  it("dependency success unlocks downstream task", async () => {
    const executionOrder: string[] = [];
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        executionOrder.push(del.id);
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const { orchestrator, mission, state } = await setupOrchestrator({ adapter });

    const del1 = createDelegation(mission.id, "obj-1", "Research", "ROLE: researcher\nResearch", "engineering", {
      stepIds: ["research"],
      dependsOn: [],
      parallelizable: true,
    });
    const del2 = createDelegation(mission.id, "obj-1", "Design", "ROLE: designer\nDesign", "engineering", {
      stepIds: ["design"],
      dependsOn: [del1.id],
      parallelizable: true,
    });
    const del3 = createDelegation(mission.id, "obj-1", "Implement", "ROLE: developer\nBuild", "engineering", {
      stepIds: ["implementation"],
      dependsOn: [del1.id, del2.id],
      parallelizable: false,
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Dev", description: "Develop", delegations: [del1.id, del2.id, del3.id] }],
      delegations: [del1, del2, del3],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);
    await state.addDelegation(del2);
    await state.addDelegation(del3);

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    expect(executionOrder).toHaveLength(3);
    // del1 and del2 must execute before del3
    expect(executionOrder.indexOf(del1.id)).toBeLessThan(executionOrder.indexOf(del3.id));
    expect(executionOrder.indexOf(del2.id)).toBeLessThan(executionOrder.indexOf(del3.id));
  });
});
