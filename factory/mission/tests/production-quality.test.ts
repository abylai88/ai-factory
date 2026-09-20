import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { deriveBlueprintFromGoal } from "../blueprint.js";
import { buildDirectorVision, isVagueDirective, renderDirectorVision } from "../director-vision.js";
import {
  deriveQualityContract,
  validateQualityContract,
  requirementsForDimension,
  requiredForGate,
  markRequirementVerified,
} from "../quality-contract.js";
import {
  runVisualCritic,
  runUxCritic,
  runGameplayCritic,
  runTechnicalCritic,
  runAllCritics,
  validateQualityFinding,
  ownerForFinding,
  VISUAL_UNAVAILABLE,
  type QualityFinding,
} from "../quality-critics.js";
import {
  routeFailureToSpecialist,
  routeQualityFindingToSpecialist,
} from "../specialist-roles.js";
import { triageQualityFinding } from "../failure-triage.js";
import { evaluateProductionQualityGate, runQualityRepairLoop } from "../quality-gate.js";
import { buildRobloxQualityEvidence } from "../quality-evidence.js";
import { scanForPrototypePatterns } from "../quality-guardrails.js";
import { buildRoleHandoff, qualityBriefForRole } from "../context-handoff.js";
import { RepairHistory } from "../repair-history.js";
import { sanitizeForPersistence } from "../persisted-memory.js";
import { scrubEphemeralIds } from "../readiness-evidence.js";
import { createMission } from "../mission.js";
import { MissionState } from "../state.js";

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prod-quality-"));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function finding(overrides?: Partial<QualityFinding>): QualityFinding {
  const now = new Date().toISOString();
  return {
    id: "QF-UX-test-1",
    dimension: "ux",
    severity: "major",
    evidence: "UI hierarchy shows three identical buttons with no labels",
    affectedArea: "Upgrade UI",
    violatedRequirement: "ux-hierarchy",
    why: "Primary upgrade action is visually indistinguishable from secondary navigation action; violates interaction hierarchy requirement.",
    proposedOwner: "ui",
    repairObjective: "Restyle the primary upgrade button distinctly (size/color/label) from secondary navigation.",
    verificationRequirement: "Inspect UI hierarchy after repair: primary vs secondary distinct.",
    createdAt: now,
    ...overrides,
  };
}

describe("production quality contract", () => {
  it("derives a structured contract from the blueprint covering all six dimensions", () => {
    const bp = deriveBlueprintFromGoal("Create a Roblox coin simulator with upgrades");
    const contract = deriveQualityContract(bp);
    expect(validateQualityContract(contract).missionGoal).toBe(bp.goal);
    for (const dim of ["core-experience", "visual", "ux", "gameplay-polish", "technical", "content"] as const) {
      expect(requirementsForDimension(contract, dim).length).toBeGreaterThan(0);
    }
    // Structured, not a numeric score.
    for (const r of contract.requirements) {
      expect(r.requirement.length).toBeGreaterThan(0);
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.owner.length).toBeGreaterThan(0);
      expect(r.suggestedRepairRoute.length).toBeGreaterThan(0);
      expect(r.verification).toBe("unverified");
    }
  });

  it("excludes stretch tier from the gate and supports verification marking", () => {
    const bp = deriveBlueprintFromGoal("Create a Roblox coin simulator");
    const contract = deriveQualityContract(bp);
    const required = requiredForGate(contract);
    expect(required.length).toBeLessThan(contract.requirements.length);
    expect(required.every((r) => r.tier !== "stretch")).toBe(true);
    const marked = markRequirementVerified(contract, "spawn-safety", "passed", "SpawnLocation + floor observed");
    expect(marked.requirements.find((r) => r.id === "spawn-safety")?.verification).toBe("passed");
  });
});

