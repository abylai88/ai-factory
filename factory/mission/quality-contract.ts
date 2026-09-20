import { z } from "zod";
import type { ProductionBlueprint } from "./blueprint.js";

/**
 * Production Quality Contract — machine-readable quality requirements.
 *
 * Extends the mission/blueprint architecture (never replaces it): the
 * blueprint states WHAT the game is; the quality contract states what
 * "production-quality" OBSERVABLY means for that game.
 *
 * Deliberately NOT a numeric score. Each requirement carries:
 * requirement / evidence / observation / severity / owner /
 * suggested repair route / verification status.
 */

export const QUALITY_DIMENSIONS = [
  "core-experience",
  "visual",
  "ux",
  "gameplay-polish",
  "technical",
  "content",
] as const;
export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

/** Critic dimensions reuse the contract dimensions (visual/ux/gameplay/technical). */
export const CRITIC_DIMENSIONS = ["visual", "ux", "gameplay", "technical"] as const;
export type CriticDimension = (typeof CRITIC_DIMENSIONS)[number];

export const QualitySeveritySchema = z.enum(["blocking", "major", "minor", "stretch"]);
export type QualitySeverity = z.infer<typeof QualitySeveritySchema>;

export const QualityTierSchema = z.enum(["functionality", "polish", "stretch"]);
export type QualityTier = z.infer<typeof QualityTierSchema>;

