import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDiagnosis,
  createDiagnosisRepairPlan,
  createDelegation,
  Mission,
  Delegation,
  AgentResult,
  ExecutionPlan,
  VisualQaResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
} from "../orchestrator.js";
import {
  DeterministicRepairExecutor,
} from "../repair-executor.js";
import { CodingMissionAuditor } from "../adapters.js";
import type { VisualQaAdapter } from "../visual-qa-adapter.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repair-executor-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMission(goal = "Fix the Traffic Dodge visual defect"): Mission {
  return createMission(goal, {
    projectId: "traffic-dodge",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "yagames-phaser-template",
    workspace: path.join(tmpDir, "projects", "traffic-dodge"),
    requiresVisualQa: true,
  });
}

function makeRepairPlan(missionId: string, projectId = "traffic-dodge") {
  return createDiagnosisRepairPlan(
    missionId,
    "diag-test123",
    "Fix visual defect",
    "medium",
    "high",
    [{ file: "src/main.ts", operation: "modify", reason: "test", expectedOutcome: "fix", scope: "project" }],
    { steps: ["build", "audit"], description: "Build and audit" },
    3,
    projectId
  );
}

function makeInvalidRepairPlan(missionId: string) {
  return createDiagnosisRepairPlan(
    missionId,
    "diag-test123",
    "Fix visual defect",
    "medium",
    "high",
    [{ file: "../factory/orchestrator.ts", operation: "modify", reason: "test", expectedOutcome: "fix", scope: "project" }],
    { steps: ["build", "audit"], description: "Build and audit" },
    3,
    "traffic-dodge"
  );
}

async function setupProject(projectId: string): Promise<string> {
  const projectPath = path.join(tmpDir, "projects", projectId);
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ name: projectId, scripts: { build: "echo ok" } })
  );
  await fs.writeFile(path.join(projectPath, "src", "main.ts"), "console.log('hello');");
  return projectPath;
}

class MockPassingAdapter implements FactoryExecutionAdapter {
  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    return {
      delegationId: delegation.id,
      status: "passed",
      output: '{"status":"success"}',
      durationMs: 10,
    };
  }
}

// ─── 1. valid RepairPlan executes ───────────────────────────────────

describe("1. valid RepairPlan executes", () => {
  it("executes a valid RepairPlan and returns completed status", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("completed");
    expect(result.actionsCompleted).toBe(1);
    expect(result.actionsFailed).toBe(0);
    expect(result.changedFiles).toContain("src/main.ts");
    expect(result.summary).toContain("1/1");
  });
});

// ─── 2. Invalid RepairPlan rejected ─────────────────────────────────

describe("2. invalid RepairPlan rejected", () => {
  it("rejects a RepairPlan with path traversal", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeInvalidRepairPlan(mission.id);
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.actionsCompleted).toBe(0);
    expect(result.summary).toContain("safety audit");
  });

  it("rejects empty RepairPlan", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions = [];
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.summary).toContain("empty");
  });
});

// ─── 3. Path traversal rejected ─────────────────────────────────────

describe("3. path traversal rejected", () => {
  it("rejects RepairPlan with ../ in file path", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions[0].file = "../etc/passwd";
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.summary).toContain("safety audit");
  });
});

// ─── 4. Protected path rejected ─────────────────────────────────────

describe("4. protected path rejected", () => {
  it("rejects RepairPlan targeting factory/**", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions[0].file = "factory/orchestrator.ts";
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.summary).toContain("safety audit");
  });

  it("rejects RepairPlan targeting agents/**", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions[0].file = "agents/test.md";
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
  });

  it("rejects RepairPlan targeting visual-office/**", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions[0].file = "visual-office/service.ts";
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
  });
});

// ─── 5. Wrong project rejected ──────────────────────────────────────

describe("5. wrong project rejected", () => {
  it("rejects RepairPlan with mismatched missionId", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan("wrong-mission-id");
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.summary).toContain("missionId does not match");
  });
});

// ─── 6. Symlink escape rejected ─────────────────────────────────────

describe("6. symlink escape rejected", () => {
  it("rejects RepairPlan with symlink in path", async () => {
    const projectPath = await setupProject("traffic-dodge");

    const secretDir = path.join(tmpDir, "secret");
    await fs.mkdir(secretDir);
    await fs.writeFile(path.join(secretDir, "data.txt"), "secret");
    await fs.symlink(secretDir, path.join(projectPath, "src", "link"));

    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions[0].file = "src/link/data.txt";
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.summary).toContain("Symlink escape");
  });
});

// ─── 7. Structured modification only ────────────────────────────────