describe("director quality vision", () => {
  it("establishes fantasy, identity, pillars, quality bar, and tiered acceptance", () => {
    const bp = deriveBlueprintFromGoal("Create a Roblox coin simulator");
    const vision = buildDirectorVision(bp, "fast feedback + visible progression");
    expect(vision.gameFantasy.length).toBeGreaterThan(0);
    expect(vision.visualIdentity.length).toBeGreaterThan(0);
    expect(vision.mood.length).toBeGreaterThan(0);
    expect(vision.referenceDirection.length).toBeGreaterThan(0);
    expect(vision.gameplayPillars.length).toBeGreaterThanOrEqual(2);
    expect(vision.uxPrinciples.length).toBeGreaterThanOrEqual(2);
    expect(vision.qualityBar.length).toBeGreaterThan(0);
    expect(vision.mustNotLookGeneric.length).toBeGreaterThan(0);
    expect(vision.firstMinuteExperience.length).toBeGreaterThanOrEqual(2);
    expect(vision.polishRequirements.length).toBeGreaterThan(0);
    expect(vision.requiredForFunctionality.length).toBeGreaterThan(0);
    expect(vision.requiredForPolish.length).toBeGreaterThan(0);
    expect(vision.stretchGoals.length).toBeGreaterThan(0);
    const rendered = renderDirectorVision(vision);
    expect(rendered).toContain("Fantasy:");
    expect(rendered).toContain("Quality bar:");
    expect(rendered).toContain("Stretch (optional):");
  });

  it("detects vague directives instead of passing them to specialists", () => {
    expect(isVagueDirective("make it polished")).toBe(true);
    expect(isVagueDirective("make it beautiful")).toBe(true);
    expect(isVagueDirective("make it fun")).toBe(true);
    expect(isVagueDirective("HUD always shows currency + next goal; primary action distinct")).toBe(false);
  });
});

describe("critic finding schema", () => {
  it("accepts concrete findings and rejects vague ones", () => {
    expect(validateQualityFinding(finding()).id).toBe("QF-UX-test-1");
    expect(() => validateQualityFinding(finding({ repairObjective: "make it better" }))).toThrow();
    expect(() => validateQualityFinding(finding({ verificationRequirement: "UI looks bad" }))).toThrow();
  });

  it("never fabricates a visual PASS when screenshot evidence is unavailable", () => {
    const review = runVisualCritic({ sceneSummary: "Workspace: SpawnLocation + BasePlate" });
    expect(review.status).toBe("unavailable");
    expect(review.evidenceNotes.join(" ")).toContain(VISUAL_UNAVAILABLE);
    // No review without a screenshot may claim pass.
    expect(review.status).not.toBe("pass");
  });

  it("visual critic with a screenshot can pass or fail on real evidence", () => {
    const bad = runVisualCritic({
      sceneSummary: "empty baseplate, default gray plastic, no collectibles",
      screenshotRef: "viewport-1280x720.png",
    });
    expect(bad.status).toBe("fail");
    expect(bad.findings.length).toBeGreaterThan(0);
    const good = runVisualCritic({
      sceneSummary: "SpawnLocation + gold/teal coin field + zone gates + landmarks",
      screenshotRef: "viewport-1280x720.png: bright coin field, readable HUD",
    });
    expect(good.status).toBe("pass");
  });

  it("withholds gameplay/technical verdicts honestly when evidence is missing", () => {
    expect(runGameplayCritic({}).status).toBe("unavailable");
    expect(runTechnicalCritic({}).status).toBe("unavailable");
    const gameplay = runGameplayCritic({
      runtimeSummary: "playtest PASS; collect/upgrade assertions 3/3; reward feedback effect + counter tick; spawn safe with floor + SpawnLocation; first-minute onboarding shown",
    });
    expect(gameplay.status).toBe("pass");
  });

  it("ux critic finds missing HUD and dead UI concretely", () => {
    const review = runUxCritic({ sceneSummary: "StarterGui: Frame with Button1, Button2, Button3" });
    expect(review.status).toBe("fail");
    expect(review.findings.some((f) => f.violatedRequirement === "hud-information")).toBe(true);
  });

  it("technical critic flags runtime errors and client-trusted currency", () => {
    const review = runTechnicalCritic({ sources: ["runtime error: attempt to index nil", "currency handled in LocalScript, client trusted"] });
    expect(review.status).toBe("fail");
    expect(review.findings.some((f) => f.violatedRequirement === "no-runtime-errors")).toBe(true);
    expect(review.findings.some((f) => f.violatedRequirement === "server-authority")).toBe(true);
  });

  it("all four critics run together and findings carry owners", () => {
    const { reviews, findings } = runAllCritics({ sceneSummary: "empty baseplate" });
    expect(reviews).toHaveLength(4);
    for (const f of findings) {
      expect(ownerForFinding(f).length).toBeGreaterThan(0);
    }
  });
});

