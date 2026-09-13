import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  createExecutionPlan,
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
  Objective,
  Risk,
  ValidationGate,
} from "../mission.js";
import { MissionState } from "../state.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  FactoryExecutionAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-resume-test-"));
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

function makeLinearPlan(mission: Mission, count = 4): ExecutionPlan {
  const delegations: Delegation[] = [];
  const objectives: Objective[] = [];
  const risks: Risk[] = [];
  const validationGates: ValidationGate[] = [];

  for (let i = 0; i < count; i++) {
    const del = createDelegation(
      mission.id,
      `obj-${Math.floor(i / 2) + 1}`,
      `Step ${i + 1}`,
      `Step ${i + 1} description`,
      "game",
      {
        dependsOn: i > 0 ? [delegations[i - 1].id] : [],
        acceptanceCriteria: [`Step ${i + 1} complete`],
        role: i === 0 ? "Researcher" : i === 1 ? "Designer" : "Developer",
      }
    );
    delegations.push(del);
  }

  objectives.push(
    { id: "obj-1", title: "Phase 1", description: "First phase", delegations: delegations.filter((_, i) => i < 2).map((d) => d.id) },
    { id: "obj-2", title: "Phase 2", description: "Second phase", delegations: delegations.filter((_, i) => i >= 2).map((d) => d.id) }
  );

  return createExecutionPlan(mission, objectives, delegations, risks, validationGates);
}

class RecordingAdapter implements FactoryExecutionAdapter {
  public executedDelegations: string[] = [];
  private failIds: Set<string>;

  constructor(failIds: string[] = []) {
    this.failIds = new Set(failIds);
  }

  async runDelegation(
    delegation: Delegation,
    _mission: Mission,
    _config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    this.executedDelegations.push(delegation.id);

    if (this.failIds.has(delegation.id)) {
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

    return {
      delegationId: delegation.id,
      status: "passed",
      output,
      durationMs: 10,
    };
  }
}

// ─── Resume after failure skips completed delegations ────────────────

describe("resume after failure", () => {
  it("skips already-completed delegations on resume", async () => {
    const mission = makeMission();
    const plan = makeLinearPlan(mission, 4);
    // del-0 -> del-1 -> del-2 -> del-3

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    // Phase 1: Run del-0 and del-1 to completion, del-2 fails
    const run1Adapter = new RecordingAdapter([plan.delegations[2].id]);
    const eventSink1 = new InMemoryEventSink();
    const orchestrator1 = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: run1Adapter,
      auditor: new DeterministicAuditor(),
      eventSink: eventSink1,
      missionState: state,
    });

    const result1 = await orchestrator1.executeMission(mission, plan);
    expect(result1.status).toBe("failed");

    // Verify del-0 and del-1 passed, del-2 failed
    expect(state.getDelegation(plan.delegations[0].id)?.status).toBe("passed");
    expect(state.getDelegation(plan.delegations[1].id)?.status).toBe("passed");
    expect(state.getDelegation(plan.delegations[2].id)?.status).toBe("failed");

    // Phase 2: Resume — del-0 and del-1 should NOT be re-executed
    const run2Adapter = new RecordingAdapter();
    const eventSink2 = new InMemoryEventSink();

    const resumeData = await state.prepareForResume();
    expect(resumeData.mission.status).toBe("running");

    const orchestrator2 = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: run2Adapter,
      auditor: new DeterministicAuditor(),
      eventSink: eventSink2,
      missionState: state,
      resume: true,
    });

    const result2 = await orchestrator2.executeMission(resumeData.mission, resumeData.plan!);
    expect(result2.status).toBe("completed");

