import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-del-"));
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

async function createTestMission() {
  const mission = createMission("Build a game with dynamic tasks", {
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

  return { mission, state };
}

// ── Tests ────────────────────────────────────────────────────

describe("Dynamic delegation", () => {
  it("orchestrator adds delegation during execution", async () => {
    const executedDelegations: string[] = [];
    const { mission, state } = await createTestMission();
    const eventSink = new InMemoryEventSink();

    // Use a mutable reference so the adapter can access the orchestrator
    let orchRef: MissionOrchestrator | null = null;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation, m: Mission): Promise<AgentResult> {
        executedDelegations.push(del.id);

        // After first delegation runs, add a dynamic one
        if (executedDelegations.length === 1 && orchRef) {
          const dynamicDel = createDelegation(m.id, "obj-1", "Dynamic Task", "ROLE: developer\nExtra work", "engineering", {
            stepIds: [],
            dependsOn: [],
            parallelizable: false,
          });
          orchRef.addDelegation(dynamicDel);
        }

        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      maxDynamicDelegations: 5,
    });

    orchRef = orchestrator;

    const del1 = createDelegation(mission.id, "obj-1", "Initial Task", "ROLE: developer\nBuild", "engineering", {
      stepIds: ["implementation"],
      dependsOn: [],
      parallelizable: false,
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Dev", description: "Develop", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    expect(executedDelegations).toContain(del1.id);
    expect(executedDelegations.length).toBe(2);
  });

  it("delegation appears in event stream", async () => {
    const { mission, state } = await createTestMission();
    const eventSink = new InMemoryEventSink();
    let orchRef: MissionOrchestrator | null = null;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation, m: Mission): Promise<AgentResult> {
        if (orchRef) {
          const dynamicDel = createDelegation(m.id, "obj-1", "Extra Work", "ROLE: researcher\nResearch", "engineering", {
            stepIds: [],
            dependsOn: [],
          });
          orchRef.addDelegation(dynamicDel);
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      maxDynamicDelegations: 5,
    });

    orchRef = orchestrator;

    const del1 = createDelegation(mission.id, "obj-1", "Initial", "ROLE: developer\nBuild", "engineering", {
      stepIds: ["implementation"],
      dependsOn: [],
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Dev", description: "Develop", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    await orchestrator.executeMission(mission, plan);

    // Check that delegation.created event was emitted for dynamic delegation
    const createdEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_CREATED);
    const dynamicCreated = createdEvents.find(
      (e) => (e.payload as Record<string, unknown>).dynamic === true
    );
    expect(dynamicCreated).toBeDefined();
  });

  it("delegation receives MissionMemory context", async () => {
    const executedDescriptions: string[] = [];
    const { mission, state } = await createTestMission();
    const eventSink = new InMemoryEventSink();
    let orchRef: MissionOrchestrator | null = null;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation, m: Mission): Promise<AgentResult> {
        executedDescriptions.push(del.description);

        if (orchRef && executedDescriptions.length === 1) {
          const dynamicDel = createDelegation(m.id, "obj-1", "Schema Design", "ROLE: architect\nDesign database schema", "engineering", {
            stepIds: [],
            dependsOn: [],
          });
          orchRef.addDelegation(dynamicDel);
        }

        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      maxDynamicDelegations: 5,
    });

    orchRef = orchestrator;

    const del1 = createDelegation(mission.id, "obj-1", "Build", "ROLE: developer\nBuild", "engineering", {
      stepIds: ["implementation"],
      dependsOn: [],
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Dev", description: "Develop", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    await orchestrator.executeMission(mission, plan);

    expect(executedDescriptions.some((d) => d.includes("architect"))).toBe(true);
    expect(executedDescriptions.some((d) => d.includes("Design database schema"))).toBe(true);
  });

  it("rejects delegation when max dynamic limit reached", async () => {
    const { mission, state } = await createTestMission();
    const eventSink = new InMemoryEventSink();
    let orchRef: MissionOrchestrator | null = null;
    let addCount = 0;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation, m: Mission): Promise<AgentResult> {
        if (orchRef && addCount < 6) {
          addCount++;
          const dynDel = createDelegation(m.id, "obj-1", `Dynamic ${addCount}`, "ROLE: developer\nWork", "engineering", {
            stepIds: [],
            dependsOn: [],
          });
          orchRef.addDelegation(dynDel);
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 10 };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      maxDynamicDelegations: 5,
    });

    orchRef = orchestrator;

    const del1 = createDelegation(mission.id, "obj-1", "Initial", "ROLE: developer\nBuild", "engineering", {
      stepIds: ["implementation"],
      dependsOn: [],
    });

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Dev", description: "Develop", delegations: [del1.id] }],
      delegations: [del1],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del1);

    await orchestrator.executeMission(mission, plan);

    const delegations = state.getDelegations();
    const dynamicDelegations = delegations.filter((d) => d.title.startsWith("Dynamic"));
    expect(dynamicDelegations.length).toBeLessThanOrEqual(5);
  });
});
