import { describe, it, expect } from "vitest";
import { deriveBlueprintFromGoal } from "../blueprint.js";
import { buildDirectorVision, renderDirectorVision } from "../director-vision.js";
import { deriveQualityContract } from "../quality-contract.js";
import { runAllCritics, type CriticEvidence, type QualityFinding } from "../quality-critics.js";
import { evaluateProductionQualityGate, runQualityRepairLoop } from "../quality-gate.js";
import { buildRoleHandoff, qualityBriefForRole } from "../context-handoff.js";
import { scanForPrototypePatterns } from "../quality-guardrails.js";

/**
 * Dry-run company scenario (offline, deterministic, no Studio):
 *
 * goal → blueprint → director quality vision → implementation →
 * functional QA → visual/UX/gameplay review → findings →
 * targeted repair → repeat review → final quality gate.
 *
 * Demonstrates that a technically passing implementation can still be
 * REJECTED for quality findings, then ACCEPTED after targeted repair.
 * No subjective ranking, no numeric "AI quality score".
 */

interface SimulatedBuild {
  functionalPass: boolean;
  functionalEvidence: string;
  runtimePass: boolean;
  runtimeEvidence: string;
  evidence: CriticEvidence;
}

function initialBuildEvidence(): CriticEvidence {
  // Technically functional: build passes, runtime assertions pass at the
  // loop level — but the presentation is a weak prototype.
  return {
    sources: [
      "src/Collect.server.luau: currency handled on server; runtime logs clean",
      "StarterGui: Frame with Button1, Button2, Button3 (identical styling, no states)",
    ],
    sceneSummary: "Workspace: SpawnLocation + empty gray baseplate, default gray plastic, no collectible field, no dressing",
    runtimeSummary: "playtest PASS: collect assertion PASS, upgrade assertion PASS; spawn has floor + SpawnLocation; no reward feedback signal; no onboarding prompt",
    assertionSummary: "collect:pass, upgrade:pass",
    qaSummary: "structural validation PASS; runtime assertions 2/2",
    blueprintText: "simulator: collect → earn → upgrade → unlock",
    // No screenshot on the first pass: visual verdict must be honest.
  };
}

function repairedBuildEvidence(): CriticEvidence {
  return {
    sources: [
      "src/Collect.server.luau: currency handled on server; runtime logs clean",
      "StarterGui: HUD (Coins label + NextUpgrade label + OnboardingPrompt) + UpgradeMenu (PrimaryUpgradeButton distinct, SecondaryNavButton muted, pressed/disabled states wired)",
    ],
    sceneSummary: "Workspace: SpawnLocation + gold/teal coin field (24 readable collectibles) + zone gates + landmark arch; HUD shows coins + next upgrade; onboarding prompt at spawn",
    runtimeSummary: "playtest PASS: collect/upgrade assertions 3/3; reward feedback effect + counter tick + sound cue; spawn safe; first-minute onboarding shown; first collect within 20s",
    assertionSummary: "collect:pass, upgrade:pass, feedback:pass",
    qaSummary: "structural validation PASS; runtime assertions 3/3",
    blueprintText: "simulator: collect → earn → upgrade → unlock",
    screenshotRef: "viewport-1280x720.png: bright coin field, distinct HUD, readable collectibles",
  };
}

describe("dry-run company: quality loop", () => {
  it("goal → blueprint → director vision → QA → critics → repair → gate", async () => {
    const goal = "Create a Roblox coin simulator where the player collects coins and upgrades";

    // 1. Blueprint (Director contract).
    const blueprint = deriveBlueprintFromGoal(goal);
    expect(blueprint.platform).toBe("roblox");

    // 2. Director quality vision: real target, not vague directives.
    const vision = buildDirectorVision(blueprint);
    const rendered = renderDirectorVision(vision);
    expect(rendered).toContain("Fantasy:");
    expect(vision.requiredForPolish.length).toBeGreaterThan(0);

    // 3. Quality contract for the mission.
    const contract = deriveQualityContract(blueprint);
    expect(contract.requirements.length).toBeGreaterThan(20);

    // 4. Implementation agent receives the bar BEFORE coding.
    const brief = qualityBriefForRole("programmer");
    const handoff = buildRoleHandoff({
      role: "programmer",
      taskTitle: "Implement collect + upgrade systems",
      blueprint,
      directorQuality: rendered.slice(0, 800),
      qualityRequirements: brief.qualityRequirements,
      deliverables: ["server-authoritative collect", "HUD with currency + next goal"],
      antiPatterns: brief.antiPatterns,
      verificationRequirements: brief.verificationRequirements,
    });
    expect(handoff).toContain("QUALITY REQUIREMENTS");

    // 5. Functional QA passes on the first build (technically functional).
    const firstBuild: SimulatedBuild = {
      functionalPass: true,
      functionalEvidence: "rojo build exit 0; structural validation PASS",
      runtimePass: true,
      runtimeEvidence: "playtest runtime assertions 2/2, logs clean",
      evidence: initialBuildEvidence(),
    };

    // 6. Critics review actual evidence: functional ≠ quality.
    const first = runAllCritics(firstBuild.evidence, contract);
    expect(first.findings.length).toBeGreaterThan(0);
    // Guardrails agree with the critics (concrete signals, no scores).
    const guardrailHits = scanForPrototypePatterns({
      sceneSummary: firstBuild.evidence.sceneSummary,
      uiInventory: firstBuild.evidence.sources?.join("\n"),
      runtimeNotes: firstBuild.evidence.runtimeSummary,
    });
    expect(guardrailHits.length).toBeGreaterThan(0);

    // 7. A technically passing implementation is REJECTED for quality.
    const rejectedGate = evaluateProductionQualityGate({
      functional: firstBuild,
      reviews: first.reviews,
      contract,
      unresolvedFindings: first.findings,
    });
    expect(firstBuild.functionalPass).toBe(true);
    expect(firstBuild.runtimePass).toBe(true);
    expect(rejectedGate.productionPass).toBe(false);

    // 8. Targeted repair: each finding has an explicit owner; only
    // affected dimensions are repaired (no whole-company rerun).
    const owners = new Set(first.findings.map((f) => f.proposedOwner));
    expect(owners.size).toBeGreaterThan(1);
    const loop = await runQualityRepairLoop({
      initialFindings: first.findings.filter((f) => f.severity !== "stretch"),
      functional: firstBuild,
      reviews: first.reviews,
      contract,
      maxRounds: 3,
      repairOne: async (task, _finding: QualityFinding) => {
        // Simulated specialist repair: owner matches the finding.
        expect(task.specialist.length).toBeGreaterThan(0);
        return { fixed: true, note: `${task.specialist} completed: ${task.objective.slice(0, 80)}` };
      },
    });
    expect(loop.resolved.length).toBeGreaterThan(0);
    expect(loop.escalated).toHaveLength(0);

    // 9. Repeat review on the repaired build: critics again, then gate.
    const second = runAllCritics(repairedBuildEvidence(), contract);
    const acceptedGate = evaluateProductionQualityGate({
      functional: {
        functionalPass: true,
        functionalEvidence: "rojo build exit 0; structural validation PASS",
        runtimePass: true,
        runtimeEvidence: "playtest runtime assertions 3/3, logs clean",
      },
      reviews: second.reviews,
      contract,
      unresolvedFindings: second.findings,
    });
    expect(acceptedGate.productionPass).toBe(true);
    expect(acceptedGate.summary).toContain("PRODUCTION_QUALITY_PASS");
  });
});