    // del-0 and del-1 should NOT have been re-executed (already passed)
    expect(run2Adapter.executedDelegations).not.toContain(plan.delegations[0].id);
    expect(run2Adapter.executedDelegations).not.toContain(plan.delegations[1].id);
    // del-2 should have been retried (was failed)
    expect(run2Adapter.executedDelegations).toContain(plan.delegations[2].id);
    // del-3 should have been executed (deps now met)
    expect(run2Adapter.executedDelegations).toContain(plan.delegations[3].id);
  });

  it("does not rerun passed delegations if they already succeeded", async () => {
    const mission = makeMission();

    // Create explicit delegations: market -> competitor -> director -> gameplay
    const marketDel = createDelegation(mission.id, "obj-1", "Market Research", "Research market", "game", {
      acceptanceCriteria: ["Market analysis complete"],
      role: "Researcher",
    });
    const competitorDel = createDelegation(mission.id, "obj-1", "Competitor Analysis", "Analyze competitors", "game", {
      dependsOn: [marketDel.id],
      acceptanceCriteria: ["Competitor list finalized"],
      role: "Researcher",
    });
    const directorDel = createDelegation(mission.id, "obj-2", "Director Design", "Create GDD", "game", {
      dependsOn: [competitorDel.id],
      acceptanceCriteria: ["GDD created"],
      role: "Designer",
    });
    const gameplayDel = createDelegation(mission.id, "obj-2", "Gameplay Implementation", "Implement gameplay", "game", {
      dependsOn: [directorDel.id],
      acceptanceCriteria: ["Gameplay works"],
      role: "Developer",
    });

    const customPlan = createExecutionPlan(
      mission,
      [
        { id: "obj-1", title: "Research", description: "Research phase", delegations: [marketDel.id, competitorDel.id] },
        { id: "obj-2", title: "Design & Build", description: "Design and build", delegations: [directorDel.id, gameplayDel.id] },
      ],
      [marketDel, competitorDel, directorDel, gameplayDel],
      [],
      []
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(customPlan);
    for (const del of customPlan.delegations) {
      await state.addDelegation(del);
    }

    // Manually set market and competitor as passed, director as failed
    await state.completeDelegation(marketDel.id, "passed", "Market analysis complete");
    await state.completeDelegation(competitorDel.id, "passed", "Competitor list finalized");
    await state.completeDelegation(directorDel.id, "failed", "Created GDD.md but failed", "GDD incomplete");

    // Resume — only director (retry) and gameplay should be executed
    const adapter = new RecordingAdapter();
    const eventSink = new InMemoryEventSink();

    const resumeData = await state.prepareForResume();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
      resume: true,
    });

    const result = await orchestrator.executeMission(resumeData.mission, resumeData.plan!);
    expect(result.status).toBe("completed");

    // Market and competitor should NOT have been re-executed
    expect(adapter.executedDelegations).not.toContain(marketDel.id);
    expect(adapter.executedDelegations).not.toContain(competitorDel.id);
    // Director should have been retried (was failed)
    expect(adapter.executedDelegations).toContain(directorDel.id);
    // Gameplay should have been executed (deps now met)
    expect(adapter.executedDelegations).toContain(gameplayDel.id);
  });
});

// ─── Artifacts survive resume ────────────────────────────────────────

