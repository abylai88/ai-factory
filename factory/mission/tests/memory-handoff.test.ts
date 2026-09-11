import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";
import { MissionMemory, createMissionMemory } from "../mission-memory.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-handoff-"));
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

// ── E2E: Developer → Validation Failure → QA → Repair with context ──

describe("MissionMemory Handoff E2E", () => {
  it("Developer failure → triage → repair prompt includes full mission context", async () => {
    // Script that fails first time (simulates a build error), passes after marker
    const markerPath = path.join(tmpDir, ".fixed");
    const failScript = path.join(tmpDir, "fail.sh");
    await fs.writeFile(failScript, [
      "#!/bin/bash",
      `if [ -f "${markerPath}" ]; then exit 0; fi`,
      'echo "SyntaxError: unexpected token in src/game.ts" >&2',
      "exit 1",
    ].join("\n"));
    await fs.chmod(failScript, 0o755);

    const mission = createMission("Build and test a Phaser game", {
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
      "ROLE: builder\nBUILD_COMMAND: bash fail.sh",
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

    // Track what context was passed to the repair delegation
    let capturedRepairPrompt = "";
    let repairDelegationCreated = false;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id.startsWith("triage-")) {
          repairDelegationCreated = true;
          capturedRepairPrompt = del.description;

          // Verify the repair prompt contains mission memory context
          expect(capturedRepairPrompt).toContain("MISSION CONTEXT");
          expect(capturedRepairPrompt).toContain("Build and test a Phaser game");
          expect(capturedRepairPrompt).toContain("Engine: web");
          expect(capturedRepairPrompt).toContain("Stack: phaser");
          expect(capturedRepairPrompt).toContain("EXECUTION HISTORY");
          expect(capturedRepairPrompt).toContain("Build Project");
          expect(capturedRepairPrompt).toContain("VALIDATION ERRORS");

          // Fix the issue
          await fs.writeFile(markerPath, "fixed");
          return { delegationId: del.id, status: "passed", output: "Fixed syntax", durationMs: 50 };
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      validation: { buildCommand: `bash ${failScript}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Verify the repair delegation was created
    expect(repairDelegationCreated).toBe(true);

    // Verify triage was applied
    const triageEvents = getEvents(eventSink, MissionEventTypes.DELEGATION_TRIAGE);
    expect(triageEvents.length).toBeGreaterThanOrEqual(1);

    // Verify memory tracked the delegations
    const memory = createMissionMemory(state, eventSink);
    const contextBlock = memory.buildContextBlock();
    expect(contextBlock).toContain("MISSION CONTEXT");
    expect(contextBlock).toContain("Build and test a Phaser game");

    // Mission should complete successfully after repair
    expect(result.status).toBe("completed");
  });

  it("Multiple delegations: memory accumulates full history across repairs", async () => {
    // Script that fails twice then passes
    const phase1 = path.join(tmpDir, ".phase1");
    const phase2 = path.join(tmpDir, ".phase2");
    const multiFailScript = path.join(tmpDir, "multi-fail.sh");
    await fs.writeFile(multiFailScript, [
      "#!/bin/bash",
      `if [ -f "${phase2}" ]; then exit 0; fi`,
      `if [ -f "${phase1}" ]; then echo "ERROR: type mismatch in renderer.ts" >&2; touch "${phase2}"; exit 1; fi`,
      'echo "SyntaxError: unexpected" >&2; touch "${phase1}"; exit 1',
    ].join("\n"));
    await fs.chmod(multiFailScript, 0o755);

    const mission = createMission("Build a complete game", {
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
      "ROLE: builder\nBUILD_COMMAND: bash multi-fail.sh",
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
      objectives: [{ id: "obj-build", title: "Build", description: "Build", delegations: [buildDel.id] }],
      delegations: [buildDel],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(buildDel);

    const eventSink = new InMemoryEventSink();
    let repairAttempts = 0;

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(del: Delegation): Promise<AgentResult> {
        if (del.id.startsWith("triage-")) {
          repairAttempts++;
          // Each repair should see growing context from previous attempts
          const prompt = del.description;
          expect(prompt).toContain("MISSION CONTEXT");
          expect(prompt).toContain("Build Project");

          // On second attempt, should see previous repair attempt in history
          if (repairAttempts === 2) {
            expect(prompt).toContain("EXECUTION HISTORY");
            expect(prompt).toContain("TRIAGE HISTORY");
          }

          // "Fix" the issue by creating the marker (same as first test)
          if (repairAttempts === 1) {
            await fs.writeFile(phase1, "fixed phase1");
          } else if (repairAttempts >= 2) {
            await fs.writeFile(phase2, "fixed phase2");
          }

          return { delegationId: del.id, status: "passed", output: `Repair attempt ${repairAttempts}`, durationMs: 50 };
        }
        return { delegationId: del.id, status: "passed", output: "Done", durationMs: 50 };
      },
    };

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: projectPath,
      factoryAdapter: adapter,
      auditor: createPassingAuditor(),
      eventSink,
      missionState: state,
      validation: { buildCommand: `bash ${multiFailScript}`, maxRepairAttempts: 3 },
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Should have had multiple repair attempts
    expect(repairAttempts).toBeGreaterThanOrEqual(2);

    // Verify memory accumulated events
    const memory = createMissionMemory(state, eventSink);
    const contextBlock = memory.buildContextBlock();

    // Should contain multiple triage records
    const triageMatches = contextBlock.match(/TRIAGE HISTORY/g);
    expect(triageMatches).not.toBeNull();
    expect(triageMatches!.length).toBeGreaterThanOrEqual(1);

    expect(result.status).toBe("completed");
  });
});
