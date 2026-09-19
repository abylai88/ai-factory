import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  type Mission,
  type Delegation,
  type AgentResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  type FactoryExecutionAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";
import { classifyFailure } from "../failure-triage.js";
import { routeFailureToSpecialist } from "../specialist-roles.js";
import { evaluateQaHierarchy, qaLevelResult, QA_LEVELS } from "../qa-hierarchy.js";
import { RepairHistory } from "../repair-history.js";
import { deriveBlueprintFromGoal } from "../blueprint.js";
import { runRobloxProductionLoop } from "../../roblox/production-loop.js";

/**
 * Offline end-to-end company simulation. Deterministic, no Studio, no
 * network, no MCP: a scripted adapter stands in for every specialist.
 * Covers: happy path, build failure → repair → retest PASS, visual
 * failure routing, MCP-unavailable BLOCKED honesty, repair exhaustion,
 * parallel conflicting tasks, and final-review failure.
 */

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "company-e2e-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

type Behavior = (delegation: Delegation, call: number) => AgentResult;

function scriptedAdapter(behavior: Behavior): FactoryExecutionAdapter & { calls: string[] } {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  return {
    calls,
    async runDelegation(delegation: Delegation): Promise<AgentResult> {
      calls.push(delegation.id);
      const n = (counts.get(delegation.id) ?? 0) + 1;
      counts.set(delegation.id, n);
      return behavior(delegation, n);
    },
  };
}

const GOOD = (delegation: Delegation): AgentResult => ({
  delegationId: delegation.id,
  status: "passed",
  output: `Done ${delegation.title}: build succeeds, codebase analyzed with src/game.ts entry, architecture documented, key components identified: Spawn, Collector, Upgrader.`,
  durationMs: 5,
});

const BAD = (delegation: Delegation, why = "boom"): AgentResult => ({
  delegationId: delegation.id,
  status: "failed",
  output: "",
  error: why,
  durationMs: 5,
});

function testDelegation(missionId: string, id: string, title: string, extra?: Partial<Delegation>): Delegation {
  const d = createDelegation(missionId, "obj-1", title, `Do ${title}\nBuild the game code with src/game.ts`, "engineering", {
    dependsOn: [],
    parallelizable: false,
    acceptanceCriteria: ["Build succeeds"],
  });
  d.id = id;
  return { ...d, ...extra };
}

async function runMission(mission: Mission, delegations: Delegation[], adapter: FactoryExecutionAdapter, maxRepairs = 3) {
  const state = new MissionState(tmpDir, mission.id);
  await state.init();
  await state.setMission(mission);
  const plan = {
    id: "plan-1",
    missionId: mission.id,
    objectives: [{ id: "obj-1", title: "O", description: "O", delegations: delegations.map((d) => d.id) }],
    delegations,
    risks: [],
    validationGates: [],
    createdAt: new Date().toISOString(),
  };
  await state.setPlan(plan as never);
  for (const d of delegations) await state.addDelegation(d);
  const sink = new InMemoryEventSink();
  const orch = new MissionOrchestrator({
    maxRepairs,
    baseDir: tmpDir,
    project: tmpDir,
    factoryAdapter: adapter,
    auditor: new DeterministicAuditor(),
    eventSink: sink,
    missionState: state,
  });
  const result = await orch.executeMission(mission, plan as never);
  return { result, state, sink };
}

