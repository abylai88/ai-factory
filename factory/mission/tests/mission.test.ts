import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createExecutionPlan,
  createDelegation,
  createAuditResult,
  createRepairPlan,
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
  AuditResult,
  MissionEventSink,
} from "../mission.js";
import { MissionState } from "../state.js";
import { Planner, createPlanner } from "../planner.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink, NoopEventSink, MissionEventTypes } from "../events.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMission(goal = "Build a simple game"): Mission {
  return createMission(goal, {
    projectId: "test-project",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "yagames-phaser-template",
    workspace: path.join(tmpDir, "projects", "test"),
  });
}

function makePlan(mission: Mission): ExecutionPlan {
  const planner = createPlanner();
  return planner.decompose(mission);
}

class MockFactoryAdapter implements FactoryExecutionAdapter {
  public executedDelegations: string[] = [];
  private failIds: Set<string>;
  private missionState: MissionState;

  constructor(missionState: MissionState, failIds: string[] = []) {
    this.missionState = missionState;
    this.failIds = new Set(failIds);
  }

  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    this.executedDelegations.push(delegation.id);

    if (this.failIds.has(delegation.id)) {
      await this.missionState.completeDelegation(delegation.id, "failed", "", `Simulated failure for ${delegation.id}`);
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: `Simulated failure for ${delegation.id}`,
        durationMs: 10,
      };
    }

    const keywords = delegation.acceptanceCriteria
      .flatMap((c) => c.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
    const output = `Completed successfully. ${keywords.join(" ")} verified and confirmed.`;

    await this.missionState.completeDelegation(delegation.id, "passed", output);

    return {
      delegationId: delegation.id,
      status: "passed",
      output,
      durationMs: 10,
    };
  }
}

// ─── Mission creation ────────────────────────────────────────────────

describe("mission creation", () => {
  it("creates a mission with correct defaults", () => {
    const mission = makeMission();
    expect(mission.id).toMatch(/^mission-/);
    expect(mission.goal).toBe("Build a simple game");
    expect(mission.status).toBe("draft");
    expect(mission.currentDelegationIndex).toBe(0);
    expect(mission.createdAt).toBeTruthy();
    expect(mission.updatedAt).toBeTruthy();
  });

  it("creates a mission with context and constraints", () => {
    const mission = createMission("Test", { engine: "web" }, { maxRepairs: 5, maxDelegations: 20, allowedPipelines: ["game", "engineering"], requireApproval: false });
    expect(mission.context?.engine).toBe("web");
    expect(mission.constraints?.maxRepairs).toBe(5);
  });

  it("rejects empty goal", () => {
    expect(() => createMission("")).toThrow();
  });
});

// ─── Planning ────────────────────────────────────────────────────────

describe("planning", () => {
  it("decomposes a mission into an execution plan", () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    expect(plan.id).toMatch(/^plan-/);
    expect(plan.missionId).toBe(mission.id);
    expect(plan.objectives.length).toBeGreaterThan(0);
    expect(plan.delegations.length).toBeGreaterThan(0);
    expect(plan.risks.length).toBeGreaterThan(0);
    expect(plan.validationGates.length).toBeGreaterThan(0);
  });

  it("assigns correct objective IDs", () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    for (const obj of plan.objectives) {
      expect(obj.id).toMatch(/^obj-\d+$/);
    }
  });

  it("creates delegations with proper dependencies", () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    expect(plan.delegations[0].dependsOn).toEqual([]);
    for (let i = 1; i < plan.delegations.length; i++) {
      expect(plan.delegations[i].dependsOn.length).toBeGreaterThan(0);
    }
  });

  it("creates validation gates for each delegation", () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    for (const del of plan.delegations) {
      const gate = plan.validationGates.find((g) => g.delegationId === del.id);
      expect(gate).toBeDefined();
      expect(gate!.criteria.length).toBeGreaterThan(0);
    }
  });

  it("classifies engineering goals correctly", () => {
    const mission = makeMission("Fix TypeScript errors in the build");
    const plan = makePlan(mission);
    expect(plan.delegations.length).toBeGreaterThan(0);
  });
});

// ─── Approval ────────────────────────────────────────────────────────

describe("approval", () => {
  it("transitions mission through approved status", async () => {
    const state = new MissionState(tmpDir, "test-mission");
    await state.init();

    const mission = makeMission();
    await state.setMission(mission);
    expect(state.getMission().status).toBe("draft");

    await state.approveMission();
    expect(state.getMission().status).toBe("approved");
  });
});

// ─── Delegation ordering ─────────────────────────────────────────────

describe("delegation ordering", () => {
  it("respects dependency order in topological sort", () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    const executedOrder: string[] = [];
    const indexMap = new Map(plan.delegations.map((d, i) => [d.id, i]));

    for (const del of plan.delegations) {
      for (const depId of del.dependsOn) {
        const depIdx = indexMap.get(depId)!;
        const delIdx = indexMap.get(del.id)!;
        expect(depIdx).toBeLessThan(delIdx);
      }
    }
  });

  it("allows parallelizable delegations", () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    const parallelizable = plan.delegations.filter((d) => d.parallelizable);
    expect(parallelizable.length).toBeGreaterThan(0);
  });
});