export const VerificationStatusSchema = z.enum([
  "unverified",
  "passed",
  "failed",
  "unavailable",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const QualityRequirementSchema = z.object({
  id: z.string().min(1).max(100),
  dimension: z.enum(QUALITY_DIMENSIONS),
  tier: QualityTierSchema,
  requirement: z.string().min(1).max(500),
  /** What evidence would prove this requirement is met. */
  evidence: z.string().min(1).max(500),
  observation: z.string().max(1000).default(""),
  severity: QualitySeveritySchema,
  /** Owning specialist (see specialist-roles.ts routing). */
  owner: z.string().min(1).max(50),
  suggestedRepairRoute: z.string().min(1).max(500),
  verification: VerificationStatusSchema.default("unverified"),
});
export type QualityRequirement = z.infer<typeof QualityRequirementSchema>;

export const ProductionQualityContractSchema = z.object({
  missionGoal: z.string().min(1),
  platform: z.string().min(1),
  genre: z.string().min(1),
  requirements: z.array(QualityRequirementSchema).min(1),
  createdAt: z.string(),
});
export type ProductionQualityContract = z.infer<typeof ProductionQualityContractSchema>;

interface ReqDef {
  id: string;
  dimension: QualityDimension;
  tier: QualityTier;
  requirement: string;
  evidence: string;
  severity: QualitySeverity;
  owner: string;
  suggestedRepairRoute: string;
}

const CORE_EXPERIENCE: ReqDef[] = [
  { id: "core-loop-clarity", dimension: "core-experience", tier: "functionality", requirement: "Core gameplay loop is completable end-to-end and its steps are observable in-game", evidence: "Runtime assertions for each loop step pass in a live session", severity: "blocking", owner: "gameplay", suggestedRepairRoute: "gameplay: wire missing loop step + re-run runtime assertions" },
  { id: "player-goal-clarity", dimension: "core-experience", tier: "polish", requirement: "Player always sees the current goal and next step without guessing", evidence: "HUD/objective element present in scene or UI hierarchy; onboarding states the goal", severity: "major", owner: "ui", suggestedRepairRoute: "ui: add persistent objective label + verify in UI hierarchy" },
  { id: "reward-feedback-clarity", dimension: "core-experience", tier: "polish", requirement: "Rewards produce visible/audible feedback within seconds of the earning action", evidence: "Collect/reward feedback observable in runtime state or screenshot", severity: "major", owner: "gameplay", suggestedRepairRoute: "gameplay: add collect feedback (effect/sound/counter tick) + re-test" },
  { id: "progression-readability", dimension: "core-experience", tier: "polish", requirement: "Progression (levels, upgrades, unlocks) is readable: player can tell they advanced", evidence: "Upgrade/zone progression visible in UI or scene; upgrade menu reflects state", severity: "major", owner: "ui", suggestedRepairRoute: "ui: surface progression state (progress bar, tier labels) + verify" },
  { id: "pacing", dimension: "core-experience", tier: "polish", requirement: "Pacing delivers feedback within seconds of spawn; no long dead stretches at start", evidence: "First-minute experience scripted and observed in runtime evidence", severity: "major", owner: "gameplay", suggestedRepairRoute: "gameplay: tune spawn/collect density for first-minute feedback" },
  { id: "onboarding", dimension: "core-experience", tier: "polish", requirement: "Onboarding tells the player what to do first (goal + first action)", evidence: "Onboarding prompt/label present in UI hierarchy or spawn area", severity: "major", owner: "content", suggestedRepairRoute: "content: add first-action prompt with game-fantasy wording" },
  { id: "responsiveness", dimension: "core-experience", tier: "functionality", requirement: "Player inputs produce a timely in-game response (no dead controls)", evidence: "Runtime assertions for input→response pass; no dead UI controls", severity: "blocking", owner: "programmer", suggestedRepairRoute: "programmer: fix input wiring + re-run runtime assertions" },
  { id: "player-agency", dimension: "core-experience", tier: "polish", requirement: "Player has meaningful choices (not a single forced path with no decisions)", evidence: "Two or more viable player strategies or upgrade paths exist in design", severity: "minor", owner: "gameplay", suggestedRepairRoute: "gameplay: add a second viable path/choice + document it" },
];

const VISUAL: ReqDef[] = [
  { id: "visual-identity", dimension: "visual", tier: "polish", requirement: "Scene has a deliberate visual identity (palette + mood), not default graybox", evidence: "Scene composition summary lists palette/zones; screenshot when available", severity: "major", owner: "visual", suggestedRepairRoute: "visual: apply zone palettes + dressing per director vision" },
  { id: "style-consistency", dimension: "visual", tier: "polish", requirement: "Style is consistent across environment, collectibles, and UI (no arbitrary clashing colors)", evidence: "Color/material coherence noted in scene inspection", severity: "major", owner: "visual", suggestedRepairRoute: "visual: unify materials/colors to the visual system" },
  { id: "scene-composition", dimension: "visual", tier: "polish", requirement: "Map is composed (spawn area, play field, landmarks), not an empty plate", evidence: "Scene structure lists spawn + play field + dressing instances", severity: "major", owner: "visual", suggestedRepairRoute: "visual: compose spawn/play/landmark layout + verify via scene inspection" },
  { id: "hierarchy-readability", dimension: "visual", tier: "polish", requirement: "Important elements (collectibles, goals, hazards) are visually distinct at a glance", evidence: "Collectible/goal instances sized/colored distinctly in scene summary", severity: "major", owner: "visual", suggestedRepairRoute: "visual: rescale/recolor key elements for readability" },
  { id: "camera-framing", dimension: "visual", tier: "polish", requirement: "Camera framing presents the action (spawn view shows goal direction)", evidence: "Screenshot or camera description shows action framing", severity: "minor", owner: "visual", suggestedRepairRoute: "visual: adjust spawn/camera framing toward the goal" },
  { id: "environment-dressing", dimension: "visual", tier: "stretch", requirement: "Environment has purposeful dressing supporting the fantasy (not meaningless props)", evidence: "Dressing instances listed with fantasy purpose", severity: "minor", owner: "visual", suggestedRepairRoute: "visual: add purposeful dressing, remove meaningless props" },
  { id: "lighting-material", dimension: "visual", tier: "stretch", requirement: "Lighting/materials are consistent where the platform supports it", evidence: "Lighting/material settings noted in scene summary", severity: "minor", owner: "visual", suggestedRepairRoute: "visual: normalize lighting/materials" },
  { id: "no-placeholder-look", dimension: "visual", tier: "polish", requirement: "No obvious placeholder-feeling elements in the final presentation", evidence: "Anti-prototype guardrail scan reports no placeholder hits", severity: "major", owner: "visual", suggestedRepairRoute: "visual: replace placeholder elements per guardrail findings" },
];

const UX: ReqDef[] = [
  { id: "ux-hierarchy", dimension: "ux", tier: "polish", requirement: "UI has clear hierarchy: primary action distinguishable from secondary navigation", evidence: "UI hierarchy lists primary vs secondary actions distinctly", severity: "major", owner: "ui", suggestedRepairRoute: "ui: restyle primary action distinctly + verify hierarchy" },
  { id: "readable-text", dimension: "ux", tier: "polish", requirement: "Text is readable (size/contrast), no giant or microscopic labels", evidence: "UI hierarchy text properties reviewed", severity: "major", owner: "ui", suggestedRepairRoute: "ui: normalize text sizes/contrast" },
  { id: "interaction-feedback", dimension: "ux", tier: "polish", requirement: "Interactions give feedback (button states, pressed/disabled visuals)", evidence: "Button states defined in UI; state updates observed", severity: "major", owner: "ui", suggestedRepairRoute: "ui: add button states + state-update wiring" },
  { id: "discoverability", dimension: "ux", tier: "polish", requirement: "Core actions are discoverable (no hidden critical buttons)", evidence: "Upgrade/menu entry point visible in HUD hierarchy", severity: "major", owner: "ui", suggestedRepairRoute: "ui: surface hidden critical actions in HUD" },
  { id: "layout-consistency", dimension: "ux", tier: "polish", requirement: "Spacing/layout is consistent; no overlapping or off-screen critical UI", evidence: "UI layout review of HUD/menu placement", severity: "minor", owner: "ui", suggestedRepairRoute: "ui: fix layout overlaps/consistency" },
  { id: "hud-information", dimension: "ux", tier: "polish", requirement: "HUD shows useful information (currency + next goal at minimum)", evidence: "HUD hierarchy contains currency + objective elements", severity: "major", owner: "ui", suggestedRepairRoute: "ui: add currency + next-goal HUD elements" },
  { id: "no-dead-ui", dimension: "ux", tier: "functionality", requirement: "No dead or unexplained UI (every visible control does something explainable)", evidence: "UI inventory: each control mapped to a behavior", severity: "blocking", owner: "ui", suggestedRepairRoute: "ui: remove or wire dead controls" },
];

const GAMEPLAY_POLISH: ReqDef[] = [
  { id: "action-feedback", dimension: "gameplay-polish", tier: "polish", requirement: "Player actions produce feedback (collect, upgrade, unlock each acknowledged)", evidence: "Runtime evidence notes feedback per action", severity: "major", owner: "gameplay", suggestedRepairRoute: "gameplay: add per-action feedback + re-test" },
  { id: "reward-feedback", dimension: "gameplay-polish", tier: "polish", requirement: "Reward moments feel rewarding (escalating signal, not silent increments)", evidence: "Reward feedback observed in runtime evidence", severity: "minor", owner: "gameplay", suggestedRepairRoute: "gameplay: escalate reward signalling" },
  { id: "meaningful-progression", dimension: "gameplay-polish", tier: "polish", requirement: "Progression is meaningful (each tier visibly faster/stronger)", evidence: "Balance config shows tier escalation; runtime confirms faster rates", severity: "major", owner: "gameplay", suggestedRepairRoute: "gameplay: rebalance tiers for visible escalation" },
  { id: "failure-states", dimension: "gameplay-polish", tier: "polish", requirement: "Failure states are understandable (player knows what happened and how to recover)", evidence: "Failure/recovery path documented and reachable", severity: "minor", owner: "gameplay", suggestedRepairRoute: "gameplay: add failure messaging + recovery path" },
  { id: "spawn-safety", dimension: "gameplay-polish", tier: "functionality", requirement: "Spawn is safe (floor beneath spawn, no instant void fall)", evidence: "Runtime spawn assertions pass; scene has floor + SpawnLocation", severity: "blocking", owner: "programmer", suggestedRepairRoute: "programmer: add floor/SpawnLocation + re-run runtime QA" },
  { id: "first-minute", dimension: "gameplay-polish", tier: "polish", requirement: "First-minute experience: goal visible, first reward earned, next step clear", evidence: "First-minute checklist observed in runtime evidence", severity: "major", owner: "gameplay", suggestedRepairRoute: "gameplay: script first-minute beats + verify" },
  { id: "no-softlocks", dimension: "gameplay-polish", tier: "functionality", requirement: "No obvious soft-locks or dead ends in the core loop", evidence: "Loop walkthrough reaches every state and back", severity: "blocking", owner: "gameplay", suggestedRepairRoute: "gameplay: remove dead-end state + re-walk loop" },
];

const TECHNICAL: ReqDef[] = [
  { id: "architecture-consistency", dimension: "technical", tier: "functionality", requirement: "Architecture follows the blueprint (module boundaries, server/client placement)", evidence: "Structural validation passes; module layout matches blueprint", severity: "blocking", owner: "architect", suggestedRepairRoute: "architect: realign modules to blueprint" },
  { id: "server-authority", dimension: "technical", tier: "functionality", requirement: "Authoritative server logic where applicable (no client-trusted currency)", evidence: "Currency/collect handled server-side in source review", severity: "blocking", owner: "programmer", suggestedRepairRoute: "programmer: move authority to server + re-validate" },
  { id: "no-duplication", dimension: "technical", tier: "polish", requirement: "No unnecessary duplication of systems (single currency, single upgrade path)", evidence: "Source review lists one owner per system", severity: "minor", owner: "programmer", suggestedRepairRoute: "programmer: consolidate duplicated systems" },
  { id: "no-dead-code", dimension: "technical", tier: "stretch", requirement: "No obvious dead code or orphaned systems without player-facing purpose", evidence: "Dead-code scan of sources", severity: "minor", owner: "programmer", suggestedRepairRoute: "programmer: remove or wire orphaned code" },
  { id: "no-runtime-errors", dimension: "technical", tier: "functionality", requirement: "No known runtime errors from project code in a live session", evidence: "Runtime logs clean; assertions pass", severity: "blocking", owner: "programmer", suggestedRepairRoute: "programmer: fix runtime errors + re-run session" },
  { id: "deterministic-build", dimension: "technical", tier: "functionality", requirement: "Build is deterministic via the platform toolchain (Rojo/npm)", evidence: "Build command exits 0 from a clean state", severity: "blocking", owner: "architect", suggestedRepairRoute: "architect: fix build config determinism" },
  { id: "safe-asset-handling", dimension: "technical", tier: "functionality", requirement: "Assets/content handled safely (no unvetted external fetches in production path)", evidence: "Asset safety review passes", severity: "blocking", owner: "architect", suggestedRepairRoute: "architect: vet or remove unsafe asset paths" },
];

const CONTENT: ReqDef[] = [
  { id: "no-placeholder-names", dimension: "content", tier: "polish", requirement: "No placeholder names (no 'Test', 'Foo', 'Untitled' in player-facing surfaces)", evidence: "Content scan of UI labels and instance names", severity: "major", owner: "content", suggestedRepairRoute: "content: rename placeholders with fantasy-coherent terms" },
  { id: "no-filler-text", dimension: "content", tier: "polish", requirement: "No obvious filler text (lorem ipsum, 'TODO', 'coming soon' as final copy)", evidence: "Content scan of labels/descriptions", severity: "major", owner: "content", suggestedRepairRoute: "content: replace filler with final copy" },
  { id: "no-debug-ui", dimension: "content", tier: "functionality", requirement: "No test/debug UI left in production (no debug buttons, cheat panels)", evidence: "UI inventory shows no debug controls", severity: "blocking", owner: "content", suggestedRepairRoute: "content: remove debug UI" },
  { id: "cohesive-terminology", dimension: "content", tier: "polish", requirement: "Terminology is cohesive (currency/upgrades/zones share one vocabulary)", evidence: "Term list consistent across UI + content configs", severity: "minor", owner: "content", suggestedRepairRoute: "content: unify terminology" },
  { id: "fantasy-support", dimension: "content", tier: "polish", requirement: "Content supports the intended game fantasy (names/copy reinforce it)", evidence: "Copy review against director fantasy statement", severity: "minor", owner: "content", suggestedRepairRoute: "content: rewrite copy toward the fantasy" },
];

const ALL_DEFS: ReqDef[] = [
  ...CORE_EXPERIENCE,
  ...VISUAL,
  ...UX,
  ...GAMEPLAY_POLISH,
  ...TECHNICAL,
  ...CONTENT,
];

/**
 * Derive a deterministic baseline quality contract from a blueprint.
 * The Director refines it; critics verify against it.
 */
export function deriveQualityContract(blueprint: ProductionBlueprint): ProductionQualityContract {
  return {
    missionGoal: blueprint.goal,
    platform: blueprint.platform,
    genre: blueprint.genre,
    requirements: ALL_DEFS.map((d) => ({ ...d, observation: "", verification: "unverified" as const })),
    createdAt: new Date().toISOString(),
  };
}

export function validateQualityContract(raw: unknown): ProductionQualityContract {
  return ProductionQualityContractSchema.parse(raw);
}

export function requirementsForDimension(
  contract: ProductionQualityContract,
  dimension: QualityDimension,
): QualityRequirement[] {
  return contract.requirements.filter((r) => r.dimension === dimension);
}

export function requiredForGate(contract: ProductionQualityContract): QualityRequirement[] {
  // Stretch tier never blocks production completion unless the blueprint
  // marks it required (it doesn't by default).
  return contract.requirements.filter((r) => r.tier !== "stretch");
}

export function markRequirementVerified(
  contract: ProductionQualityContract,
  id: string,
  verification: VerificationStatus,
  observation = "",
): ProductionQualityContract {
  return {
    ...contract,
    requirements: contract.requirements.map((r) =>
      r.id === id ? { ...r, verification, observation: observation.slice(0, 1000) } : r,
    ),
  };
}
