import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  createAuditResult,
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
  VisualQaResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { createPlanner, createReadOnlyPlanner } from "../planner.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
} from "../orchestrator.js";
import { CodingMissionAuditor } from "../adapters.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import type { VisualQaAdapter } from "../visual-qa-adapter.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "visual-qa-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMission(goal = "Fix the Traffic Dodge package name"): Mission {
  return createMission(goal, {
    projectId: "traffic-dodge",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "yagames-phaser-template",
    workspace: path.join(tmpDir, "projects", "traffic-dodge"),
  });
}

function makePlan(mission: Mission): ExecutionPlan {
  const planner = createPlanner();
  return planner.decompose(mission);
}

// ─── Fake VisualQaAdapter ────────────────────────────────────────────

class FakePassingVisualQaAdapter implements VisualQaAdapter {
  public runCount = 0;
  public lastOptions?: { projectId: string; projectPath: string; runId: string };

  async run(options: { projectId: string; projectPath: string; runId: string }): Promise<VisualQaResult> {
    this.runCount++;
    this.lastOptions = options;
    const now = new Date().toISOString();
    return {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      checkDetails: [
        { name: "page-loads", viewport: "1280x720", status: "passed" },
        { name: "canvas-exists", viewport: "1280x720", status: "passed" },
      ],
      errors: [],
      artifacts: [
        { id: "art_fake123", type: "screenshot", label: "1280x720/menu" },
      ],
      runId: "run-fake",
      startedAt: now,
      finishedAt: now,
    };
  }
}

class FakeFailingVisualQaAdapter implements VisualQaAdapter {
  public runCount = 0;

  async run(_options: { projectId: string; projectPath: string; runId: string }): Promise<VisualQaResult> {
    this.runCount++;
    const now = new Date().toISOString();
    return {
      status: "failed",
      passed: false,
      checks: 11,
      failedChecks: 3,
      checkDetails: [
        { name: "page-loads", viewport: "1280x720", status: "passed" },
        { name: "canvas-exists", viewport: "1280x720", status: "failed", message: "Canvas not found" },
        { name: "canvas-visible", viewport: "1280x720", status: "failed", message: "Canvas not visible" },
        { name: "no-page-errors", viewport: "1280x720", status: "failed", message: "Page error detected" },
      ],
      errors: ["page: Canvas not found"],
      artifacts: [
        { id: "art_fail123", type: "screenshot", label: "1280x720/failure" },
      ],
      runId: "run-fake-fail",
      startedAt: now,
      finishedAt: now,
    };
  }
}

// ─── Fake Factory Adapter (with build support) ────────────────────────

class FakeBuildAdapterFactory implements FactoryExecutionAdapter {
  public executedDelegations: string[] = [];
  private missionState: MissionState;
  private failBuild: boolean;

  constructor(missionState: MissionState, failBuild = false) {
    this.missionState = missionState;
    this.failBuild = failBuild;
  }

  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    this.executedDelegations.push(delegation.id);
    const isBuilder = delegation.description.includes("ROLE: builder") || delegation.description.includes("BUILD_COMMAND:");
    const isRead = delegation.description.includes("OPERATION: read");
    const isReplace = delegation.description.includes("OPERATION: replace");

    if (isBuilder && this.failBuild) {
      const output = JSON.stringify({ status: "failure", exitCode: 1, command: "npm run build:prod" });
      await this.missionState.completeDelegation(delegation.id, "failed", output, "Build failed with exit code 1");
      return {
        delegationId: delegation.id,
        status: "failed",
        output,
        error: "Build failed with exit code 1",
        durationMs: 10,
      };
    }

    let output: string;
    if (isBuilder) {
      output = JSON.stringify({ status: "success", exitCode: 0, command: "npm run build:prod", durationMs: 100 });
    } else if (isRead) {
      output = JSON.stringify({
        projectId: "traffic-dodge",
        file: "package.json",
        operation: "read",
        beforeContent: '{"name":"neon-breaker","version":"1.0.0"}',
        afterContent: '{"name":"neon-breaker","version":"1.0.0"}',
      });
    } else if (isReplace) {
      output = JSON.stringify({
        projectId: "traffic-dodge",
        file: "package.json",
        operation: "replace",
        beforeContent: '{"name":"neon-breaker","version":"1.0.0"}',
        afterContent: '{"name":"traffic-dodge","version":"1.0.0"}',
        fieldChanged: "name",
        oldValue: "neon-breaker",
        newValue: "traffic-dodge",
      });
    } else {
      const keywords = delegation.acceptanceCriteria
        .flatMap((c) => c.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
      output = `Completed successfully. ${keywords.join(" ")} verified and confirmed.`;
    }

    await this.missionState.completeDelegation(delegation.id, "passed", output);
    return {
      delegationId: delegation.id,
      status: "passed",
      output,
      durationMs: 10,
    };
  }
}

