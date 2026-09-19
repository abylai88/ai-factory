import { describe, it, expect } from "vitest";
import { deriveBlueprintFromGoal, validateBlueprint, blueprintSliceForRole } from "../blueprint.js";
import { buildDirectorVision, renderDirectorVision } from "../director-vision.js";
import { buildRoleHandoff } from "../context-handoff.js";
import {
  HANDOFF_CONTRACTS,
  SPECIALIST_ROLES,
  coreRoleForSpecialist,
  isSpecialistRole,
  routeFailureToSpecialist,
  routeFailureTextToSpecialist,
} from "../specialist-roles.js";
import { evaluateQaHierarchy, qaLevelResult, QA_LEVELS } from "../qa-hierarchy.js";
import { RepairHistory } from "../repair-history.js";
import { ConcurrencyGate, projectLockName, studioLockName } from "../resource-control.js";
import { buildHermesStatus, toHermesStage } from "../../hermes/status.js";
import { runRobloxProductionLoop } from "../../roblox/production-loop.js";
import { chooseModelForComplexity, classifyTaskComplexity } from "../../model-router/router.js";

describe("Production Blueprint", () => {
  it("derives structured data from a simulator goal", () => {
    const bp = deriveBlueprintFromGoal(
      "Create a Roblox simulator where the player mines resources, upgrades tools, unlocks zones",
    );
    expect(bp.platform).toBe("roblox");
    expect(bp.genre).toBe("simulator");
    expect(bp.coreLoop).toContain("upgrade");
    expect(bp.requiredSystems.length).toBeGreaterThan(0);
    expect(bp.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(bp.qaCriteria.length).toBeGreaterThan(0);
    expect(() => validateBlueprint(bp)).not.toThrow();
  });

  it("rejects empty goals", () => {
    expect(() => deriveBlueprintFromGoal("")).toThrow();
    expect(() => validateBlueprint({})).toThrow();
  });

  it("serves role-specific slices", () => {
    const bp = deriveBlueprintFromGoal("Create a Roblox coin simulator");
    const prog = blueprintSliceForRole(bp, "programmer");
    expect(prog).toContain("Architecture");
    const vis = blueprintSliceForRole(bp, "visual");
    expect(vis).toContain("Visual");
    const qa = blueprintSliceForRole(bp, "qa");
    expect(qa).toContain("Acceptance");
  });
});

describe("Director vision", () => {
  it("builds frozen-core vision from blueprint", () => {
    const bp = deriveBlueprintFromGoal("Create a Roblox coin simulator");
    const v = buildDirectorVision(bp, "fast feedback + visible progression");
    expect(v.frozenCore).toContain(bp.coreLoop);
    expect(v.milestones.length).toBeGreaterThan(0);
    expect(renderDirectorVision(v)).toContain("DIRECTOR VISION");
  });
});

describe("Context handoff", () => {
  it("builds bounded role-specific blocks", () => {
    const bp = deriveBlueprintFromGoal("Create a Roblox coin simulator");
    const prog = buildRoleHandoff({
      role: "programmer",
      taskTitle: "Implement collect system",
      blueprint: bp,
      knownBugs: ["spawn missing"],
      acceptanceCriteria: ["player can spawn"],
    });
    expect(prog).toContain("ROLE: programmer");
    expect(prog).toContain("BLUEPRINT");
    expect(prog).toContain("KNOWN BUGS");
    const qa = buildRoleHandoff({
      role: "qa",
      taskTitle: "Run runtime QA",
      blueprint: bp,
      acceptanceCriteria: ["player can spawn"],
      evidence: ["screenshot.png"],
    });
    expect(qa).toContain("ACCEPTANCE CRITERIA");
    expect(qa).toContain("EVIDENCE");
  });

  it("never dumps unbounded content", () => {
    const big = "x".repeat(100_000);
    const out = buildRoleHandoff({ role: "qa", taskTitle: big, acceptanceCriteria: [big] });
    expect(out.length).toBeLessThan(20_000);
  });
});

describe("Specialist delegation", () => {
  it("covers all 13 specialists with handoff contracts", () => {
    expect(SPECIALIST_ROLES.length).toBe(13);
    for (const s of SPECIALIST_ROLES) {
      expect(HANDOFF_CONTRACTS[s].receives.length).toBeGreaterThan(0);
      expect(HANDOFF_CONTRACTS[s].produces.length).toBeGreaterThan(0);
      expect(isSpecialistRole(s)).toBe(true);
    }
    expect(coreRoleForSpecialist("programmer")).toBe("Developer");
    expect(coreRoleForSpecialist("qa")).toBe("QA");
  });

  it("routes failures to specialists, not generic programmer", () => {
    expect(routeFailureToSpecialist("visual_regression")).toBe("visual");
    expect(routeFailureToSpecialist("roblox_runtime")).toBe("gameplay");
    expect(routeFailureToSpecialist("build_config")).toBe("architect");
    expect(routeFailureTextToSpecialist("UpgradeGui missing")).toBe("ui");
    expect(routeFailureTextToSpecialist("DataStore save failed")).toBe("monetization");
  });
});

describe("QA hierarchy", () => {
  it("rejects high-level PASS without lower-level evidence", () => {
    const levels = QA_LEVELS.map((l) =>
      l === "visual"
        ? qaLevelResult(l, "passed", "screenshot at viewport confirmed")
        : qaLevelResult(l, "blocked", "no evidence recorded"),
    );
    const r = evaluateQaHierarchy(levels);
    expect(r.overall).toBe("failed");
    expect(r.summary).toContain("visual");
  });

  it("rejects runtime PASS from static evidence", () => {
    const levels = QA_LEVELS.map((l) =>
      l === "static-build" || l === "structural" || l === "studio-readiness"
        ? qaLevelResult(l, "passed", `static-build evidence for ${l}`)
        : l === "runtime"
          ? qaLevelResult(l, "passed", "build succeeded")
          : qaLevelResult(l, "skipped", "not run"),
    );
    const r = evaluateQaHierarchy(levels);
    expect(r.overall).toBe("failed");
    expect(r.summary).toMatch(/runtime/i);
  });

  it("passes when all 8 levels carry real evidence", () => {
    const ev: Record<string, string> = {
      "static-build": "npm build exit 0",
      structural: "project structure valid",
      "studio-readiness": "Studio PLACE_READY connected instance",
      runtime: "playtest runtime assertions 5/5, logs clean",
      "gameplay-assertions": "spawn/collect/upgrade assertions passed in playtest",
      visual: "screenshot viewport 1280x720 confirms HUD visible",
      regression: "prior assertions still pass after repair",
      "final-review": "reviewer verdict: release",
    };
    const r = evaluateQaHierarchy(QA_LEVELS.map((l) => qaLevelResult(l, "passed", ev[l]!)));
    expect(r.overall).toBe("passed");
  });
});

describe("Repair history", () => {
  it("detects repeated failures and exhausts budget to BLOCKED", () => {
    const h = new RepairHistory(2);
    expect(h.decide("d1", "boom", "fix A").action).toBe("proceed");
    h.record({ delegationId: "d1", failure: "boom", evidence: "e", diagnosis: "x", repairAttempted: "fix A", repairResult: "failed" });
    const d2 = h.decide("d1", "boom", "fix A");
    expect(d2.action).toBe("retry-different");
    h.record({ delegationId: "d1", failure: "boom", evidence: "e", diagnosis: "x", repairAttempted: "fix B", repairResult: "failed" });
    expect(h.decide("d1", "boom", "fix C").action).toBe("blocked");
  });
});

describe("Resource control", () => {
  it("names the Studio singleton lock", () => {
    expect(studioLockName()).toContain("studio");
    expect(projectLockName("/a/b")).toContain("project-");
  });

  it("bounds concurrency instead of parallelizing", async () => {
    const gate = new ConcurrencyGate(1);
    await gate.run(async () => {
      await expect(gate.run(async () => {})).rejects.toThrow(/budget exhausted/);
    });
    expect(gate.inFlight).toBe(0);
  });
});

describe("Hermes status contract", () => {
  it("maps internal statuses to external stages", () => {
    expect(toHermesStage("draft")).toBe("queued");
    expect(toHermesStage("repairing")).toBe("repairing");
    expect(toHermesStage("completed")).toBe("passed");
    const s = buildHermesStatus({ missionId: "m1", internalStatus: "running", completedDelegations: 2, totalDelegations: 5 });
    expect(s.stage).toBe("building");
    expect(s.completedDelegations).toBe(2);
    expect(JSON.stringify(s)).not.toMatch(/token|secret/i);
  });
});

describe("Roblox production loop", () => {
  it("runs all 17 stages in order offline", async () => {
    const seen: string[] = [];
    const r = await runRobloxProductionLoop("/proj", {
      "source-validation": async () => ({ status: "passed", evidence: "luau ok" }),
      playtest: async () => ({ status: "passed", evidence: "playtest ok" }),
      teardown: async () => {
        seen.push("teardown");
        return { status: "passed", evidence: "teardown confirmed" };
      },
    });
    expect(r.status).toBe("passed");
    expect(r.steps.length).toBe(17);
    expect(seen).toEqual(["teardown"]);
  });

  it("stops at the first failed stage", async () => {
    const r = await runRobloxProductionLoop("/proj", {
      "source-validation": async () => ({ status: "failed", evidence: "syntax" }),
      teardown: async () => ({ status: "passed", evidence: "x" }),
    });
    expect(r.status).toBe("failed");
    expect(r.failedStage).toBe("source-validation");
  });
});

describe("Model complexity routing", () => {
  it("classifies VERY_HIGH/HIGH/MEDIUM/LOW", () => {
    expect(classifyTaskComplexity("major mission planning with conflict resolution")).toBe("VERY_HIGH");
    expect(classifyTaskComplexity("complex debugging of cross-system runtime failures")).toBe("HIGH");
    expect(classifyTaskComplexity("implement feature UI work")).toBe("MEDIUM");
    expect(classifyTaskComplexity("simple code edit")).toBe("LOW");
  });

  it("preserves rotation and honors env pools", () => {
    const c = chooseModelForComplexity("programmer", "LOW", []);
    expect(c.model).toBeTruthy();
    process.env.AI_FACTORY_MODELS_HIGH = "model-a,model-b";
    const h = chooseModelForComplexity("architect", "HIGH", ["model-a"]);
    expect(h.model).toBe("model-b");
    delete process.env.AI_FACTORY_MODELS_HIGH;
  });
});
