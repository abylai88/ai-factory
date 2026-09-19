import type { ProductionBlueprint } from "./blueprint.js";

/**
 * Director vision — turns a high-level goal (+ blueprint + research
 * signals) into the plans every specialist consumes.
 *
 * The Director establishes structure/gameplay identity/aesthetic/scope/
 * priority and does NOT personally implement. Lower-level agents may not
 * redefine core direction without explicit evidence (enforced by keeping
 * the vision hash in the handoff: deviations must cite it).
 */

export interface DirectorVision {
  vision: string;
  coreLoop: string;
  featurePriorities: string[];
  technicalPlan: string;
  scenePlan: string;
  uiPlan: string;
  contentPlan: string;
  qaPlan: string;
  milestones: string[];
  acceptanceCriteria: string[];
  frozenCore: string;
}

export function buildDirectorVision(
  blueprint: ProductionBlueprint,
  researchSummary?: string,
): DirectorVision {
  const plat = blueprint.platform === "roblox" ? "Roblox (Luau + Rojo)" : "Web (Phaser)";
  return {
    vision: `${blueprint.genre} on ${plat}: ${blueprint.playerExperience}. Mood: ${blueprint.visualDirection}.`,
    coreLoop: blueprint.coreLoop,
    featurePriorities: [
      ...blueprint.requiredSystems.map((s, i) => `P${i < 4 ? 0 : 1} ${s}`),
    ],
    technicalPlan: blueprint.technicalArchitecture,
    scenePlan: blueprint.platform === "roblox"
      ? "Workspace: SpawnLocation + ground/baseplate + collectible field + zone gates; StarterGui: HUD + upgrade menu"
      : "Scenes: Boot → Game → UI overlay; data-driven level configs",
    uiPlan: blueprint.uiDirection,
    contentPlan: `${blueprint.progression}; balance: each tier visibly faster`,
    qaPlan: blueprint.qaCriteria.join("; "),
    milestones: ["M1 core loop playable", "M2 progression + UI", "M3 QA + repair + review"],
    acceptanceCriteria: blueprint.acceptanceCriteria,
    frozenCore: `FROZEN CORE (do not redefine without evidence): ${blueprint.coreLoop}`,
  };
}

export function renderDirectorVision(v: DirectorVision): string {
  return [
    "DIRECTOR VISION",
    `Vision: ${v.vision}`,
    `Core loop: ${v.coreLoop}`,
    `Priorities: ${v.featurePriorities.join(" | ")}`,
    `Technical: ${v.technicalPlan}`,
    `Scene: ${v.scenePlan}`,
    `UI: ${v.uiPlan}`,
    `Content: ${v.contentPlan}`,
    `QA: ${v.qaPlan}`,
    `Milestones: ${v.milestones.join(" → ")}`,
    `Acceptance: ${v.acceptanceCriteria.join("; ")}`,
    v.frozenCore,
  ].join("\n");
}
