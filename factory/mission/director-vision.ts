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

export interface QualityBar {
  /** Observable quality bar: what "production-quality" observably means. */
  qualityBar: string;
  /** What must NOT look generic (concrete anti-generic constraints). */
  mustNotLookGeneric: string[];
  /** First-minute experience beats, in order. */
  firstMinuteExperience: string[];
  /** Player-facing polish requirements (testable/observable). */
  polishRequirements: string[];
  /** Acceptance criteria split by tier. */
  requiredForFunctionality: string[];
  requiredForPolish: string[];
  stretchGoals: string[];
}

export interface DirectorVision extends QualityBar {
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
  /** Game fantasy statement (who the player is, what the fantasy is). */
  gameFantasy: string;
  /** Visual identity: palette, mood, reference direction. */
  visualIdentity: string;
  mood: string;
  referenceDirection: string;
  /** Gameplay pillars (2-4 observable pillars). */
  gameplayPillars: string[];
  /** UX principles (observable interaction rules). */
  uxPrinciples: string[];
}

const VAGUE_DIRECTIVES = [
  "make it polished",
  "make it beautiful",
  "make it fun",
  "make it nice",
  "make it good",
  "make it awesome",
];

/**
 * Reject vague directives: they must be converted into testable or
 * observable requirements before they reach specialists.
 */
export function isVagueDirective(text: string): boolean {
  const t = (text ?? "").toLowerCase().trim();
  if (!t) return false;
  return VAGUE_DIRECTIVES.some((v) => t === v || (t.length < 60 && t.includes(v)));
}

function genreFantasy(genre: string, platform: string): string {
  if (genre === "simulator") return `Fantasy: you are a rising collector on ${platform} — every click visibly grows your fortune and unlocks new zones.`;
  if (genre === "platformer") return `Fantasy: you are a skilled runner on ${platform} — every jump is precise and every checkpoint feels earned.`;
  return `Fantasy: you are the rising star of this ${genre} on ${platform} — progress is always visible.`;
}

function genreVisualIdentity(genre: string, blueprint: ProductionBlueprint): string {
  if (blueprint.platform === "roblox") {
    return genre === "simulator"
      ? "Visual identity: bright coin-fields with gold/teal palette, distinct per-zone palettes, large readable collectibles; reference: clean simulator hub with readable clusters, never default gray plastic."
      : "Visual identity: readable arena with zone palettes and landmark props; reference: crisp low-noise Roblox environment, never an empty gray baseplate.";
  }
  return `Visual identity: readable canvas with per-zone palettes; reference: clean casual web game, never default gray shapes. Mood: upbeat, readable.`;
}

export function buildDirectorVision(
  blueprint: ProductionBlueprint,
  researchSummary?: string,
): DirectorVision {
  const plat = blueprint.platform === "roblox" ? "Roblox (Luau + Rojo)" : "Web (Phaser)";
  const research = (researchSummary ?? "").trim();
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
    gameFantasy: genreFantasy(blueprint.genre, plat),
    visualIdentity: genreVisualIdentity(blueprint.genre, blueprint),
    mood: blueprint.visualDirection,
    referenceDirection: research
      ? `Reference direction informed by research signals: ${research.slice(0, 300)}`
      : "Reference direction: clean readable genre reference; distinct palettes per zone; large readable pickups.",
    gameplayPillars: [
      "Pillar 1 (feedback): every player action produces visible feedback within 1s",
      "Pillar 2 (goal): the next goal is always visible (HUD objective + scene cue)",
      "Pillar 3 (progression): each tier is visibly faster than the last",
    ],
    uxPrinciples: [
      "Primary action visually distinct from secondary navigation",
      "HUD always shows currency + next goal",
      "Every visible control has an explainable behavior (no dead UI)",
    ],
    qualityBar: "Production-quality = core loop runs AND goal/feedback/progression are readable AND no placeholder-feeling surfaces remain. Functional alone is not acceptance.",
    mustNotLookGeneric: [
      "Must NOT ship an empty gray baseplate as the map",
      "Must NOT ship default gray UI with unexplained buttons",
      "Must NOT ship placeholder names (Test/Foo/Untitled) or filler copy",
      "Must NOT ship debug/test controls visible to the player",
    ],
    firstMinuteExperience: [
      "0-10s: spawn safely with goal prompt visible",
      "10-30s: first collect with visible reward feedback",
      "30-60s: first upgrade/progression beat with next goal shown",
    ],
    polishRequirements: [
      "Collect feedback observable (counter tick + effect or sound cue)",
      "HUD shows currency + next upgrade at all times",
      "Onboarding prompt states the first action",
      "Upgrade menu reflects owned/current tier state",
    ],
    requiredForFunctionality: [...blueprint.acceptanceCriteria],
    requiredForPolish: [
      "Goal + next step visible without guessing",
      "Reward feedback within seconds of the earning action",
      "No dead/unexplained UI",
      "No placeholder names or debug UI in production",
      "Spawn is safe (floor + SpawnLocation)",
    ],
    stretchGoals: [
      "Environment dressing with fantasy purpose",
      "Lighting/material consistency pass",
      "Escalating reward ceremony per tier",
    ],
  };
}

export function renderDirectorVision(v: DirectorVision): string {
  return [
    "DIRECTOR VISION",
    `Vision: ${v.vision}`,
    `Fantasy: ${v.gameFantasy ?? ""}`,
    `Visual identity: ${v.visualIdentity ?? ""}`,
    `Mood: ${v.mood ?? ""}`,
    `Reference: ${v.referenceDirection ?? ""}`,
    `Core loop: ${v.coreLoop}`,
    `Pillars: ${(v.gameplayPillars ?? []).join(" | ")}`,
    `UX principles: ${(v.uxPrinciples ?? []).join(" | ")}`,
    `Priorities: ${v.featurePriorities.join(" | ")}`,
    `Technical: ${v.technicalPlan}`,
    `Scene: ${v.scenePlan}`,
    `UI: ${v.uiPlan}`,
    `Content: ${v.contentPlan}`,
    `QA: ${v.qaPlan}`,
    `Quality bar: ${v.qualityBar ?? ""}`,
    `Must NOT look generic: ${(v.mustNotLookGeneric ?? []).join("; ")}`,
    `First minute: ${(v.firstMinuteExperience ?? []).join(" → ")}`,
    `Polish: ${(v.polishRequirements ?? []).join("; ")}`,
    `Required (functionality): ${(v.requiredForFunctionality ?? []).join("; ")}`,
    `Required (polish): ${(v.requiredForPolish ?? []).join("; ")}`,
    `Stretch (optional): ${(v.stretchGoals ?? []).join("; ")}`,
    `Milestones: ${v.milestones.join(" → ")}`,
    `Acceptance: ${v.acceptanceCriteria.join("; ")}`,
    v.frozenCore,
  ].join("\n");
}