describe("dimension-specific routing", () => {
  it("routes each quality dimension to its owning specialist (never all to programmer)", () => {
    expect(routeQualityFindingToSpecialist({ dimension: "visual" })).toBe("visual");
    expect(routeQualityFindingToSpecialist({ dimension: "ux" })).toBe("ui");
    expect(routeQualityFindingToSpecialist({ dimension: "gameplay" })).toBe("gameplay");
    expect(routeQualityFindingToSpecialist({ dimension: "technical" })).toBe("programmer");
    expect(routeFailureToSpecialist("quality_visual")).toBe("visual");
    expect(routeFailureToSpecialist("quality_ux")).toBe("ui");
    expect(routeFailureToSpecialist("quality_gameplay")).toBe("gameplay");
    expect(routeFailureToSpecialist("quality_technical")).toBe("programmer");
    expect(routeFailureToSpecialist("quality_content")).toBe("content");
  });

  it("quality finding triage names an explicit owner and repair routing", () => {
    const t = triageQualityFinding({
      findingId: "QF-UX-1",
      dimension: "ux",
      severity: "major",
      violatedRequirement: "ux-hierarchy",
      proposedOwner: "ui",
      evidenceText: "primary button indistinguishable",
    });
    expect(t.specialist).toBe("ui");
    expect(t.category).toBe("quality_ux");
    expect(t.action).toBe("repair");
    const content = triageQualityFinding({
      findingId: "QF-TE-1",
      dimension: "technical",
      severity: "major",
      violatedRequirement: "no-placeholder-names",
      evidenceText: "placeholder names Test Foo in labels",
    });
    expect(content.specialist).toBe("content");
  });
});

describe("quality repair loop", () => {
  const functional = {
    functionalPass: true,
    functionalEvidence: "rojo build exit 0",
    runtimePass: true,
    runtimeEvidence: "playtest runtime assertions 3/3, logs clean",
  };

  it("repairs affected dimensions and reaches production PASS", async () => {
    const outcome = await runQualityRepairLoop({
      initialFindings: [finding()],
      functional,
      reviews: [
        { dimension: "visual", status: "pass", findings: [], evidenceNotes: ["screenshot: deliberate palette"], reviewedAt: new Date().toISOString() },
        { dimension: "ux", status: "pass", findings: [], evidenceNotes: ["UI hierarchy fixed"], reviewedAt: new Date().toISOString() },
        { dimension: "gameplay", status: "pass", findings: [], evidenceNotes: ["runtime assertions pass"], reviewedAt: new Date().toISOString() },
        { dimension: "technical", status: "pass", findings: [], evidenceNotes: ["logs clean"], reviewedAt: new Date().toISOString() },
      ],
      repairOne: async (task) => {
        expect(task.specialist).toBe("ui");
        return { fixed: true, note: "primary button restyled; hierarchy verified" };
      },
    });
    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.gate.productionPass).toBe(true);
    expect(outcome.repairTasks[0]?.specialist).toBe("ui");
  });

  it("escalates repeated quality failures instead of looping forever", async () => {
    const history = new RepairHistory(1);
    history.record({ delegationId: "QF-1", failure: "flat buttons", evidence: "e", diagnosis: "d", repairAttempted: "restyle", repairResult: "failed" });
    expect(history.decide("QF-1", "flat buttons", "restyle-again").action).toBe("blocked");

    const outcome = await runQualityRepairLoop({
      initialFindings: [finding({ id: "QF-UX-loop", why: "flat buttons persist after restyle" })],
      functional,
      reviews: [],
      maxRounds: 2,
      repairBudget: 3,
      repairOne: async () => ({ fixed: false, note: "restyle attempted; still flat" }),
    });
    expect(outcome.escalated.length).toBeGreaterThan(0);
    expect(outcome.gate.productionPass).toBe(false);
  });
});