// ─── Successful execution ────────────────────────────────────────────

describe("successful execution", () => {
  it("executes all delegations and completes mission", async () => {
    const mission = makeMission();
    const plan = makePlan(mission);
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }
    const adapter = new MockFactoryAdapter(state);
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
    expect(adapter.executedDelegations.length).toBeGreaterThan(0);

    const events = eventSink.recent();
    expect(events.some((e) => e.type === MissionEventTypes.DELEGATION_STARTED)).toBe(true);
    expect(events.some((e) => e.type === MissionEventTypes.DELEGATION_COMPLETED)).toBe(true);
  });
});

// ─── Auditor PASS ────────────────────────────────────────────────────

describe("auditor PASS", () => {
  it("passes delegation with all acceptance criteria met", async () => {
    const auditor = new DeterministicAuditor();
    const delegation = createDelegation("m1", "obj1", "Test Step", "desc", "game", {
      acceptanceCriteria: ["Build succeeds", "TypeScript passes"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: "Build succeeds and TypeScript passes with no errors",
      durationMs: 100,
    };
    const mission = makeMission();
    const plan = makePlan(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("PASS");
    expect(audit.acceptanceCriteriaResults.every((r) => r.passed)).toBe(true);
  });
});

// ─── Auditor FAIL ────────────────────────────────────────────────────

describe("auditor FAIL", () => {
  it("fails delegation when execution fails", async () => {
    const auditor = new DeterministicAuditor();
    const delegation = createDelegation("m1", "obj1", "Test Step", "desc", "game", {
      acceptanceCriteria: ["Build succeeds"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "failed",
      output: "",
      error: "Build failed",
      durationMs: 100,
    };
    const mission = makeMission();
    const plan = makePlan(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
    expect(audit.findings.length).toBeGreaterThan(0);
    expect(audit.recommendedRepair).toBeDefined();
  });

  it("fails when acceptance criteria not met", async () => {
    const auditor = new DeterministicAuditor();
    const delegation = createDelegation("m1", "obj1", "Test Step", "desc", "game", {
      acceptanceCriteria: ["Market analysis complete", "Competitor list finalized"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: "Nothing relevant to the criteria here at all",
      durationMs: 100,
    };
    const mission = makeMission();
    const plan = makePlan(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
  });
});

// ─── Bounded repair ──────────────────────────────────────────────────

describe("bounded repair", () => {
  it("attempts repair after audit failure", async () => {
    let callCount = 0;
    const mission = makeMission();
    const plan = makePlan(mission);
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(delegation) {
        callCount++;
        if (callCount <= 1) {
          await state.completeDelegation(delegation.id, "failed", "", "First attempt failed");
          return {
            delegationId: delegation.id,
            status: "failed",
            output: "",
            error: "First attempt failed",
            durationMs: 10,
          };
        }
        const keywords = delegation.acceptanceCriteria
          .flatMap((c) => c.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
        const output = `Repaired successfully. ${keywords.join(" ")} verified.`;
        await state.completeDelegation(delegation.id, "passed", output);
        return {
          delegationId: delegation.id,
          status: "passed",
          output,
          durationMs: 10,
        };
      },
    };

    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
    expect(callCount).toBeGreaterThan(1);
  });
});

// ─── Fresh audit after repair ────────────────────────────────────────

describe("fresh audit after repair", () => {
  it("re-audits after successful repair", async () => {
    const auditor = new DeterministicAuditor();
    const delegation = createDelegation("m1", "obj1", "Test", "desc", "game", {
      acceptanceCriteria: ["Test passes"],
    });

    const failResult: AgentResult = {
      delegationId: delegation.id,
      status: "failed",
      output: "",
      error: "test failed",
      durationMs: 10,
    };
    const passResult: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: "Test passes with all checks",
      durationMs: 10,
    };
    const mission = makeMission();
    const plan = makePlan(mission);

    const audit1 = await auditor.audit(delegation, failResult, mission, plan);
    expect(audit1.status).toBe("FAIL");

    const audit2 = await auditor.audit(delegation, passResult, mission, plan);
    expect(audit2.status).toBe("PASS");
  });
});

// ─── Max repair limit ────────────────────────────────────────────────

describe("max repair limit", () => {
  it("stops repairing after max iterations", async () => {
    const mission = makeMission();
    const plan = makePlan(mission);
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(delegation) {
        await state.completeDelegation(delegation.id, "failed", "", "Always fails");
        return {
          delegationId: delegation.id,
          status: "failed",
          output: "",
          error: "Always fails",
          durationMs: 10,
        };
      },
    };

    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 2,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("failed");
  });
});

// ─── Persistence/reload ──────────────────────────────────────────────

describe("persistence/reload", () => {
  it("persists and reloads mission state", async () => {
    const mission = makeMission();
    const plan = makePlan(mission);

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);
    await state1.setPlan(plan);
    for (const del of plan.delegations) {
      await state1.addDelegation(del);
    }
    await state1.startMission();
    await state1.startDelegation(plan.delegations[0].id, "pipeline-1");

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    expect(state2.getMission().status).toBe("running");
    expect(state2.getDelegations().length).toBe(plan.delegations.length);
    expect(state2.getDelegation(plan.delegations[0].id)?.status).toBe("running");
  });

  it("persists audit results", async () => {
    const mission = makeMission();
    const plan = makePlan(mission);
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);

    const auditResult = createAuditResult("del-1", "PASS", "All good", ["ok"], []);
    await state.recordAuditPassed("del-1", auditResult);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const stored = state2.getAuditResult("del-1");
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("PASS");
  });
});

// ─── Corrupt state handling ──────────────────────────────────────────

describe("corrupt state handling", () => {
  it("handles corrupt snapshot gracefully", async () => {
    const missionsDir = path.join(tmpDir, "outputs", "missions");
    await fs.mkdir(missionsDir, { recursive: true });
    await fs.writeFile(path.join(missionsDir, "corrupt.state.json"), "not valid json!!!");

    const state = new MissionState(tmpDir, "corrupt");
    await state.init();

    expect(state.getMission()).toBeDefined();
    expect(state.getMission().status).toBe("draft");
  });

  it("handles corrupt jsonl gracefully", async () => {
    const missionsDir = path.join(tmpDir, "outputs", "missions");
    await fs.mkdir(missionsDir, { recursive: true });
    await fs.writeFile(path.join(missionsDir, "corrupt.jsonl"), "not valid json!!!\n");

    const state = new MissionState(tmpDir, "corrupt");
    await state.init();

    expect(state.getMission()).toBeDefined();
  });

  it("handles missing files gracefully", async () => {
    const state = new MissionState(tmpDir, "nonexistent");
    await state.init();

    expect(state.getMission()).toBeDefined();
    expect(state.getMission().status).toBe("draft");
  });
});

// ─── Event sink ──────────────────────────────────────────────────────

describe("event sink", () => {
  it("records events in memory", () => {
    const sink = new InMemoryEventSink();
    const evt = sink.publish({
      missionId: "m1",
      type: MissionEventTypes.MISSION_CREATED,
      payload: { goal: "test" },
    });

    expect(evt.id).toMatch(/^evt-/);
    expect(evt.occurredAt).toBeTruthy();
    expect(evt.missionId).toBe("m1");
    expect(sink.recent().length).toBe(1);
  });

  it("subscribes to events", () => {
    const sink = new InMemoryEventSink();
    const received: any[] = [];
    const unsub = sink.subscribe((e) => received.push(e));

    sink.publish({ missionId: "m1", type: MissionEventTypes.MISSION_STARTED, payload: {} });
    expect(received.length).toBe(1);

    unsub();
    sink.publish({ missionId: "m1", type: MissionEventTypes.MISSION_COMPLETED, payload: {} });
    expect(received.length).toBe(1);
  });

  it("noop sink discards events", () => {
    const sink = new NoopEventSink();
    const evt = sink.publish({
      missionId: "m1",
      type: MissionEventTypes.MISSION_CREATED,
      payload: {},
    });
    expect(evt.id).toBeTruthy();
  });

  it("caps events at 500", () => {
    const sink = new InMemoryEventSink();
    for (let i = 0; i < 600; i++) {
      sink.publish({ missionId: "m1", type: MissionEventTypes.MISSION_CREATED, payload: {} });
    }
    expect(sink.recent().length).toBe(500);
  });
});

// ─── Dry-run ─────────────────────────────────────────────────────────

describe("dry-run", () => {
  it("generates plan without executing", () => {
    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    expect(plan.delegations.length).toBeGreaterThan(0);
    expect(plan.objectives.length).toBeGreaterThan(0);
  });

  it("respects maxDelegations config", () => {
    const planner = createPlanner({ maxDelegations: 2 });
    const mission = makeMission();
    const plan = planner.decompose(mission);

    expect(plan.delegations.length).toBeLessThanOrEqual(2);
  });

  it("respects allowedPipelines config", () => {
    const planner = createPlanner({ allowedPipelines: ["engineering"] });
    const mission = makeMission("Fix a bug");
    const plan = planner.decompose(mission);

    expect(plan.delegations.length).toBeGreaterThan(0);
  });
});

// ─── Invalid mission ID ──────────────────────────────────────────────

describe("invalid mission ID", () => {
  it("sanitizes mission ID for filesystem", async () => {
    const state = new MissionState(tmpDir, "../../etc/passwd");
    await state.init();

    expect(state.getMission().id).not.toContain("..");
    expect(state.getMission().id).not.toContain("/");
  });

  it("handles long mission IDs", async () => {
    const longId = "a".repeat(200);
    const state = new MissionState(tmpDir, longId);
    await state.init();

    expect(state.getMission().id.length).toBeLessThanOrEqual(64);
  });

  it("handles special characters in mission ID", async () => {
    const state = new MissionState(tmpDir, "mission with spaces & symbols!");
    await state.init();

    expect(state.getMission().id).not.toContain(" ");
    expect(state.getMission().id).not.toContain("&");
  });
});