describe("artifacts survive resume", () => {
  it("preserves completed delegation outputs across resume", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "Build game", "game", {
      acceptanceCriteria: ["Build works"],
    });
    await state.addDelegation(del);

    // Complete with specific output
    const specificOutput = "Created src/game.ts with Phaser game setup";
    await state.completeDelegation(del.id, "passed", specificOutput);

    // Verify output is persisted
    const stored = state.getDelegation(del.id);
    expect(stored?.result).toBe(specificOutput);
    expect(stored?.status).toBe("passed");

    // Reload from a fresh state instance (simulates process restart)
    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const reloaded = state2.getDelegation(del.id);
    expect(reloaded?.result).toBe(specificOutput);
    expect(reloaded?.status).toBe("passed");
  });

  it("preserves delegation outputs across multiple resume cycles", async () => {
    const mission = makeMission();
    const del1 = createDelegation(mission.id, "obj-1", "Step 1", "Research market", "game", {
      acceptanceCriteria: ["Research done"],
      role: "Researcher",
    });
    const del2 = createDelegation(mission.id, "obj-1", "Step 2", "Design game", "game", {
      dependsOn: [del1.id],
      acceptanceCriteria: ["Design done"],
      role: "Designer",
    });
    const del3 = createDelegation(mission.id, "obj-2", "Step 3", "Build game", "game", {
      dependsOn: [del2.id],
      acceptanceCriteria: ["Build done"],
      role: "Developer",
    });

    const customPlan = createExecutionPlan(
      mission,
      [
        { id: "obj-1", title: "Phase 1", description: "Research & Design", delegations: [del1.id, del2.id] },
        { id: "obj-2", title: "Phase 2", description: "Build", delegations: [del3.id] },
      ],
      [del1, del2, del3],
      [],
      []
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(customPlan);
    for (const del of customPlan.delegations) {
      await state.addDelegation(del);
    }

    // Cycle 1: del1 passes, del2 fails
    await state.completeDelegation(del1.id, "passed", "Research done - market analysis complete");
    await state.completeDelegation(del2.id, "failed", "", "Design tool crashed");

    // Cycle 2 (first resume): del2 passes
    await state.prepareForResume();
    await state.completeDelegation(del2.id, "passed", "Design done - GDD created");
    await state.completeDelegation(del3.id, "failed", "", "Build failed");

    // Cycle 3 (second resume): del3 passes
    await state.prepareForResume();
    await state.completeDelegation(del3.id, "passed", "Build done - game compiles");

    // Verify all outputs are preserved
    const finalState = new MissionState(tmpDir, mission.id);
    await finalState.init();

    expect(finalState.getDelegation(del1.id)?.result).toBe("Research done - market analysis complete");
    expect(finalState.getDelegation(del1.id)?.status).toBe("passed");
    expect(finalState.getDelegation(del2.id)?.result).toBe("Design done - GDD created");
    expect(finalState.getDelegation(del2.id)?.status).toBe("passed");
    expect(finalState.getDelegation(del3.id)?.result).toBe("Build done - game compiles");
    expect(finalState.getDelegation(del3.id)?.status).toBe("passed");
  });
});

// ─── Resume continues at failed delegation ───────────────────────────

describe("resume continues at failed delegation", () => {
  it("resumes execution at the first failed/incomplete delegation", async () => {
    const mission = makeMission();
    const del1 = createDelegation(mission.id, "obj-1", "Market Research", "Research market", "game", {
      acceptanceCriteria: ["Research done"],
      role: "Researcher",
    });
    const del2 = createDelegation(mission.id, "obj-1", "Competitor Analysis", "Analyze competitors", "game", {
      dependsOn: [del1.id],
      acceptanceCriteria: ["Analysis done"],
      role: "Researcher",
    });
    const del3 = createDelegation(mission.id, "obj-2", "Director Design", "Create GDD", "game", {
      dependsOn: [del2.id],
      acceptanceCriteria: ["GDD created"],
      role: "Designer",
    });

    const customPlan = createExecutionPlan(
      mission,
      [
        { id: "obj-1", title: "Research", description: "Research phase", delegations: [del1.id, del2.id] },
        { id: "obj-2", title: "Design", description: "Design phase", delegations: [del3.id] },
      ],
      [del1, del2, del3],
      [],
      []
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(customPlan);
    for (const del of customPlan.delegations) {
      await state.addDelegation(del);
    }

    // Manually set: del1 passed, del2 failed
    await state.completeDelegation(del1.id, "passed", "Research done");
    await state.completeDelegation(del2.id, "failed", "", "Analysis failed");

    // Resume — should skip del1, retry del2, then run del3
    const adapter = new RecordingAdapter();
    const eventSink = new InMemoryEventSink();

    const resumeData = await state.prepareForResume();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "projects", "test"),
      factoryAdapter: adapter,
      auditor: new DeterministicAuditor(),
      eventSink,
      missionState: state,
      resume: true,
    });

    const result = await orchestrator.executeMission(resumeData.mission, resumeData.plan!);
    expect(result.status).toBe("completed");

    // del1 should NOT be re-executed (already passed)
    expect(adapter.executedDelegations).not.toContain(del1.id);
    // del2 should be retried (was failed)
    expect(adapter.executedDelegations).toContain(del2.id);
    // del3 should be executed (deps now met)
    expect(adapter.executedDelegations).toContain(del3.id);
  });
});

// ─── Resume after process interruption ───────────────────────────────

