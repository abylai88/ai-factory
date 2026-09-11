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
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "validation-integration-"));
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

function createPassingAdapter(): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      return {
        delegationId: del.id,
        status: "passed",
        output: "Agent completed successfully",
        durationMs: 100,
      };
    },
  };
}

function createFailingBuildAdapter(): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      return {
        delegationId: del.id,
        status: "passed",
        output: "Agent completed but code has issues",
        durationMs: 100,
      };
    },
  };
}

function createPassingRepairAdapter(callLog: string[]): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      callLog.push(del.id);
      return {
        delegationId: del.id,
        status: "passed",
        output: "Fixed the code",
        durationMs: 100,
      };
    },
  };
}

function createFailingRepairAdapter(maxFails: number, callLog: string[]): FactoryExecutionAdapter {
  let calls = 0;
  return {
    async runDelegation(del: Delegation, mission: Mission): Promise<AgentResult> {
      calls++;
      callLog.push(del.id);
      if (calls <= maxFails) {
        return {
          delegationId: del.id,
          status: "failed",
          output: "",
          error: "Repair agent failed",
          durationMs: 100,
        };
      }
      return {
        delegationId: del.id,
        status: "passed",
        output: "Fixed after retries",
        durationMs: 100,
      };
    },
  };
}

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

// ── Helpers ────────────────────────────────────────────────

async function setupOrchestrator(config: {
  factoryAdapter: FactoryExecutionAdapter;
  validation?: { buildCommand?: string; testCommand?: string; maxRepairAttempts?: number };
}) {
  const mission = createMission(
    "Build and test the game",
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
  const auditor = createPassingAuditor();

  const orchestrator = new MissionOrchestrator({
    maxRepairs: 3,
    baseDir: tmpDir,
    project: projectPath,
    factoryAdapter: config.factoryAdapter,
    auditor,
    eventSink,
    missionState: state,
    validation: config.validation,
  });

  return { orchestrator, mission, eventSink, state, buildDel, plan };
}

function getEvents(eventSink: InMemoryEventSink, type: string) {
  return eventSink.recent().filter((e) => e.type === type);
}

// ── Tests ──────────────────────────────────────────────────

describe("Validation gate integration in orchestrator", () => {
  it("skips validation when no validation config is provided", async () => {
    const { orchestrator, mission, eventSink, buildDel, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
    });

    await orchestrator.executeMission(mission, plan);

    const valStarted = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_STARTED);
    expect(valStarted).toHaveLength(0);
  });

  it("runs validation after successful delegation", async () => {
    const { orchestrator, mission, eventSink, buildDel, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      validation: { buildCommand: "echo ok" },
    });

    await orchestrator.executeMission(mission, plan);

    const valStarted = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_STARTED);
    const valPassed = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_PASSED);
    expect(valStarted).toHaveLength(1);
    expect(valPassed).toHaveLength(1);
  });

  it("emits validation.failed event when validation fails", async () => {
    const { orchestrator, mission, eventSink, buildDel, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      validation: { buildCommand: "false", maxRepairAttempts: 1 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    const valFailed = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_FAILED);
    expect(valFailed.length).toBeGreaterThanOrEqual(1);
    // Mission should fail since repair also can't fix validation
    expect(result.status).toBe("failed");
  });

  it("automatically repairs and re-validates after validation failure", async () => {
    const markerPath = path.join(tmpDir, ".validated");
    const scriptPath = path.join(tmpDir, "check.sh");
    await fs.writeFile(scriptPath, `#!/bin/bash\ntest -f "${markerPath}"`);
    await fs.chmod(scriptPath, 0o755);

    let repairCount = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        // Repair delegation has "repair-" or "triage-" prefix
        if (del.id.startsWith("repair-") || del.id.startsWith("triage-")) {
          repairCount++;
          await fs.writeFile(markerPath, "ok");
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: adapter,
      validation: { buildCommand: `bash ${scriptPath}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    const valFailed = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_FAILED);
    expect(valFailed.length).toBeGreaterThanOrEqual(1);

    const retryEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_RETRY_STARTED);
    expect(retryEvents.length).toBeGreaterThanOrEqual(1);

    expect(result.status).toBe("completed");
    expect(repairCount).toBeGreaterThanOrEqual(1);
  });

  it("fails mission after max repair attempts exhausted", async () => {
    const callLog: string[] = [];
    const { orchestrator, mission, eventSink, buildDel, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      validation: { buildCommand: "false", maxRepairAttempts: 2 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    const retryEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_RETRY_STARTED);
    expect(retryEvents).toHaveLength(2);
    expect(result.status).toBe("failed");
  });

  it("emits correct event sequence: started → completed → validation.started → validation.passed", async () => {
    const { orchestrator, mission, eventSink, buildDel, plan } = await setupOrchestrator({
      factoryAdapter: createPassingAdapter(),
      validation: { buildCommand: "echo ok" },
    });

    await orchestrator.executeMission(mission, plan);

    const events = eventSink.recent().reverse();
    const types = events.map((e) => e.type);

    // Find the relevant events for the build delegation
    const delStarted = types.indexOf(MissionEventTypes.DELEGATION_STARTED);
    const delCompleted = types.indexOf(MissionEventTypes.DELEGATION_COMPLETED);
    const valStarted = types.indexOf(MissionEventTypes.DELEGATION_VALIDATION_STARTED);
    const valPassed = types.indexOf(MissionEventTypes.DELEGATION_VALIDATION_PASSED);

    expect(delStarted).toBeGreaterThan(-1);
    expect(delCompleted).toBeGreaterThan(delStarted);
    expect(valStarted).toBeGreaterThan(delCompleted);
    expect(valPassed).toBeGreaterThan(valStarted);
  });

  it("skips validation for read-only delegations", async () => {
    const readOnlyAdapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        return {
          delegationId: del.id,
          status: "passed",
          output: "Read-only check",
          durationMs: 50,
          readOnly: true,
        };
      },
    };

    const { orchestrator, mission, eventSink, buildDel, plan } = await setupOrchestrator({
      factoryAdapter: readOnlyAdapter,
      validation: { buildCommand: "echo ok" },
    });

    await orchestrator.executeMission(mission, plan);

    const valStarted = getEvents(eventSink, MissionEventTypes.DELEGATION_VALIDATION_STARTED);
    expect(valStarted).toHaveLength(0);
  });
});