describe("7. structured modification only", () => {
  it("only accepts structured RepairAction fields", () => {
    const repairPlan = makeRepairPlan("mission-test");
    expect(repairPlan.actions[0]).not.toHaveProperty("command");
    expect(repairPlan.actions[0]).not.toHaveProperty("executable");
    expect(repairPlan.actions[0]).not.toHaveProperty("argv");
    expect(repairPlan.actions[0]).not.toHaveProperty("cwd");
  });
});

// ─── 8. Arbitrary command rejected ──────────────────────────────────

describe("8. arbitrary command rejected", () => {
  it("rejects RepairPlan with absolute path", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    repairPlan.actions[0].file = "/etc/passwd";
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result.status).toBe("rejected");
    expect(result.summary).toContain("safety audit");
  });
});

// ─── 9. Repair result recorded ──────────────────────────────────────

describe("9. repair result recorded", () => {
  it("returns RepairExecutionResult with all fields", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const repairPlan = makeRepairPlan(mission.id);
    const executor = new DeterministicRepairExecutor();

    const result = await executor.execute(mission, repairPlan, projectPath);

    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("changedFiles");
    expect(result).toHaveProperty("actionsCompleted");
    expect(result).toHaveProperty("actionsFailed");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("startedAt");
    expect(result).toHaveProperty("finishedAt");
    expect(typeof result.startedAt).toBe("string");
    expect(typeof result.finishedAt).toBe("string");
  });
});

// ─── 10. Repair events emitted ──────────────────────────────────────

describe("10. repair events emitted", () => {
  it("emits mission.repair.started and mission.repair.completed events", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    await state.recordRepairStarted("rp-test", 1);
    await state.recordRepairCompleted("rp-test", 1, {
      status: "completed",
      changedFiles: ["src/main.ts"],
      actionsCompleted: 1,
      actionsFailed: 0,
    });

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const events = lines.map((l) => JSON.parse(l));

    expect(events.some((e: any) => e.type === "mission.repair.started")).toBe(true);
    expect(events.some((e: any) => e.type === "mission.repair.completed")).toBe(true);
  });

  it("emits mission.repair.failed event", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    await state.recordRepairStarted("rp-test", 1);
    await state.recordRepairFailed("rp-test", 1, "Repair failed");

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const events = lines.map((l) => JSON.parse(l));

    expect(events.some((e: any) => e.type === "mission.repair.failed")).toBe(true);
  });
});

// ─── 11. Build runs after repair ────────────────────────────────────

describe("11. build runs after repair", () => {
  it("creates a build delegation after repair execution", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const buildDelegation = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering"
    );
    await state.addDelegation(buildDelegation);

    const eventSink = new InMemoryEventSink();
    let buildExecuted = false;

    class MockBuildAdapter implements FactoryExecutionAdapter {
      async runDelegation(
        delegation: Delegation,
        _mission: Mission,
        _config: { baseDir: string; project: string; fromStep?: string }
      ): Promise<AgentResult> {
        if (delegation.description.includes("BUILD_COMMAND")) {
          buildExecuted = true;
        }
        return {
          delegationId: delegation.id,
          status: "passed",
          output: '{"status":"success"}',
          durationMs: 10,
        };
      }
    }

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: new MockBuildAdapter(),
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
    });

    await state.startDelegation(buildDelegation.id, "");
    const result = await orchestrator.executeDelegation(buildDelegation);

    expect(result.status).toBe("passed");
    expect(buildExecuted).toBe(true);
  });
});

// ─── 12. Visual QA runs after successful repair build ───────────────

describe("12. Visual QA runs after successful repair build", () => {
  it("runs Visual QA adapter after rebuild delegation succeeds", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    let qaRunCount = 0;
    const fakeQa: VisualQaAdapter = {
      async run() {
        qaRunCount++;
        const now = new Date().toISOString();
        return {
          status: "passed",
          passed: true,
          checks: 1,
          failedChecks: 0,
          errors: [],
          artifacts: [],
          startedAt: now,
          finishedAt: now,
        };
      },
    };

    const eventSink = new InMemoryEventSink();
    const executor = new DeterministicRepairExecutor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: new MockPassingAdapter(),
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
      visualQaAdapter: fakeQa,
      repairExecutor: executor,
    });

    const buildDel = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering"
    );
    await state.addDelegation(buildDel);
    await state.startDelegation(buildDel.id, "");
    await state.completeDelegation(buildDel.id, "passed", '{"status":"success"}');

    expect(fakeQa).toBeDefined();
  });
});

// ─── 13. Fresh diagnosis after failed repair ────────────────────────