describe("quality gate semantics", () => {
  const passReview = (dimension: "visual" | "ux" | "gameplay" | "technical") => ({
    dimension,
    status: "pass" as const,
    findings: [],
    evidenceNotes: [`${dimension} evidenced`],
    reviewedAt: new Date().toISOString(),
  });

  it("keeps FUNCTIONAL/RUNTIME/VISUAL/UX/GAMEPLAY/PRODUCTION verdicts distinct", () => {
    const gate = evaluateProductionQualityGate({
      functional: { functionalPass: true, functionalEvidence: "build 0", runtimePass: true, runtimeEvidence: "assertions 3/3" },
      reviews: [passReview("visual"), passReview("ux"), passReview("gameplay"), passReview("technical")],
      unresolvedFindings: [],
    });
    expect(gate.dimensions.map((d) => d.dimension)).toEqual(
      ["functional", "runtime", "visual", "ux", "gameplay", "production"],
    );
    expect(gate.productionPass).toBe(true);
    expect(gate.summary).toContain("PRODUCTION_QUALITY_PASS");
  });

  it("a technically passing build is still rejected when quality findings remain", () => {
    const gate = evaluateProductionQualityGate({
      functional: { functionalPass: true, functionalEvidence: "build 0", runtimePass: true, runtimeEvidence: "assertions pass" },
      reviews: [passReview("visual"), passReview("ux"), passReview("gameplay"), passReview("technical")],
      unresolvedFindings: [finding({ severity: "major" })],
    });
    expect(gate.productionPass).toBe(false);
  });

  it("unavailable visual evidence never becomes PASS, and stretch never blocks", () => {
    const withoutVisual = evaluateProductionQualityGate({
      functional: { functionalPass: true, functionalEvidence: "build 0", runtimePass: true, runtimeEvidence: "assertions pass" },
      reviews: [passReview("ux"), passReview("gameplay"), passReview("technical")],
    });
    expect(withoutVisual.dimensions.find((d) => d.dimension === "visual")?.status).toBe("unavailable");
    expect(withoutVisual.productionPass).toBe(false);

    const stretchOnly = evaluateProductionQualityGate({
      functional: { functionalPass: true, functionalEvidence: "build 0", runtimePass: true, runtimeEvidence: "assertions pass" },
      reviews: [passReview("visual"), passReview("ux"), passReview("gameplay"), passReview("technical")],
      unresolvedFindings: [finding({ severity: "stretch" })],
    });
    expect(stretchOnly.productionPass).toBe(true);
  });
});

describe("quality evidence and guardrails", () => {
  it("builds critic evidence from real Roblox lifecycle outputs without fabrication", () => {
    const ev = buildRobloxQualityEvidence({
      sceneSummary: "Workspace: SpawnLocation + BasePlate + coin field; StarterGui HUD",
      playtest: {
        status: "PASS",
        message: "settled",
        state: "RUNNING",
        evidence: { teardownUnconfirmed: false } as never,
        assertions: [{ name: "spawn", passed: true, message: "ok" }],
        durationMs: 1000,
        output: "ok",
      },
      screenshotRef: "shot-1.png",
    });
    expect(ev.sceneSummary).toContain("SpawnLocation");
    expect(ev.runtimeSummary).toContain("assertions: 1/1");
    expect(ev.screenshotRef).toBe("shot-1.png");
    expect(ev.mapCompositionNotes.length).toBeGreaterThan(0);
    const empty = buildRobloxQualityEvidence({});
    expect(empty.screenshotRef).toBeUndefined();
    expect(empty.mapCompositionNotes.join(" ")).toMatch(/unavailable/i);
  });

  it("flags weak-AI prototype patterns concretely (no numeric score)", () => {
    const hits = scanForPrototypePatterns({
      sceneSummary: "empty baseplate, default gray plastic, no collectibles",
      uiInventory: "Button1 Button2 debug button, giant text label",
    });
    const ids = hits.map((h) => h.violatedRequirement);
    expect(ids).toContain("visual-identity");
    expect(ids).toContain("no-debug-ui");
    for (const h of hits) {
      expect(h.repairObjective.length).toBeGreaterThan(20);
      expect(h.verificationRequirement.length).toBeGreaterThan(20);
    }
  });
});