// ─── 1. Build success → Visual QA runs ───────────────────────────────

describe("build success → Visual QA runs", () => {
  it("runs Visual QA after successful build when requiresVisualQa is true", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    // Ensure requiresVisualQa is set
    expect(mission.context?.requiresVisualQa).toBe(true);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
    expect(qaAdapter.runCount).toBe(1);
  });
});

// ─── 2. Build failure → Visual QA skipped ────────────────────────────

describe("build failure → Visual QA skipped", () => {
  it("skips Visual QA when build fails", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);
    mission.context!.requiresVisualQa = true;

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state, true);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("failed");
    expect(qaAdapter.runCount).toBe(0);
  });
});

// ─── 3. Visual QA success → recorded ─────────────────────────────────

describe("Visual QA success → recorded", () => {
  it("records passing QA result in mission state", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    const qaResult = state.getVisualQaResult();
    expect(qaResult).toBeDefined();
    expect(qaResult!.status).toBe("passed");
    expect(qaResult!.passed).toBe(true);
    expect(qaResult!.checks).toBe(11);
    expect(qaResult!.failedChecks).toBe(0);
  });
});

// ─── 4. Visual QA failure → recorded ─────────────────────────────────

describe("Visual QA failure → recorded", () => {
  it("records failing QA result in mission state", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakeFailingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    const qaResult = state.getVisualQaResult();
    expect(qaResult).toBeDefined();
    expect(qaResult!.status).toBe("failed");
    expect(qaResult!.passed).toBe(false);
    expect(qaResult!.failedChecks).toBe(3);
  });
});

// ─── 5. QA events emitted ────────────────────────────────────────────

describe("QA events emitted", () => {
  it("emits visual_qa.started and visual_qa.completed events on pass", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);

    expect(eventTypes).toContain(MissionEventTypes.MISSION_VISUAL_QA_STARTED);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_VISUAL_QA_COMPLETED);
    expect(eventTypes).not.toContain(MissionEventTypes.MISSION_VISUAL_QA_FAILED);
    expect(eventTypes).not.toContain(MissionEventTypes.MISSION_VISUAL_QA_SKIPPED);
  });

  it("emits visual_qa.skipped when no adapter configured", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    // No visualQaAdapter
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_VISUAL_QA_SKIPPED);
  });

  it("emits visual_qa.failed on QA failure", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakeFailingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent();
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_VISUAL_QA_STARTED);
    expect(eventTypes).toContain(MissionEventTypes.MISSION_VISUAL_QA_FAILED);
  });

  it("all QA events include missionId", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    const qaEvents = eventSink.recent().filter(
      (e) => e.type.startsWith("mission.visual_qa.")
    );
    for (const evt of qaEvents) {
      expect(evt.missionId).toBe(mission.id);
    }
  });
});

// ─── 6. QA artifacts recorded ────────────────────────────────────────

describe("QA artifacts recorded", () => {
  it("stores artifact references in QA result", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    const qaResult = state.getVisualQaResult();
    expect(qaResult).toBeDefined();
    expect(qaResult!.artifacts.length).toBe(1);
    expect(qaResult!.artifacts[0].id).toBe("art_fake123");
    expect(qaResult!.artifacts[0].type).toBe("screenshot");
    expect(qaResult!.artifacts[0].label).toBe("1280x720/menu");
  });
});

// ─── 7. Raw screenshots not stored in Mission state ──────────────────

