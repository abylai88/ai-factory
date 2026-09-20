import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation, type Delegation, type AgentResult } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator } from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";
import {
  runProductionQualityStage,
  reviewDimensionEvidence,
  defaultQualityReview,
  type QualityStageReview,
} from "../quality-stage.js";
import { buildQualityCriticEvidence } from "../quality-context.js";
import { runVisualCritic, type QualityFinding } from "../quality-critics.js";
import { triageQualityFinding } from "../failure-triage.js";
import { routeQualityFindingToSpecialist } from "../specialist-roles.js";
import { evaluateProductionQualityGate } from "../quality-gate.js";
import { captureQualityScreenshot } from "../../roblox/quality-screenshot.js";
import { collectStarterGuiEvidence } from "../../roblox/ui-evidence.js";
import { runQualityBenchmark } from "../quality-benchmark.js";
import { deriveBlueprintFromGoal } from "../blueprint.js";
import { deriveQualityContract } from "../quality-contract.js";
import { sanitizeForPersistence } from "../persisted-memory.js";
import { scrubEphemeralIds } from "../readiness-evidence.js";
import { createAuditResult } from "../mission.js";

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "quality-orch-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function finding(overrides?: Partial<QualityFinding>): QualityFinding {
  return {
    id: `QF-TE-${Math.random().toString(36).slice(0, 6)}`,
    dimension: "ux",
    severity: "major",
    evidence: "UI hierarchy shows three identical buttons with no labels",
    affectedArea: "Upgrade UI",
    violatedRequirement: "ux-hierarchy",
    why: "Primary upgrade action is visually indistinguishable from secondary navigation.",
    proposedOwner: "ui",
    repairObjective: "Restyle the primary upgrade button distinctly from secondary navigation.",
    verificationRequirement: "Inspect UI hierarchy after repair: primary vs secondary distinct.",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function passReview(): QualityStageReview {
  const at = new Date().toISOString();
  const mk = (dimension: "visual" | "ux" | "gameplay" | "technical") => ({
    dimension,
    status: "pass" as const,
    findings: [],
    evidenceNotes: [`${dimension} evidenced`],
    reviewedAt: at,
  });
  const reviews = [mk("visual"), mk("ux"), mk("gameplay"), mk("technical")];
  return { reviews, findings: [] };
}

const strongFunctional = {
  functionalPass: true,
  functionalEvidence: "test delegation graph passed",
  runtimePass: true,
  runtimeEvidence: "test assertions 3/3 pass",
};

// ── Fakes ──────────────────────────────────────────────────────────

function fakeBridge(scenario: "ok" | "disconnected" | "capture-fails" | "structure-fails") {
  return {
    discover: async () =>
      scenario === "disconnected"
        ? { pluginConnected: false, message: "MCP reachable but no Studio instance connected" }
        : { pluginConnected: true, message: "studio connected via MCP (1 instance(s))" },
    callTool: async (tool: string, _params: Record<string, unknown> = {}) => {
      if (tool === "capture_screenshot") {
        if (scenario === "capture-fails") {
          return { ok: false, message: "Studio minimized (instance:abc123); screenshot unavailable" };
        }
        return {
          ok: true,
          message: "screenshot captured",
          stdout: JSON.stringify({ screenshotPath: "/tmp/shots/screenshot-123.png" }),
          data: { screenshotPath: "/tmp/shots/screenshot-123.png" },
        };
      }
      if (tool === "get_project_structure") {
        if (scenario === "structure-fails") {
          return { ok: false, message: "project structure failed: no instance (peer:xyz)" };
        }
        if ((_params.path as string) === "game.StarterGui") {
          return {
            ok: true,
            message: "project structure read",
            stdout:
              "game.StarterGui.MainHud (ScreenGui) game.StarterGui.MainHud.CoinLabel (TextLabel) " +
              "game.StarterGui.MainHud.UpgradeButton (TextButton) game.StarterGui.ShopMenu (Frame)",
          };
        }
        return { ok: true, message: "structure read", stdout: "game.Workspace.BasePlate (Part)" };
      }
      if (tool === "get_properties") {
        return {
          ok: true,
          message: "properties read",
          stdout: JSON.stringify({ className: "TextButton", Name: "UpgradeButton", Visible: true, Text: "Upgrade" }),
        };
      }
      return { ok: false, message: `unknown tool ${tool}` };
    },
  };
}

const passingAdapter = {
  runDelegation: async (delegation: Delegation): Promise<AgentResult> => ({
    delegationId: delegation.id,
    status: "passed" as const,
    output: "implementation complete: done",
    durationMs: 1,
  }),
};

const passingAuditor = {
  audit: async (delegation: Delegation) =>
    createAuditResult(delegation.id, "PASS", "ok", [], [
      { criterion: "done", passed: true, evidence: "ok" },
    ]),
};

async function runMissionWithQuality(opts: {
  review?: () => QualityStageReview | Promise<QualityStageReview>;
  repairOne?: (task: never, f: QualityFinding) => Promise<{ fixed: boolean; note: string }>;
  functional?: typeof strongFunctional;
  maxRounds?: number;
}): Promise<{ mission: ReturnType<MissionState["getMission"]>; state: MissionState }> {
  const mission = createMission("Create a Roblox coin simulator with upgrades");
  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const state = new MissionState(stateDir, mission.id);
  await state.init();
  await state.setMission(mission);
  const del = createDelegation(
    mission.id,
    "obj-1",
    "Implement collect system",
    "ROLE: developer\nImplement the collect system end to end",
    "engineering",
    {
      stepIds: [],
      dependsOn: [],
      acceptanceCriteria: ["done"],
      role: "Developer",
      requiresReview: false,
    },
  );
  const plan = {
    id: "plan-q",
    missionId: mission.id,
    objectives: [{ id: "obj-1", title: "Build", description: "build", delegations: [del.id] }],
    delegations: [del],
    risks: [],
    validationGates: [],
    createdAt: new Date().toISOString(),
  };
  await state.setPlan(plan);
  await state.addDelegation(del);
  const orchestrator = new MissionOrchestrator({
    maxRepairs: 1,
    baseDir: tmpDir,
    project: path.join(tmpDir, "proj"),
    factoryAdapter: passingAdapter,
    auditor: passingAuditor,
    eventSink: new InMemoryEventSink(),
    missionState: state,
    qualityStage: {
      enabled: true,
      maxRounds: opts.maxRounds ?? 1,
      repairBudget: 1,
      functional: opts.functional,
      review: opts.review,
      repairOne: opts.repairOne as never,
    },
  });
  const result = await orchestrator.executeMission(mission, plan as never);
  return { mission: result, state };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("automatic quality stage", () => {
  it("mission automatically reaches QUALITY_REVIEW and completes on gate PASS", async () => {
    const { mission, state } = await runMissionWithQuality({
      review: async () => passReview(),
      functional: strongFunctional,
    });
    expect(mission.status).toBe("completed");
    const stage = state.getQualityStage();
    expect(stage?.status).toBe("passed");
    expect(stage?.productionPass).toBe(true);
  });

  it("mission fails honestly when findings cannot be repaired", async () => {
    const bad = finding({ severity: "blocking", proposedOwner: "programmer" });
    const { mission, state } = await runMissionWithQuality({
      review: async () => ({
        reviews: passReview().reviews,
        findings: [bad],
      }),
      repairOne: async () => ({ fixed: false, note: "still broken" }),
    });
    expect(mission.status).toBe("failed");
    expect(state.getQualityStage()?.status).toBe("blocked");
    expect(state.getQualityFindings()[0]?.status).toBe("escalated");
  });

  it("refuses quality review before implementation evidence exists", async () => {
    const outcome = await runProductionQualityStage(
      {
        review: async () => passReview(),
        repairOne: async () => ({ fixed: true, note: "n/a" }),
      },
      {
        functional: {
          functionalPass: false,
          functionalEvidence: "",
          runtimePass: false,
          runtimeEvidence: "",
        },
        missionId: "no-evidence",
      },
    );
    expect(outcome.stage).toBe("blocked");
    expect(outcome.rounds).toBe(0);
    expect(outcome.gate.productionPass).toBe(false);
  });

  it("creates a targeted specialist repair delegation (never generic polish)", async () => {
    const uiFinding = finding({ proposedOwner: "ui" });
    const { mission, state } = await runMissionWithQuality({
      maxRounds: 2,
      functional: strongFunctional,
      review: (() => {
        let n = 0;
        return async () => {
          n += 1;
          // First review finds the defect; post-repair re-review is clean.
          return n === 1 ? { reviews: passReview().reviews, findings: [uiFinding] } : passReview();
        };
      })(),
    });
    expect(mission.status).toBe("completed");
    const repairs = state.getDelegations().filter((d) => d.id.startsWith("quality-repair-"));
    expect(repairs.length).toBeGreaterThan(0);
    expect(repairs[0]?.title).toContain("ui");
    expect(repairs[0]?.description).not.toMatch(/polish the game/i);
    const stored = state.getQualityFindings().find((f) => f.id === uiFinding.id);
    expect(stored?.repairDelegationId).toBe(repairs[0]?.id);
    expect(stored?.status).toBe("fixed");
  });
});

describe("stage and event persistence", () => {
  it("quality stage status survives reload and resume keeps findings", async () => {
    const mission = createMission("quality persistence probe");
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.recordQualityFinding({
      id: "QF-P-1",
      dimension: "visual",
      severity: "major",
      evidence: "graybox scene",
      violatedRequirement: "visual-identity",
      why: "Scene reads as default graybox with enough detail to persist.",
      proposedOwner: "visual",
      repairObjective: "Apply zone palettes concretely.",
      verificationRequirement: "Re-inspect palettes.",
    });
    await state.recordQualityStage({
      status: "repairing",
      rounds: 1,
      summary: "QUALITY_REPAIR round 1",
      productionPass: false,
    });
    const reloaded = new MissionState(tmpDir, mission.id);
    await reloaded.init();
    expect(reloaded.getQualityStage()?.status).toBe("repairing");
    expect(reloaded.getQualityFindings()).toHaveLength(1);
    await reloaded.prepareForResume();
    expect(reloaded.getQualityStage()?.status).toBe("repairing");
    expect(reloaded.getQualityFindings()).toHaveLength(1);
  });
});

describe("quality context handoff", () => {
  it("routes selective evidence per critic (no broadcast of everything)", () => {
    const blueprint = deriveBlueprintFromGoal("Create a Roblox coin simulator with upgrades");
    const contract = deriveQualityContract(blueprint);
    const per = buildQualityCriticEvidence({
      blueprint,
      directorVisionText: "Fantasy: rising collector",
      contract,
      artifactSummaries: ["- CollectService (src/Collect.server.luau): server currency"],
      sceneSummary: "Workspace: SpawnLocation + BasePlate",
      uiInventory: "StarterGui HUD with CoinCount",
      runtimeSummary: "playtest PASS assertions 3/3",
      screenshotRef: "screenshot-1.png",
    });
    expect(per.visual.screenshotRef).toBe("screenshot-1.png");
    expect(JSON.stringify(per.technical)).not.toContain("screenshot-1.png");
    expect(JSON.stringify(per.ux)).toContain("StarterGui");
    expect(JSON.stringify(per.gameplay)).toContain("assertions");
  });

  it("dimension-aware review keeps critics on their own evidence", () => {
    const blueprint = deriveBlueprintFromGoal("Create a Roblox coin simulator");
    const contract = deriveQualityContract(blueprint);
    const per = buildQualityCriticEvidence({
      blueprint,
      contract,
      sceneSummary: "SpawnLocation + gold/teal coin field + zone gates",
      screenshotRef: "viewport.png: bright coin field, readable HUD",
      runtimeSummary: "playtest PASS; collect/upgrade assertions 4/4; reward feedback tick; spawn safe floor + SpawnLocation; first-minute onboarding",
      uiInventory: "StarterGui HUD with CoinCount + ObjectiveLabel + UpgradeButton",
    });
    const { reviews } = reviewDimensionEvidence(per, contract);
    expect(reviews).toHaveLength(4);
    expect(reviews.find((r) => r.dimension === "visual")?.status).toBe("pass");
  });
});

describe("screenshot evidence plumbing", () => {
  it("captures a real reference with stage metadata when Studio is connected", async () => {
    const ev = await captureQualityScreenshot(fakeBridge("ok") as never, {
      project: "coin-sim",
      missionId: "m-1",
      stage: "quality-review",
      contextLabel: "spawn view",
    });
    expect(ev.status).toBe("captured");
    expect(ev.ref).toBe("screenshot-123.png");
    expect(ev.stage).toBe("quality-review");
    expect(ev.capturedAt.length).toBeGreaterThan(0);
  });

  it("reports unavailable honestly when Studio is disconnected or capture fails", async () => {
    const disc = await captureQualityScreenshot(fakeBridge("disconnected") as never, {
      project: "coin-sim",
      missionId: "m-1",
      stage: "quality-review",
    });
    expect(disc.status).toBe("unavailable");
    expect(disc.ref).toBeUndefined();
    const fail = await captureQualityScreenshot(fakeBridge("capture-fails") as never, {
      project: "coin-sim",
      missionId: "m-1",
      stage: "quality-review",
    });
    expect(fail.status).toBe("unavailable");
    expect(fail.detail).not.toContain("abc123");
    const none = await captureQualityScreenshot(undefined, {
      project: "coin-sim",
      missionId: "m-1",
      stage: "quality-review",
    });
    expect(none.status).toBe("unavailable");
  });

  it("visual critic stays VISUAL_UNAVAILABLE without a screenshot (never fake PASS)", () => {
    const review = runVisualCritic({ sceneSummary: "SpawnLocation + BasePlate" });
    expect(review.status).toBe("unavailable");
    expect(review.status).not.toBe("pass");
  });
});

describe("StarterGui evidence", () => {
  it("collects bounded UI inventory from StarterGui", async () => {
    const ev = await collectStarterGuiEvidence(fakeBridge("ok") as never);
    expect(ev.status).toBe("captured");
    expect(ev.uiInventory).toContain("ScreenGui");
    expect(ev.uiInventory).toContain("UpgradeButton");
  });

  it("reports unavailable honestly and bounds node reads", async () => {
    const ev = await collectStarterGuiEvidence(fakeBridge("structure-fails") as never);
    expect(ev.status).toBe("unavailable");
    expect(ev.detail).not.toContain("peer:xyz");
    expect(ev.detail).not.toContain("xyz");
  });

  it("default review consumes UI inventory as UX evidence", () => {
    const review = defaultQualityReview({
      sources: ["UI hierarchy: StarterGui HUD with CoinCount + UpgradeButton, button states defined"],
      sceneSummary: "Workspace ok",
    });
    expect(review.reviews.find((r) => r.dimension === "ux")).toBeDefined();
  });
});

describe("finding routing and targeted repair", () => {
  it("routes each quality dimension to its owning specialist", () => {
    expect(routeQualityFindingToSpecialist({ dimension: "visual" })).toBe("visual");
    expect(routeQualityFindingToSpecialist({ dimension: "ux" })).toBe("ui");
    expect(routeQualityFindingToSpecialist({ dimension: "gameplay" })).toBe("gameplay");
    expect(routeQualityFindingToSpecialist({ dimension: "technical" })).toBe("programmer");
    const t = triageQualityFinding({
      findingId: "QF-1",
      dimension: "ux",
      severity: "major",
      violatedRequirement: "ux-hierarchy",
      proposedOwner: "ui",
    });
    expect(t.specialist).toBe("ui");
    expect(t.action).toBe("repair");
  });

  it("repair tasks carry concrete objectives (no vague polish)", async () => {
    const outcome = await runProductionQualityStage(
      {
        review: async () => ({ reviews: passReview().reviews, findings: [finding()] }),
        repairOne: async (task) => {
          expect(task.specialist).toBe("ui");
          expect(task.objective.length).toBeGreaterThan(20);
          expect(task.verification.length).toBeGreaterThan(20);
          expect(task.objective).not.toMatch(/polish the game/i);
          return { fixed: false, note: "still flat" };
        },
      },
      { functional: strongFunctional, maxRounds: 1, missionId: "routing-probe" },
    );
    expect(outcome.repairTasks[0]?.specialist).toBe("ui");
    expect(outcome.stage).toBe("blocked");
  });
});

describe("re-evaluation", () => {
  it("a claimed fix only counts when re-review evidence confirms it", async () => {
    let n = 0;
    const outcome = await runProductionQualityStage(
      {
        review: async () => {
          n += 1;
          if (n === 1) return { reviews: passReview().reviews, findings: [finding({ id: "QF-REEVAL" })] };
          return passReview();
        },
        repairOne: async () => ({ fixed: true, note: "restyled" }),
      },
      { functional: strongFunctional, maxRounds: 2, missionId: "reeval" },
    );
    expect(outcome.stage).toBe("passed");
    expect(outcome.resolved.map((f) => f.id)).toContain("QF-REEVAL");
    expect(outcome.rounds).toBeGreaterThanOrEqual(1);
  });

  it("a repair claim without evidence change reopens instead of passing", async () => {
    const outcome = await runProductionQualityStage(
      {
        review: async () => ({ reviews: passReview().reviews, findings: [finding({ id: "QF-STUCK" })] }),
        repairOne: async () => ({ fixed: true, note: "agent claims done" }),
      },
      { functional: strongFunctional, maxRounds: 1, missionId: "reopen" },
    );
    expect(outcome.stage).toBe("blocked");
    expect(outcome.escalated.map((f) => f.id)).toContain("QF-STUCK");
  });
});

describe("quality gate", () => {
  it("passes only with functional + runtime + evidenced dimensions and no required findings", () => {
    const gate = evaluateProductionQualityGate({
      functional: strongFunctional,
      reviews: passReview().reviews,
      unresolvedFindings: [],
    });
    expect(gate.productionPass).toBe(true);
    const blocked = evaluateProductionQualityGate({
      functional: strongFunctional,
      reviews: passReview().reviews,
      unresolvedFindings: [finding({ severity: "major" })],
    });
    expect(blocked.productionPass).toBe(false);
  });

  it("unavailable visual evidence blocks production (never silent PASS)", () => {
    const gate = evaluateProductionQualityGate({
      functional: strongFunctional,
      reviews: passReview().reviews.filter((r) => r.dimension !== "visual"),
      unresolvedFindings: [],
    });
    expect(gate.dimensions.find((d) => d.dimension === "visual")?.status).toBe("unavailable");
    expect(gate.productionPass).toBe(false);
  });
});

describe("quality benchmark", () => {
  it("rejects the weak game, maps owners, repairs to PASS; strong passes clean", async () => {
    const result = await runQualityBenchmark();
    expect(result.weak.initialFindingCount).toBeGreaterThanOrEqual(3);
    expect(result.weak.owners.length).toBeGreaterThanOrEqual(2);
    expect(result.weak.gateInitiallyPass).toBe(false);
    expect(result.weak.final.stage).toBe("passed");
    expect(result.weak.final.gate.productionPass).toBe(true);
    expect(result.strong.stage).toBe("passed");
    expect(result.strong.unresolved).toHaveLength(0);
  });
});

describe("secret and ephemeral scrubbing", () => {
  it("never persists tokens, peer/instance IDs, or raw transcripts", async () => {
    expect(scrubEphemeralIds("Studio (instance:abc peer:xyz launch:qrs)")).not.toContain("abc");
    const sanitized = sanitizeForPersistence({
      ref: "screenshot-1.png",
      instanceId: "ephemeral-1",
      authToken: "secret",
      nested: { peerId: "p-1", note: "keep" },
    }) as Record<string, unknown>;
    expect("instanceId" in sanitized).toBe(false);
    expect("authToken" in sanitized).toBe(false);
    expect((sanitized.nested as Record<string, unknown>).note).toBe("keep");

    const mission = createMission("scrub probe");
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.recordQualityStage({ status: "passed", rounds: 0, summary: "PASS", productionPass: true });
    const snap = await fs.readFile(path.join(tmpDir, "outputs", "missions", `${mission.id}.state.json`), "utf8");
    expect(snap).not.toMatch(/authToken|peerId|instanceId/);
  });
});