describe("resume after process interruption", () => {
  it("resumes from persisted state after simulated process restart", async () => {
    const mission = makeMission();
    const plan = makeLinearPlan(mission, 4);

    // Phase 1: Run and persist state
    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);
    await state1.setPlan(plan);
    for (const del of plan.delegations) {
      await state1.addDelegation(del);
    }

    // Execute first delegation
    const firstDel = plan.delegations[0];
    await state1.startDelegation(firstDel.id, "pipeline-1");
    await state1.completeDelegation(firstDel.id, "passed", "First delegation completed");

    // Save state (simulates process writing to disk before crash)
    await state1.saveSnapshot();

    // Phase 2: Simulate process restart — create fresh MissionState from disk
    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    // Verify state was loaded correctly
    const loadedMission = state2.getMission();
    expect(loadedMission.id).toBe(mission.id);
    expect(loadedMission.context?.workspace).toBe(mission.context?.workspace);

    const loadedDelegations = state2.getDelegations();
    expect(loadedDelegations.length).toBe(plan.delegations.length);
    expect(loadedDelegations[0].status).toBe("passed");
    expect(loadedDelegations[0].result).toBe("First delegation completed");

    // Verify progress
    const progress = state2.getProgress();
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(plan.delegations.length);
  });

  it("resets running delegations to queued on resume", async () => {
    const mission = makeMission();
    const plan = makeLinearPlan(mission, 3);
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    // Start a delegation (simulate crash during execution)
    const firstDel = plan.delegations[0];
    await state.startDelegation(firstDel.id, "pipeline-1");

    // Verify it's running
    expect(state.getDelegation(firstDel.id)?.status).toBe("running");

    // Resume — should reset running to queued
    const resumeData = await state.prepareForResume();
    expect(resumeData.delegations[0].status).toBe("queued");
  });

  it("preserves mission context across resume", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    // Simulate crash after some work
    const del = createDelegation(mission.id, "obj-1", "Step 1", "desc", "game", { acceptanceCriteria: ["c1"] });
    await state.addDelegation(del);
    await state.completeDelegation(del.id, "passed", "Done");

    // Fresh state instance (simulates restart)
    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const mission2 = state2.getMission();
    expect(mission2.context?.projectId).toBe(mission.context?.projectId);
    expect(mission2.context?.engine).toBe(mission.context?.engine);
    expect(mission2.context?.stack).toBe(mission.context?.stack);
    expect(mission2.context?.template).toBe(mission.context?.template);
    expect(mission2.context?.workspace).toBe(mission.context?.workspace);
  });
});

// ─── Progress reporting on resume ────────────────────────────────────

