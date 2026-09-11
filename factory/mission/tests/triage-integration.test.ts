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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "triage-integration-"));
  projectPath = path.join(tmpDir, "projects", "test-game");
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ name: "test-game" }, null, 2)
  );
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
  factoryAdapter: FactoryExecutionAdapter;
  validation?: { buildCommand?: string; testCommand?: string; maxRepairAttempts?: number };
}) {
  const mission = createMission("Build and test the game", {
    projectId: "test-game",
    engine: "web",
    stack: "phaser",
    workspace: projectPath,
  });

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

  const orchestrator = new MissionOrchestrator({
    maxRepairs: 3,
    baseDir: tmpDir,
    project: projectPath,
    factoryAdapter: config.factoryAdapter,
    auditor: createPassingAuditor(),
    eventSink,
    missionState: state,
    validation: config.validation,
  });

  return { orchestrator, mission, eventSink, state, buildDel, plan };
}

// ── E2E Scenario 1: Syntax error → repair via builder ──────

describe("Triage E2E: syntax error routes to builder repair", () => {
  it("classifies syntax error and creates repair delegation with builder context", async () => {
    // Script that fails first time, passes after marker is created
    const markerPath = path.join(tmpDir, ".syntax-fixed");
    const errorScript = path.join(tmpDir, "syntax-error.sh");
    await fs.writeFile(errorScript, `#!/bin/bash\nif [ -f "${markerPath}" ]; then exit 0; fi\necho "SyntaxError: Unexpected token '}'" >&2; exit 1`);
    await fs.chmod(errorScript, 0o755);

    let repairCount = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id.startsWith("triage-")) {
          repairCount++;
          // "Fix" the issue by creating the marker
          await fs.writeFile(markerPath, "fixed");
          return { delegationId: del.id, status: "passed", output: "Fixed syntax", durationMs: 50 };
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: adapter,
      validation: { buildCommand: `bash ${errorScript}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Triage should have classified this as syntax_error
    const triageEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_TRIAGE);
    expect(triageEvents.length).toBeGreaterThanOrEqual(1);

    const triagePayload = triageEvents[0].payload as Record<string, unknown>;
    expect(triagePayload.category).toBe("syntax_error");
    expect(triagePayload.action).toBe("repair");
    expect(triagePayload.targetRole).toBe("builder");

    // Repair delegation should have been created with repair action label
    const createdEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_CREATED);
    const repairCreated = createdEvents.find(
      (e) => (e.payload as Record<string, unknown>).title?.toString().includes("[Repair]")
    );
    expect(repairCreated).toBeDefined();

    // Mission should complete after repair
    expect(result.status).toBe("completed");
    expect(repairCount).toBeGreaterThanOrEqual(1);
  });
});

// ── E2E Scenario 2: Test failure → QA analysis via tester ──

describe("Triage E2E: test failure routes to QA analysis", () => {
  it("classifies test failure and creates QA analysis delegation with tester context", async () => {
    // Script that fails first time, passes after marker is created
    const markerPath = path.join(tmpDir, ".test-fixed");
    const testFailScript = path.join(tmpDir, "test-fail.sh");
    await fs.writeFile(testFailScript, `#!/bin/bash\nif [ -f "${markerPath}" ]; then exit 0; fi\necho "FAIL src/game.test.ts"; echo "AssertionError: expected 42 to equal 0" >&2; exit 1`);
    await fs.chmod(testFailScript, 0o755);

    let repairCount = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id.startsWith("triage-")) {
          repairCount++;
          // Verify the prompt contains tester-specific instructions
          expect(del.description).toContain("tester agent");
          expect(del.description).toContain("qa_analysis task");
          // "Fix" by creating marker
          await fs.writeFile(markerPath, "fixed");
          return { delegationId: del.id, status: "passed", output: "Fixed test", durationMs: 50 };
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: adapter,
      validation: { buildCommand: `bash ${testFailScript}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Triage should have classified this as test_failure
    const triageEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_TRIAGE);
    expect(triageEvents.length).toBeGreaterThanOrEqual(1);

    const triagePayload = triageEvents[0].payload as Record<string, unknown>;
    expect(triagePayload.category).toBe("test_failure");
    expect(triagePayload.action).toBe("qa_analysis");
    expect(triagePayload.targetRole).toBe("tester");

    // Repair delegation should have QA Analysis label
    const createdEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_CREATED);
    const qaCreated = createdEvents.find(
      (e) => (e.payload as Record<string, unknown>).title?.toString().includes("[QA Analysis]")
    );
    expect(qaCreated).toBeDefined();

    expect(result.status).toBe("completed");
    expect(repairCount).toBeGreaterThanOrEqual(1);
  });
});

// ── E2E Scenario 3: Missing module → research via researcher ─

describe("Triage E2E: missing module routes to research", () => {
  it("classifies missing module and creates research delegation", async () => {
    const markerPath = path.join(tmpDir, ".module-fixed");
    const moduleScript = path.join(tmpDir, "module-error.sh");
    await fs.writeFile(moduleScript, `#!/bin/bash\nif [ -f "${markerPath}" ]; then exit 0; fi\necho "Cannot find module 'phaser'" >&2; exit 1`);
    await fs.chmod(moduleScript, 0o755);

    let repairCount = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id.startsWith("triage-")) {
          repairCount++;
          expect(del.description).toContain("researcher agent");
          expect(del.description).toContain("research task");
          await fs.writeFile(markerPath, "fixed");
          return { delegationId: del.id, status: "passed", output: "Found package info", durationMs: 50 };
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: adapter,
      validation: { buildCommand: `bash ${moduleScript}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    const triageEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_TRIAGE);
    expect(triageEvents.length).toBeGreaterThanOrEqual(1);

    const triagePayload = triageEvents[0].payload as Record<string, unknown>;
    expect(triagePayload.category).toBe("dependency_missing");
    expect(triagePayload.action).toBe("research");
    expect(triagePayload.targetRole).toBe("researcher");

    // Should have Research label
    const createdEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_CREATED);
    const researchCreated = createdEvents.find(
      (e) => (e.payload as Record<string, unknown>).title?.toString().includes("[Research]")
    );
    expect(researchCreated).toBeDefined();

    expect(result.status).toBe("completed");
  });
});

// ── E2E Scenario 4: Multiple failures, different routing ───

describe("Triage E2E: different failures get different routing", () => {
  it("routes each failure type to the correct agent role", async () => {
    // Script that fails with syntax error first, then test failure, then passes
    const phase1 = path.join(tmpDir, ".phase1");
    const phase2 = path.join(tmpDir, ".phase2");
    const alternateScript = path.join(tmpDir, "alternate.sh");
    await fs.writeFile(alternateScript, [
      "#!/bin/bash",
      `if [ -f "${phase2}" ]; then exit 0; fi`,
      `if [ -f "${phase1}" ]; then echo "FAIL test.ts" >&2; echo "AssertionError: expected 1 to equal 2" >&2; touch "${phase2}"; exit 1; fi`,
      `echo "SyntaxError: unexpected" >&2; touch "${phase1}"; exit 1`,
    ].join("\n"));
    await fs.chmod(alternateScript, 0o755);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: adapter,
      validation: { buildCommand: `bash ${alternateScript}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Collect all triage decisions
    const triageDecisions: Array<{ category: string; action: string; targetRole: string }> = [];
    const triageEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_TRIAGE);
    console.log("Triage events count:", triageEvents.length);
    for (const evt of triageEvents) {
      const p = evt.payload as Record<string, unknown>;
      console.log("Triage decision:", JSON.stringify({ category: p.category, action: p.action, targetRole: p.targetRole }));
      triageDecisions.push({
        category: p.category as string,
        action: p.action as string,
        targetRole: p.targetRole as string,
      });
    }

    // Events are newest-first, so reverse to get chronological order
    triageDecisions.reverse();

    // First failure should be syntax_error → repair → builder
    expect(triageDecisions[0].category).toBe("syntax_error");
    expect(triageDecisions[0].action).toBe("repair");
    expect(triageDecisions[0].targetRole).toBe("builder");

    // Second failure should be test_failure → qa_analysis → tester
    expect(triageDecisions[1].category).toBe("test_failure");
    expect(triageDecisions[1].action).toBe("qa_analysis");
    expect(triageDecisions[1].targetRole).toBe("tester");

    expect(result.status).toBe("completed");
  });
});