describe("raw screenshots not stored in Mission state", () => {
  it("stores only artifact references, not binary data", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);

    // Read the snapshot file and verify no binary data
    const snapshotPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.state.json`);
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    const qa = snapshot.mission.visualQa;
    expect(qa).toBeDefined();
    expect(qa.artifacts).toBeDefined();
    for (const artifact of qa.artifacts) {
      expect(typeof artifact.id).toBe("string");
      expect(typeof artifact.type).toBe("string");
      expect(typeof artifact.label).toBe("string");
      // No buffer/base64 data
      expect(artifact).not.toHaveProperty("data");
      expect(artifact).not.toHaveProperty("buffer");
      expect(artifact).not.toHaveProperty("content");
    }
  });
});

// ─── 8. Auditor PASS requires successful QA ──────────────────────────

describe("Auditor PASS requires successful QA", () => {
  it("CodingMissionAuditor passes when Visual QA passed", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("PASS");
  });

  it("CodingMissionAuditor fails when Visual QA failed", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "failed",
      passed: false,
      checks: 11,
      failedChecks: 3,
      errors: ["page: Canvas not found"],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
  });
});

// ─── 9. Auditor handling of QA scenarios ──────────────────────────────

describe("Auditor handling of QA scenarios", () => {
  it("fails when Visual QA was skipped (no adapter configured)", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "skipped",
      passed: false,
      checks: 0,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
  });

  it("fails when Visual QA result not available", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    // No visualQa set

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
  });
});

// ─── 10. Read-only research mission does not run QA ──────────────────

describe("read-only research mission does not run QA", () => {
  it("does not set requiresVisualQa for read-only missions", () => {
    const mission = createMission("Inspect the project architecture", {
      projectId: "test-project",
      engine: "web",
      workspace: path.join(tmpDir, "projects", "test"),
    });
    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);

    // Read-only planner should not set requiresVisualQa
    expect(mission.context?.requiresVisualQa).toBeFalsy();
    expect(plan.delegations.length).toBe(1);
  });

  it("does not run QA for read-only missions even if adapter present", async () => {
    const mission = createMission("Inspect the project architecture", {
      projectId: "test-project",
      engine: "web",
      workspace: path.join(tmpDir, "projects", "test"),
    });
    const planner = createReadOnlyPlanner();
    const plan = planner.decompose(mission);

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter: FactoryExecutionAdapter = {
      async runDelegation(delegation) {
        const output = "Architecture documented. Codebase analyzed: src/main.ts. Key components identified.";
        await state.completeDelegation(delegation.id, "passed", output);
        return { delegationId: delegation.id, status: "passed", output, durationMs: 10, readOnly: true };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);
    expect(qaAdapter.runCount).toBe(0);
  });
});

// ─── 11. Fake VisualQaAdapter unit tests ─────────────────────────────

describe("fake VisualQaAdapter unit tests", () => {
  it("FakePassingVisualQaAdapter returns passing result", async () => {
    const adapter = new FakePassingVisualQaAdapter();
    const result = await adapter.run({ projectId: "test", projectPath: "/tmp", runId: "run-1" });
    expect(result.status).toBe("passed");
    expect(result.passed).toBe(true);
    expect(result.checks).toBe(11);
    expect(result.failedChecks).toBe(0);
    expect(result.artifacts.length).toBe(1);
    expect(adapter.runCount).toBe(1);
  });

  it("FakeFailingVisualQaAdapter returns failing result", async () => {
    const adapter = new FakeFailingVisualQaAdapter();
    const result = await adapter.run({ projectId: "test", projectPath: "/tmp", runId: "run-1" });
    expect(result.status).toBe("failed");
    expect(result.passed).toBe(false);
    expect(result.failedChecks).toBe(3);
    expect(result.errors.length).toBe(1);
    expect(adapter.runCount).toBe(1);
  });
});

// ─── 12. Mission state persistence includes QA summary ───────────────

describe("Mission state persistence includes QA summary", () => {
  it("persists QA result across state reload", async () => {
    const mission = makeMission();
    mission.context!.requiresVisualQa = true;

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      errors: [],
      artifacts: [{ id: "art_abc123", type: "screenshot", label: "1280x720/menu" }],
      runId: "run-test",
      startedAt: now,
      finishedAt: now,
    };

    await state1.recordVisualQaResult(qaResult);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const stored = state2.getVisualQaResult();
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("passed");
    expect(stored!.passed).toBe(true);
    expect(stored!.checks).toBe(11);
    expect(stored!.artifacts.length).toBe(1);
    expect(stored!.artifacts[0].id).toBe("art_abc123");
  });

  it("persists failed QA result across state reload", async () => {
    const mission = makeMission();
    mission.context!.requiresVisualQa = true;

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "failed",
      passed: false,
      checks: 11,
      failedChecks: 3,
      errors: ["page: error"],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };

    await state1.recordVisualQaResult(qaResult);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const stored = state2.getVisualQaResult();
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("failed");
    expect(stored!.failedChecks).toBe(3);
  });

  it("persists skipped QA result across state reload", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "skipped",
      passed: false,
      checks: 0,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };

    await state1.recordVisualQaResult(qaResult);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const stored = state2.getVisualQaResult();
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("skipped");
  });
});

// ─── QA not required for coding mission without context flag ──────────

describe("QA not required when requiresVisualQa is false", () => {
  it("does not run QA when mission context does not have requiresVisualQa", async () => {
    const projectDir = path.join(tmpDir, "projects", "traffic-dodge");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "package.json"),
      JSON.stringify({ name: "neon-breaker", scripts: { "build:prod": "echo build-ok" } }, null, 2)
    );

    const mission = makeMission();
    // Manually remove requiresVisualQa if planner set it
    if (mission.context) {
      mission.context.requiresVisualQa = false;
    }

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    // Override if planner set it
    if (mission.context) {
      mission.context.requiresVisualQa = false;
    }

    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    const qaAdapter = new FakePassingVisualQaAdapter();
    const factoryAdapter = new FakeBuildAdapterFactory(state);
    const auditor = new CodingMissionAuditor();
    const eventSink = new InMemoryEventSink();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
    });

    await orchestrator.executeMission(mission, plan);
    expect(qaAdapter.runCount).toBe(0);
  });
});
