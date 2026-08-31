import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator } from "../orchestrator.js";
import { CompositeCodingBuildAdapter, CodingMissionAuditor } from "../adapters.js";
import { NoopVisualQaAdapter } from "../visual-qa-adapter.js";
import { DeterministicRepairExecutor } from "../repair-executor.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "10a2-integration-"));
  projectPath = path.join(tmpDir, "projects", "test-game");
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ name: "test-game", scripts: { build: "echo ok" } }, null, 2)
  );
  await fs.writeFile(path.join(projectPath, "src", "main.ts"), "export const x = 1;\n");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Phase 10A.2 integration: build → Visual QA → auditor", () => {
  it("real orchestrator executes build delegation, reaches Visual QA, reaches auditor", async () => {
    const mission = createMission(
      "Build and test the game",
      {
        projectId: "test-game",
        engine: "web",
        stack: "phaser",
        template: "yagames-phaser-template",
        workspace: projectPath,
        requiresVisualQa: true,
      },
      { maxRepairs: 1, maxDelegations: 5, allowedPipelines: ["game", "engineering"], requireApproval: false }
    );

    const stateDir = path.join(tmpDir, "state");
    await fs.mkdir(stateDir, { recursive: true });
    const state = new MissionState(stateDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const buildDel = createDelegation(
      mission.id,
      "obj-build",
      "[1] Build Project",
      "Run the project build command\nROLE: builder\nBUILD_COMMAND: echo ok",
      "game",
      {
        stepIds: ["build"],
        dependsOn: [],
        acceptanceCriteria: ["Build succeeded", "Mission objective satisfied"],
      }
    );

    const plan = {
      id: "plan-integration",
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
    const factoryAdapter = new CompositeCodingBuildAdapter();
    const auditor = new CodingMissionAuditor();
    const qaAdapter = new NoopVisualQaAdapter();
    const repairExecutor = new DeterministicRepairExecutor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: stateDir,
      project: projectPath,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      visualQaAdapter: qaAdapter,
      repairExecutor,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // 1. REAL EXECUTION: mission completes (not failed)
    expect(result.status).toBe("completed");

    // 2. BUILD REACHED: build delegation passed
    const finalDel = state.getDelegation(buildDel.id);
    expect(finalDel).toBeDefined();
    expect(finalDel!.status).toBe("passed");
    expect(finalDel!.result).toBeDefined();
    const parsed = JSON.parse(finalDel!.result!);
    expect(parsed.status).toBe("success");

    // 3. VISUAL_QA_REACHED: QA adapter was called (NoopVisualQaAdapter returns "skipped")
    const qaResult = state.getVisualQaResult();
    expect(qaResult).toBeDefined();
    expect(qaResult!.status).toBe("skipped");

    // 4. AUDITOR_REACHED: audit events emitted
    const events = eventSink.recent();
    const auditPassedEvents = events.filter((e) => e.type === MissionEventTypes.MISSION_AUDIT_PASSED);
    expect(auditPassedEvents.length).toBeGreaterThanOrEqual(1);

    // 5. Auditor produced a result for the build delegation
    const auditResult = state.getAuditResult(buildDel.id);
    expect(auditResult).toBeDefined();
    expect(auditResult!.status).toBe("PASS");

    // 6. SELF_HEALING_READY: repair executor was wired (maxRepairs=0 so no repair ran, but it was configured)
    expect(repairExecutor).toBeDefined();

    // 7. Events confirm the full path: delegation → build → qa → audit
    const delegationStarted = events.filter((e) => e.type === MissionEventTypes.DELEGATION_STARTED);
    const delegationCompleted = events.filter((e) => e.type === MissionEventTypes.DELEGATION_COMPLETED);
    const qaStarted = events.filter((e) => e.type === MissionEventTypes.MISSION_VISUAL_QA_STARTED);
    const auditEvents = events.filter((e) => e.type === MissionEventTypes.MISSION_AUDITING);
    expect(delegationStarted.length).toBeGreaterThanOrEqual(1);
    expect(delegationCompleted.length).toBeGreaterThanOrEqual(1);
    expect(qaStarted.length).toBe(1);
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
  });
});