describe("13. fresh diagnosis after failed repair", () => {
  it("creates a new diagnosis for each repair cycle", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const diag1 = createDiagnosis(mission.id, "traffic-dodge", "visual-regression", "medium", "high", "First", []);
    const plan1 = makeRepairPlan(mission.id);
    await state.recordDiagnosisCompleted(diag1, plan1);

    const diag2 = createDiagnosis(mission.id, "traffic-dodge", "runtime-error", "high", "high", "Second", []);
    const plan2 = makeRepairPlan(mission.id);
    await state.recordDiagnosisCompleted(diag2, plan2);

    const loadedDiag = state.getDiagnosis();
    expect(loadedDiag!.category).toBe("runtime-error");
    expect(loadedDiag!.summary).toBe("Second");
  });
});

// ─── 14. Fresh audit after repair ───────────────────────────────────

describe("14. fresh audit after repair", () => {
  it("produces a fresh audit result after repair execution", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation(
      "mission-1",
      "obj-1",
      "Build",
      "Build the project",
      "engineering",
      { acceptanceCriteria: ["Build succeeded"] }
    );

    const mission = makeMission();
    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [],
      delegations: [delegation],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: '{"status":"success","exitCode":0}',
      durationMs: 100,
    };

    const auditResult = await auditor.audit(delegation, result, mission, plan);

    expect(auditResult.status).toBe("PASS");
    expect(auditResult.summary).toContain("passed");
  });
});

// ─── 15. Repair cycle increments ────────────────────────────────────

describe("15. repair cycle increments", () => {
  it("increments repairCycleCount across cycles", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    expect(state.getRepairCycleCount()).toBe(0);

    await state.recordRepairStarted("rp-1", 1);
    expect(state.getRepairCycleCount()).toBe(1);

    await state.recordRepairCompleted("rp-1", 1, {
      status: "completed",
      changedFiles: [],
      actionsCompleted: 1,
      actionsFailed: 0,
    });
    expect(state.getRepairCycleCount()).toBe(1);

    await state.recordRepairStarted("rp-2", 2);
    expect(state.getRepairCycleCount()).toBe(2);
  });
});

// ─── 16. Maximum 3 cycles enforced ──────────────────────────────────

describe("16. maximum 3 cycles enforced", () => {
  it("self-healing loop stops after 3 failed cycles", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    let qaRunCount = 0;
    const failingQa: VisualQaAdapter = {
      async run() {
        qaRunCount++;
        const now = new Date().toISOString();
        return {
          status: "failed",
          passed: false,
          checks: 1,
          failedChecks: 1,
          checkDetails: [
            { name: "canvas-exists", viewport: "1280x720", status: "failed", message: "Canvas not found" },
          ],
          errors: ["Canvas not found"],
          artifacts: [],
          startedAt: now,
          finishedAt: now,
        };
      },
    };

    const eventSink = new InMemoryEventSink();
    const executor = new DeterministicRepairExecutor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: new MockPassingAdapter(),
      auditor: new CodingMissionAuditor(),
      eventSink,
      missionState: state,
      visualQaAdapter: failingQa,
      repairExecutor: executor,
    });

    const buildDel = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering",
      { acceptanceCriteria: ["Build succeeded"] }
    );
    await state.addDelegation(buildDel);

    const plan: ExecutionPlan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build project", delegations: [buildDel.id] }],
      delegations: [buildDel],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };
    await state.setPlan(plan);

    await state.startMission();
    const agentResult = await orchestrator.executeDelegation(buildDel);
    expect(agentResult.status).toBe("passed");

    // Run visual QA (which fails)
    await orchestrator["runVisualQa"](buildDel);
    const currentQa = state.getMission().visualQa;
    expect(currentQa?.status).toBe("failed");

    // Set isRunning so the selfHealingLoop can proceed
    (orchestrator as any).isRunning = true;

    const healed = await orchestrator["selfHealingLoop"](buildDel);
    expect(healed).toBe(false);

    const repairEvents = eventSink.recent().filter(
      (e) => e.type === MissionEventTypes.MISSION_REPAIR_STARTED
    );
    expect(repairEvents.length).toBe(3);
  });
});

// ─── 17. Mission completes after successful repair ──────────────────