describe("progress reporting on resume", () => {
  it("reports actual persisted progress, not 0/N", async () => {
    const mission = makeMission();
    const plan = makeLinearPlan(mission, 5);
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(plan);
    for (const del of plan.delegations) {
      await state.addDelegation(del);
    }

    // Complete some delegations
    for (let i = 0; i < 3; i++) {
      await state.completeDelegation(plan.delegations[i].id, "passed", `Done ${i}`);
    }

    // Get progress — should reflect completed work
    const progress = state.getProgress();
    expect(progress.completed).toBe(3);
    expect(progress.total).toBe(5);
    expect(progress.completed).toBeGreaterThan(0);
  });

  it("getResumeState returns correct completed/failed sets", async () => {
    const mission = makeMission();
    const del1 = createDelegation(mission.id, "obj-1", "Step 1", "desc", "game", { acceptanceCriteria: ["c1"] });
    const del2 = createDelegation(mission.id, "obj-1", "Step 2", "desc", "game", { dependsOn: [del1.id], acceptanceCriteria: ["c2"] });
    const del3 = createDelegation(mission.id, "obj-1", "Step 3", "desc", "game", { dependsOn: [del2.id], acceptanceCriteria: ["c3"] });

    const customPlan = createExecutionPlan(
      mission,
      [{ id: "obj-1", title: "Test", description: "Test", delegations: [del1.id, del2.id, del3.id] }],
      [del1, del2, del3],
      [],
      []
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(customPlan);
    for (const del of customPlan.delegations) {
      await state.addDelegation(del);
    }

    // Set different statuses
    await state.completeDelegation(del1.id, "passed", "Done");
    await state.completeDelegation(del2.id, "failed", "", "Error");
    // del3 stays queued

    const resumeState = state.getResumeState();
    expect(resumeState.completed.has(del1.id)).toBe(true);
    expect(resumeState.failed.has(del2.id)).toBe(true);
    expect(resumeState.completed.has(del3.id)).toBe(false);
    expect(resumeState.failed.has(del3.id)).toBe(false);
  });
});

// ─── Partial artifact continuation ───────────────────────────────────

describe("partial artifact continuation", () => {
  it("detects partially produced artifacts via hasDelegationArtifact", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "Build game", "game", {
      acceptanceCriteria: ["Build works"],
    });
    await state.addDelegation(del);

    // No artifact yet
    expect(state.hasDelegationArtifact(del.id)).toBe(false);

    // Complete with result (simulates partial output)
    await state.completeDelegation(del.id, "failed", "Partial output: created file but build failed");
    expect(state.hasDelegationArtifact(del.id)).toBe(true);
  });

  it("returns resumable delegations correctly", async () => {
    const mission = makeMission();
    const del1 = createDelegation(mission.id, "obj-1", "Step 1", "desc", "game", { acceptanceCriteria: ["c1"] });
    const del2 = createDelegation(mission.id, "obj-1", "Step 2", "desc", "game", { dependsOn: [del1.id], acceptanceCriteria: ["c2"] });
    const del3 = createDelegation(mission.id, "obj-1", "Step 3", "desc", "game", { dependsOn: [del2.id], acceptanceCriteria: ["c3"] });

    const customPlan = createExecutionPlan(
      mission,
      [{ id: "obj-1", title: "Test", description: "Test", delegations: [del1.id, del2.id, del3.id] }],
      [del1, del2, del3],
      [],
      []
    );

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.setPlan(customPlan);
    for (const del of customPlan.delegations) {
      await state.addDelegation(del);
    }

    await state.completeDelegation(del1.id, "passed", "Done");
    await state.completeDelegation(del2.id, "failed", "", "Error");
    // del3 stays queued

    const resumable = state.getResumableDelegations();
    expect(resumable.length).toBe(2); // del2 (failed) and del3 (queued)
    expect(resumable.some((d) => d.id === del1.id)).toBe(false); // passed — not resumable
    expect(resumable.some((d) => d.id === del2.id)).toBe(true);
    expect(resumable.some((d) => d.id === del3.id)).toBe(true);
  });
});

// ─── Resume preserves delegation state ───────────────────────────────

describe("resume preserves delegation state", () => {
  it("preserves delegation inputs and outputs across resume", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "Build game", "game", {
      acceptanceCriteria: ["Build works"],
      inputs: [{ id: "art-1", delegationId: "prev-del", type: "research", title: "Market Research", summary: "Market data", createdByRole: "Researcher", createdAt: new Date().toISOString() }],
    });
    // Manually set outputs since we can't reference del.id before it exists
    del.outputs = [{ id: "art-2", delegationId: del.id, type: "code", path: "src/game.ts", title: "Game Code", summary: "Main game file", createdByRole: "Developer", createdAt: new Date().toISOString() }];
    await state.addDelegation(del);
    await state.completeDelegation(del.id, "passed", "Build complete");

    // Reload from disk
    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const reloaded = state2.getDelegation(del.id);
    expect(reloaded?.inputs?.length).toBe(1);
    expect(reloaded?.inputs?.[0].title).toBe("Market Research");
    expect(reloaded?.outputs?.length).toBe(1);
    expect(reloaded?.outputs?.[0].path).toBe("src/game.ts");
  });

  it("preserves retryOf chain across resume", async () => {
    const mission = makeMission();
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const original = createDelegation(mission.id, "obj-1", "Build", "Build game", "game", {
      acceptanceCriteria: ["Build works"],
    });
    await state.addDelegation(original);

    const retry = createDelegation(mission.id, "obj-1", "Build (retry)", "Build game retry", "game", {
      dependsOn: [],
      acceptanceCriteria: ["Build works"],
      retryOf: original.id,
    });
    await state.addDelegation(retry);
    await state.completeDelegation(original.id, "failed", "", "Build failed");
    await state.completeDelegation(retry.id, "passed", "Build complete");

    // Reload from disk
    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const reloadedRetry = state2.getDelegation(retry.id);
    expect(reloadedRetry?.retryOf).toBe(original.id);
    expect(reloadedRetry?.status).toBe("passed");
  });
});