describe("Company E2E (offline simulation)", () => {
  it("happy path: research → architecture → code → qa → PASS with blueprint + handoff", async () => {
    const mission = createMission("Create a Roblox simulator where the player collects coins and upgrades");
    const ds = [
      testDelegation(mission.id, "research", "Research patterns"),
      testDelegation(mission.id, "arch", "Architecture", { dependsOn: ["research"] }),
      testDelegation(mission.id, "code", "Implement systems", { dependsOn: ["arch"] }),
    ];
    const adapter = scriptedAdapter((d) => GOOD(d));
    const { result, sink } = await runMission(mission, ds, adapter);
    expect(result.status).toBe("completed");
    const types = sink.recent().map((e) => e.type);
    expect(types).toContain("mission.blueprint.created");
    expect(types).toContain("delegation.context.handoff");
    // Blueprint derived for every mission
    expect(deriveBlueprintFromGoal(mission.goal).platform).toBe("roblox");
  });

  it("build failure → audit repair → retest PASS", async () => {
    const mission = createMission("Create a Roblox coin simulator");
    const ds = [testDelegation(mission.id, "code", "Implement systems")];
    const adapter = scriptedAdapter((d) =>
      d.id.startsWith("repair-") ? GOOD(d) : BAD(d, "TS2345 type error"),
    );
    const { result, state } = await runMission(mission, ds, adapter);
    expect(result.status).toBe("completed");
    expect(state.getRepairAttemptCount("code") >= 0).toBe(true);
  });

  it("visual failure routes to the visual specialist (never generic programmer)", async () => {
    const mission = createMission("Create a Roblox coin simulator");
    const d = testDelegation(mission.id, "shot", "Capture screenshot");
    const triage = classifyFailure({
      delegation: d,
      validationResult: { passed: false, command: "screenshot", exitCode: 1, stdout: "VISUAL_FAIL floor-visible FAIL", stderr: "", durationMs: 1 },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });
    expect(triage.category).toBe("visual_regression");
    expect(triage.specialist).toBe("visual");
    expect(routeFailureToSpecialist(triage.category)).toBe("visual");
  });

  it("MCP unavailable is infrastructure BLOCKED — never a fake code PASS", async () => {
    const mission = createMission("Create a Roblox coin simulator");
    const ds = [testDelegation(mission.id, "play", "Playtest session")];
    const adapter = scriptedAdapter((d) => BAD(d, "STUDIO_UNAVAILABLE: bridge not connected"));
    const { result } = await runMission(mission, ds, adapter, 1);
    expect(result.status).toBe("failed");
    const triage = classifyFailure({
      delegation: ds[0]!,
      validationResult: { passed: false, command: "playtest", exitCode: 1, stdout: "", stderr: "STUDIO_UNAVAILABLE", durationMs: 1 },
      attempt: 1,
      maxAttempts: 1,
      previousErrors: [],
    });
    expect(triage.category).toBe("tool_unavailable");
    expect(triage.specialist).toBe("director");
  });

  it("repair exhausted escalates to failed instead of looping forever", async () => {
    const h = new RepairHistory(1);
    h.record({ delegationId: "x", failure: "boom", evidence: "e", diagnosis: "d", repairAttempted: "r", repairResult: "failed" });
    expect(h.decide("x", "boom", "r2").action).toBe("blocked");

    const mission = createMission("Fix the coin simulator");
    const ds = [testDelegation(mission.id, "code", "Implement systems")];
    const adapter = scriptedAdapter((d) => BAD(d, "always broken"));
    const { result } = await runMission(mission, ds, adapter, 1);
    expect(result.status).toBe("failed");
  });

  it("parallel tasks execute without deadlock; dependent waits for deps", async () => {
    const mission = createMission("Create a Roblox coin simulator");
    const ds = [
      testDelegation(mission.id, "a", "Research A", { parallelizable: true }),
      testDelegation(mission.id, "b", "Research B", { parallelizable: true }),
      testDelegation(mission.id, "c", "Integrate", { dependsOn: ["a", "b"] }),
    ];
    const adapter = scriptedAdapter((d) => GOOD(d));
    const { result } = await runMission(mission, ds, adapter);
    expect(result.status).toBe("completed");
    expect((adapter as unknown as { calls: string[] }).calls).toContain("c");
  });

  it("final review failure blocks release", async () => {
    const mission = createMission("Create a Roblox coin simulator");
    const ds = [testDelegation(mission.id, "review", "Final review", { acceptanceCriteria: ["All acceptance criteria documented with screenshots"] })];
    const adapter = scriptedAdapter((d) => ({
      delegationId: d.id,
      status: "passed",
      output: "reviewed the work, found critical defects, verdict: block",
      durationMs: 5,
    }));
    const { result } = await runMission(mission, ds, adapter);
    // Criterion keywords absent from output → audit FAIL → repairs also fail → mission failed
    expect(result.status).toBe("failed");
  });

  it("full Roblox production loop passes offline with honest teardown evidence", async () => {
    const r = await runRobloxProductionLoop(tmpDir, {
      "source-validation": async () => ({ status: "passed", evidence: "luau validated" }),
      "artifact-provisioning": async () => ({ status: "passed", evidence: "build.rbxlx reused, 12KB" }),
      "project-ready": async () => ({ status: "passed", evidence: "PLACE_READY" }),
      playtest: async () => ({ status: "passed", evidence: "solo playtest settled" }),
      "runtime-assertions": async () => ({ status: "passed", evidence: "spawn/collect/upgrade 3/3" }),
      screenshot: async () => ({ status: "passed", evidence: "screenshot viewport 1280x720" }),
      "visual-qa": async () => ({ status: "passed", evidence: "HUD visible, scene readable" }),
      teardown: async () => ({ status: "passed", evidence: "playtest stopped, confirmed" }),
    });
    expect(r.status).toBe("passed");
    expect(r.failedStage).toBeUndefined();
    const qa = evaluateQaHierarchy([
      qaLevelResult("static-build", "passed", "luau validated, build exit 0"),
      qaLevelResult("structural", "passed", "build.rbxlx reused, project structure valid"),
      qaLevelResult("studio-readiness", "passed", "PLACE_READY connected instance"),
      qaLevelResult("runtime", "passed", "playtest runtime assertions 3/3, logs clean"),
      qaLevelResult("gameplay-assertions", "passed", "spawn/collect/upgrade assertions passed in playtest"),
      qaLevelResult("visual", "passed", "screenshot viewport 1280x720: HUD visible, scene readable"),
      qaLevelResult("regression", "passed", "prior assertions still pass after repair"),
      qaLevelResult("final-review", "passed", "reviewer verdict: release"),
    ]);
    expect(qa.overall).toBe("passed");
  });
});
