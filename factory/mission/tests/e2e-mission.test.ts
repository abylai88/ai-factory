import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { createReadOnlyPlanner, ReadOnlyPlanner } from "../planner.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
  ReadOnlyFactoryAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import {
  MissionProjectManager,
  MissionAwareFactoryAdapter,
  InnerFactoryAdapter,
} from "../mission-project-manager.js";
import { ProjectProvisioner } from "../project-provisioner.js";

let tmpDir: string;
let templatesDir: string;
let projectsDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-mission-test-"));
  templatesDir = path.join(tmpDir, "templates");
  projectsDir = path.join(tmpDir, "projects");
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.mkdir(projectsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function createFakeTemplate(id: string): Promise<void> {
  const dir = path.join(templatesDir, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), '{"name":"test"}');
  await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "configs"), { recursive: true });
}

function makeProvisioner(allowedIds: string[] = ["test-template"]): ProjectProvisioner {
  return new ProjectProvisioner({
    baseDir: tmpDir,
    templatesDir,
    projectsDir,
    allowedTemplateIds: allowedIds,
  });
}

function makeReadOnlyMission(goal: string, projectId?: string): Mission {
  return createMission(goal, {
    projectId: projectId ?? "test-project",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "test-template",
    workspace: path.join(tmpDir, "projects", projectId ?? "test-project"),
  });
}

class MockReadOnlyAdapter implements FactoryExecutionAdapter {
  public executedDelegations: string[] = [];
  private missionState: MissionState;
  private outputFn: (delegation: Delegation) => string;

  constructor(
    missionState: MissionState,
    outputFn?: (delegation: Delegation) => string
  ) {
    this.missionState = missionState;
    this.outputFn = outputFn ?? this.defaultOutput;
  }

  private defaultOutput(delegation: Delegation): string {
    return `Investigation complete. Project structure analyzed:
src/scenes/BootScene.ts handles asset preloading.
src/scenes/GameScene.ts manages gameplay with Arcade Physics.
src/scenes/MenuScene.ts provides the main menu UI.
src/main.ts is the entry point initializing Phaser config.
Architecture documented with scene-based design pattern.
Key components identified: BootScene, GameScene, MenuScene, Player, ObstacleManager.
No files modified during this investigation.`;
  }

  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    this.executedDelegations.push(delegation.id);

    const output = this.outputFn(delegation);
    await this.missionState.completeDelegation(
      delegation.id,
      "passed",
      output
    );

    return {
      delegationId: delegation.id,
      status: "passed",
      output,
      durationMs: 10,
      readOnly: true,
    };
  }
}

class FailingReadOnlyAdapter implements FactoryExecutionAdapter {
  private missionState: MissionState;

  constructor(missionState: MissionState) {
    this.missionState = missionState;
  }

  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    const error = "Simulated read-only agent failure";
    await this.missionState.completeDelegation(
      delegation.id,
      "failed",
      "",
      error
    );

    return {
      delegationId: delegation.id,
      status: "failed",
      output: "",
      error,
      durationMs: 10,
      readOnly: true,
    };
  }
}

// ─── Full State Machine: create → plan → approve → execute → audit → complete ───

describe("E2E mission state machine", () => {
  it("executes complete lifecycle: create → plan → approve → execute → audit → complete", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-lifecycle");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project and report its architecture",
      "e2e-lifecycle"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    expect(state.getMission().status).toBe("draft");

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);
    expect(state.getMission().status).toBe("planned");

    await state.approveMission();
    expect(state.getMission().status).toBe("approved");

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new MockReadOnlyAdapter(state);
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-lifecycle"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    expect(adapter.executedDelegations.length).toBe(1);

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain(MissionEventTypes.DELEGATION_STARTED);
    expect(eventTypes).toContain(MissionEventTypes.DELEGATION_COMPLETED);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDITING);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDIT_PASSED);

    const finalState = new MissionState(tmpDir, mission.id);
    await finalState.init();
    expect(finalState.getMission().status).toBe("completed");
  });
});

// ─── Failure Scenario ───

describe("E2E mission failure", () => {
  it("handles execution failure: execute → failure → mission failed", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-failure");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-failure"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new FailingReadOnlyAdapter(state);
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-failure"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("failed");

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDIT_FAILED);

    const finalState = new MissionState(tmpDir, mission.id);
    await finalState.init();
    expect(finalState.getMission().status).toBe("failed");
  });
});

// ─── Execution Result Stored ───

describe("E2E execution result storage", () => {
  it("stores execution result in delegation", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-result");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-result"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const testOutput = "Architecture analyzed: 5 modules, 3 scenes, Phaser 3 framework";
    const adapter = new MockReadOnlyAdapter(state, () => testOutput);

    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-result"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const delegations = state.getDelegations();
    expect(delegations.length).toBeGreaterThanOrEqual(1);
    const mainDelegation = delegations.find(d => d.id === plan.delegations[0].id);
    expect(mainDelegation).toBeDefined();
    expect(mainDelegation!.result).toBe(testOutput);
    expect(mainDelegation!.status).toBe("passed");
  });
});

// ─── Audit Result Stored ───

describe("E2E audit result storage", () => {
  it("stores audit result for each delegation", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-audit");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-audit"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new MockReadOnlyAdapter(state);
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-audit"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const delegations = state.getDelegations();
    for (const del of delegations) {
      const auditResult = state.getAuditResult(del.id);
      expect(auditResult).toBeDefined();
      expect(auditResult!.status).toBe("PASS");
      expect(auditResult!.summary).toContain("passed");
    }
  });
});