describe("17. mission completes after successful repair", () => {
  it("returns true when repair + re-audit passes", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    let qaRunCount = 0;
    const eventuallyPassingQa: VisualQaAdapter = {
      async run() {
        qaRunCount++;
        const now = new Date().toISOString();
        if (qaRunCount <= 1) {
          return {
            status: "failed",
            passed: false,
            checks: 1,
            failedChecks: 1,
            checkDetails: [
              { name: "canvas-exists", viewport: "1280x720", status: "failed", message: "Canvas not found" },
            ],
            errors: ["Canvas not found"],
            artifacts: [],
            startedAt: now,
            finishedAt: now,
          };
        }
        return {
          status: "passed",
          passed: true,
          checks: 1,
          failedChecks: 0,
          errors: [],
          artifacts: [],
          startedAt: now,
          finishedAt: now,
        };
      },
    };

    const eventSink = new InMemoryEventSink();
    const executor = new DeterministicRepairExecutor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: new MockPassingAdapter(),
      auditor: new CodingMissionAuditor(),
      eventSink,
      missionState: state,
      visualQaAdapter: eventuallyPassingQa,
      repairExecutor: executor,
    });

    const buildDel = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering",
      { acceptanceCriteria: ["Build succeeded"] }
    );
    await state.addDelegation(buildDel);

    await state.startMission();
    const agentResult = await orchestrator.executeDelegation(buildDel);
    expect(agentResult.status).toBe("passed");

    await orchestrator["runVisualQa"](buildDel);
    const firstQa = state.getMission().visualQa;
    expect(firstQa?.status).toBe("failed");

    // Set isRunning so the selfHealingLoop can proceed
    (orchestrator as any).isRunning = true;

    const healed = await orchestrator["selfHealingLoop"](buildDel);
    expect(healed).toBe(true);
  });
});

// ─── 18. Mission fails after 3 unsuccessful repairs ────────────────

describe("18. mission fails after 3 unsuccessful repairs", () => {
  it("returns false when all 3 repair cycles fail", async () => {
    const projectPath = await setupProject("traffic-dodge");
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const alwaysFailingQa: VisualQaAdapter = {
      async run() {
        const now = new Date().toISOString();
        return {
          status: "failed",
          passed: false,
          checks: 1,
          failedChecks: 1,
          checkDetails: [
            { name: "canvas-exists", viewport: "1280x720", status: "failed", message: "Canvas not found" },
          ],
          errors: ["Canvas not found"],
          artifacts: [],
          startedAt: now,
          finishedAt: now,
        };
      },
    };

    const eventSink = new InMemoryEventSink();
    const executor = new DeterministicRepairExecutor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: new MockPassingAdapter(),
      auditor: new CodingMissionAuditor(),
      eventSink,
      missionState: state,
      visualQaAdapter: alwaysFailingQa,
      repairExecutor: executor,
    });

    const buildDel = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering",
      { acceptanceCriteria: ["Build succeeded"] }
    );
    await state.addDelegation(buildDel);

    await state.startMission();
    await orchestrator.executeDelegation(buildDel);

    // Set isRunning so the selfHealingLoop can proceed
    (orchestrator as any).isRunning = true;

    const healed = await orchestrator["selfHealingLoop"](buildDel);
    expect(healed).toBe(false);

    const repairEvents = eventSink.recent().filter(
      (e) => e.type === MissionEventTypes.MISSION_REPAIR_STARTED
    );
    expect(repairEvents.length).toBe(3);
  });
});

// ─── 19. Persistence survives reload ────────────────────────────────

describe("19. persistence survives reload", () => {
  it("persists repair cycle count across state reload", async () => {
    const mission = makeMission();
    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    await state1.recordRepairStarted("rp-1", 1);
    await state1.recordRepairCompleted("rp-1", 1, {
      status: "completed",
      changedFiles: ["src/main.ts"],
      actionsCompleted: 1,
      actionsFailed: 0,
    });

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    expect(state2.getRepairCycleCount()).toBe(1);
    const mission2 = state2.getMission();
    expect(mission2.repairCycleCount).toBe(1);
    expect((mission2 as any).repairExecutionResult).toBeDefined();
  });

  it("persists repair execution result across reload", async () => {
    const mission = makeMission();
    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    await state1.recordRepairCompleted("rp-1", 1, {
      status: "completed",
      changedFiles: ["src/main.ts", "package.json"],
      actionsCompleted: 2,
      actionsFailed: 0,
    });

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const result = (state2.getMission() as any).repairExecutionResult;
    expect(result).toBeDefined();
    expect(result.status).toBe("completed");
    expect(result.changedFiles).toEqual(["src/main.ts", "package.json"]);
    expect(result.actionsCompleted).toBe(2);
  });
});

// ─── 20. Old missions load without repair fields ────────────────────

describe("20. old missions load without repair fields", () => {
  it("loads mission state that has no repair fields", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const loaded = state2.getMission();
    expect(loaded).toBeDefined();
    expect(loaded.id).toBe(mission.id);
    expect(loaded.repairCycleCount).toBe(0);
    expect(loaded.repairExecutionResult).toBeUndefined();
    expect(state2.getRepairCycleCount()).toBe(0);
  });

  it("old mission snapshot without repairCycleCount still loads", async () => {
    const mission = makeMission();
    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const snapshotPath = path.join(
      tmpDir, "outputs", "missions", `${mission.id}.state.json`
    );
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    delete snapshot.repairCycleCount;
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    expect(state2.getMission().id).toBe(mission.id);
    expect(state2.getRepairCycleCount()).toBe(0);
  });
});