describe("quality handoff prompts", () => {
  it("gives implementation roles the bar BEFORE coding and repair roles the defect AFTER", () => {
    const brief = qualityBriefForRole("programmer");
    expect(brief.qualityRequirements.length).toBeGreaterThan(0);
    expect(brief.antiPatterns.length).toBeGreaterThan(0);
    expect(brief.verificationRequirements.length).toBeGreaterThan(0);
    const handoff = buildRoleHandoff({
      role: "programmer",
      taskTitle: "Implement collect system",
      directorQuality: "Fantasy: rising collector; pillars: feedback/goal/progression",
      qualityRequirements: brief.qualityRequirements,
      qualityFindings: ["QF-1: primary button indistinguishable (owner: ui)"],
      deliverables: ["src/Collect.server.luau wired to currency"],
      antiPatterns: brief.antiPatterns,
      verificationRequirements: brief.verificationRequirements,
    });
    expect(handoff).toContain("DIRECTOR QUALITY");
    expect(handoff).toContain("QUALITY REQUIREMENTS");
    expect(handoff).toContain("ANTI-PATTERNS");
    expect(handoff).toContain("VERIFICATION");
  });
});

describe("quality persistence and resume", () => {
  it("persists findings with repair linkage and verification outcome across reloads", async () => {
    const mission = createMission("Create a Roblox coin simulator");
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    const recorded = await state.recordQualityFinding({
      id: "QF-UX-1",
      dimension: "ux",
      severity: "major",
      evidence: "three identical buttons",
      affectedArea: "Upgrade UI",
      violatedRequirement: "ux-hierarchy",
      why: "Primary upgrade action indistinguishable from secondary navigation.",
      proposedOwner: "ui",
      repairObjective: "Restyle primary distinctly.",
      verificationRequirement: "Inspect UI hierarchy.",
    });
    expect(recorded.status).toBe("open");
    await state.updateQualityFinding("QF-UX-1", {
      status: "fixed",
      repairDelegationId: "repair-1",
      verificationOutcome: "UI hierarchy verified distinct",
    });
    const reloaded = new MissionState(tmpDir, mission.id);
    await reloaded.init();
    const findings = reloaded.getQualityFindings();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.status).toBe("fixed");
    expect(findings[0]?.repairDelegationId).toBe("repair-1");
    expect(findings[0]?.verificationOutcome).toContain("verified");
    // Restart/resume preserves quality history.
    await reloaded.prepareForResume();
    expect(reloaded.getQualityFindings()).toHaveLength(1);
  });

  it("never persists secrets or ephemeral Studio IDs", async () => {
    const scrubbed = scrubEphemeralIds("Reused existing Studio (instance:abc123, peer:xyz, launch:qrs)");
    expect(scrubbed).not.toContain("abc123");
    expect(scrubbed).toContain("[redacted]");
    const sanitized = sanitizeForPersistence({
      evidence: "ok",
      instanceId: "ephemeral-1",
      peerId: "peer-2",
      authToken: "secret-3",
      nested: { connectionId: "c-1", note: "keep" },
    }) as Record<string, unknown>;
    expect("instanceId" in sanitized).toBe(false);
    expect("peerId" in sanitized).toBe(false);
    expect("authToken" in sanitized).toBe(false);
    expect((sanitized.nested as Record<string, unknown>).note).toBe("keep");

    const mission = createMission("quality secrets probe");
    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);
    await state.recordQualityFinding({
      id: "QF-1",
      dimension: "ux",
      severity: "minor",
      evidence: "ok",
      violatedRequirement: "ux-hierarchy",
      why: "Concrete minor hierarchy note with enough detail to persist.",
      proposedOwner: "ui",
      repairObjective: "Adjust the secondary navigation styling concretely.",
      verificationRequirement: "Re-inspect the hierarchy and confirm distinction.",
    });
    const snapPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.state.json`);
    const raw = await fs.readFile(snapPath, "utf8");
    expect(raw).not.toMatch(/instance:[A-Za-z0-9_-]+/);
  });
});