// ─── Max Repair Bound ───

describe("E2E max repair bound", () => {
  it("enforces maximum repair iterations", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-repair");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-repair"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new FailingReadOnlyAdapter(state);
    const eventSink = new InMemoryEventSink();

    const maxRepairs = 2;
    const orchestrator = new MissionOrchestrator({
      maxRepairs,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-repair"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("failed");

    const repairEvents = eventSink
      .recent()
      .filter((e) => e.type === MissionEventTypes.MISSION_REPAIRING);
    expect(repairEvents.length).toBeLessThanOrEqual(maxRepairs);
  });
});

// ─── Persistence Across Reload ───

describe("E2E persistence", () => {
  it("persists mission state across reload", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-persist");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-persist"
    );

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
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
    expect(state2.getDelegation(plan.delegations[0].id)?.status).toBe(
      "running"
    );
  });

  it("persists audit results across reload", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-audit-persist");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-audit-persist"
    );

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state1.setPlan(plan);

    for (const del of plan.delegations) {
      await state1.addDelegation(del);
    }

    const adapter = new MockReadOnlyAdapter(state1);
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-audit-persist"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state1,
    });

    await orchestrator.executeMission(mission, plan);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    expect(state2.getMission().status).toBe("completed");
    const delegations = state2.getDelegations();
    for (const del of delegations) {
      const auditResult = state2.getAuditResult(del.id);
      expect(auditResult).toBeDefined();
      expect(auditResult!.status).toBe("PASS");
    }
  });
});

// ─── Event Emission ───

describe("E2E event emission", () => {
  it("emits all required mission events", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    await provisioner.provision("test-template", "e2e-events");

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "e2e-events"
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);
    await state.setPlan(plan);

    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const adapter = new MockReadOnlyAdapter(state);
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(projectsDir, "e2e-events"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);

    const requiredEvents = [
      MissionEventTypes.DELEGATION_STARTED,
      MissionEventTypes.DELEGATION_COMPLETED,
      MissionEventTypes.MISSION_AUDITING,
      MissionEventTypes.MISSION_AUDIT_PASSED,
    ];

    for (const eventType of requiredEvents) {
      expect(eventTypes).toContain(eventType);
    }
  });
});

// ─── ReadOnlyPlanner ───

describe("ReadOnlyPlanner", () => {
  it("creates a single delegation for read-only mission", () => {
    const mission = makeReadOnlyMission(
      "Inspect the project architecture"
    );
    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);

    expect(plan.delegations.length).toBe(1);
    expect(plan.objectives.length).toBe(1);
    expect(plan.risks.length).toBe(1);
    expect(plan.validationGates.length).toBe(1);
  });

  it("sets read-only acceptance criteria", () => {
    const mission = makeReadOnlyMission(
      "Inspect the project architecture"
    );
    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);

    const delegation = plan.delegations[0];
    expect(delegation.acceptanceCriteria).toContain(
      "No files modified"
    );
    expect(delegation.acceptanceCriteria).toContain(
      "Codebase analyzed"
    );
  });

  it("respects maxDelegations config", () => {
    const mission = makeReadOnlyMission(
      "Inspect the project architecture"
    );
    const planner = createReadOnlyPlanner({ maxDelegations: 1 });
    const plan = planner.decompose(mission);

    expect(plan.delegations.length).toBeLessThanOrEqual(1);
  });
});

// ─── ReadOnlyFactoryAdapter Interface ───

describe("ReadOnlyFactoryAdapter", () => {
  it("implements FactoryExecutionAdapter interface", () => {
    const adapter = new ReadOnlyFactoryAdapter();
    expect(typeof adapter.runDelegation).toBe("function");
  });

  it("accepts custom config", () => {
    const adapter = new ReadOnlyFactoryAdapter({
      agent: "architect",
      timeoutMs: 60_000,
    });
    expect(adapter).toBeDefined();
  });
});

// ─── MissionAwareFactoryAdapter with ReadOnly ───

describe("MissionAwareFactoryAdapter with read-only", () => {
  it("resolves project and delegates to read-only adapter", async () => {
    await createFakeTemplate("test-template");
    const provisioner = makeProvisioner();
    const handle = await provisioner.provision(
      "test-template",
      "aware-readonly"
    );

    const manager = new MissionProjectManager({
      baseDir: tmpDir,
      provisioner,
    });
    const mission = makeReadOnlyMission(
      "Inspect the project",
      "aware-readonly"
    );

    let receivedProject = "";
    const mockInner: InnerFactoryAdapter = {
      async runDelegation(_d, _m, config) {
        receivedProject = config.project;
        return {
          delegationId: _d.id,
          status: "passed",
          output: "read-only output",
          durationMs: 0,
        };
      },
    };

    const adapter = new MissionAwareFactoryAdapter(
      { baseDir: tmpDir, projectManager: manager },
      mockInner
    );

    const delegation = {
      id: "del-1",
      missionId: mission.id,
      objectiveId: "obj-1",
      title: "Test",
      description: "desc",
      pipelineType: "engineering" as const,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [],
      status: "queued" as const,
      createdAt: new Date().toISOString(),
    };

    const result = await adapter.runDelegation(delegation, mission, {
      baseDir: tmpDir,
      project: "unused",
    });

    expect(result.status).toBe("passed");
    expect(receivedProject).toBe(handle.projectPath);
  });
});
