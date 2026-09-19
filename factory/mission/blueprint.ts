import { z } from "zod";

/**
 * Production Blueprint — structured pre-implementation contract.
 *
 * Created BEFORE implementation begins. Structured data where practical,
 * never a giant free-form document. The Director produces it from the
 * high-level goal (+ research signals); every downstream specialist
 * consumes a role-specific slice of it.
 */

export const BlueprintPlatformSchema = z.enum(["roblox", "web"]);
export type BlueprintPlatform = z.infer<typeof BlueprintPlatformSchema>;

export const ProductionBlueprintSchema = z.object({
  goal: z.string().min(1),
  platform: BlueprintPlatformSchema,
  genre: z.string().min(1),
  coreLoop: z.string().min(1),
  progression: z.string().min(1),
  monetization: z.string().default("none"),
  playerExperience: z.string().min(1),
  visualDirection: z.string().min(1),
  uiDirection: z.string().min(1),
  technicalArchitecture: z.string().min(1),
  requiredSystems: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).min(1),
  qaCriteria: z.array(z.string()).min(1),
  performanceConstraints: z.array(z.string()).default([]),
  launchCriteria: z.array(z.string()).min(1),
  createdAt: z.string(),
});
export type ProductionBlueprint = z.infer<typeof ProductionBlueprintSchema>;

const ROBLOX_HINTS = ["roblox", "luau", "rojo", "simulator", "obby", "tycoon"];

function detectPlatform(goal: string): BlueprintPlatform {
  const lower = goal.toLowerCase();
  if (lower.includes("phaser") || lower.includes("web") || lower.includes("yandex")) return "web";
  if (ROBLOX_HINTS.some((h) => lower.includes(h))) return "roblox";
  return "web";
}

function detectGenre(goal: string): string {
  const lower = goal.toLowerCase();
  if (/simulator|tycoon/.test(lower)) return "simulator";
  if (/obby|platformer/.test(lower)) return "platformer";
  if (/fighter|arcade/.test(lower)) return "arcade";
  if (/survival/.test(lower)) return "survival";
  if (/puzzle|match/.test(lower)) return "puzzle";
  return "casual";
}

function detectLoop(goal: string, genre: string): string {
  const lower = goal.toLowerCase();
  if (/min(e|ing)|collect.*coin|coin/.test(lower)) {
    return "collect resources → earn currency → upgrade tools → unlock zones → repeat with visible progression";
  }
  if (genre === "platformer") return "traverse obstacles → reach checkpoints → unlock levels → repeat with rising difficulty";
  return "play core action → earn reward → progress → repeat with visible progression";
}

/**
 * Derive a deterministic baseline blueprint from a high-level goal.
 * The Director (LLM or human) refines this — it is never presented as a
 * final design, only as the structured starting contract.
 */
export function deriveBlueprintFromGoal(goal: string): ProductionBlueprint {
  const trimmed = (goal ?? "").trim();
  if (!trimmed) throw new Error("Blueprint goal must be a non-empty string");
  const platform = detectPlatform(trimmed);
  const genre = detectGenre(trimmed);
  const coreLoop = detectLoop(trimmed, genre);
  const isRoblox = platform === "roblox";
  return {
    goal: trimmed,
    platform,
    genre,
    coreLoop,
    progression: "tools → zones → multipliers, each tier visibly faster than the last",
    monetization: isRoblox
      ? "game passes / developer products for boosts; no pay-to-win gating of the core loop"
      : "optional ads/rewards where platform-appropriate; core loop fully playable free",
    playerExperience: "fast feedback within seconds of spawn; always-visible next goal",
    visualDirection: isRoblox
      ? "bright readable baseplate, distinct zone palettes, large readable collectibles"
      : "readable canvas, distinct palette per zone/level, large readable pickups",
    uiDirection: "single HUD (currency + next upgrade), one upgrade menu, progress bar toward next unlock",
    technicalArchitecture: isRoblox
      ? "server-authoritative state, RemoteEvents for collect/upgrade, DataStore persistence, Rojo src/ layout"
      : "Phaser scenes + data-driven configs, deterministic build via npm",
    requiredSystems: isRoblox
      ? ["spawn", "collect", "currency", "upgrades", "zones", "persistence", "upgrade-ui"]
      : ["boot", "core-loop", "currency", "upgrades", "levels", "hud"],
    risks: ["scope creep beyond core loop", "unclear next-goal signalling"],
    acceptanceCriteria: [
      "player can spawn",
      "core loop completes end-to-end",
      "progression persists and advances",
      "no project-originated runtime errors",
    ],
    qaCriteria: [
      "build/structural validation passes",
      "runtime assertions pass in a live session",
      "main view readable, key UI visible",
    ],
    performanceConstraints: isRoblox
      ? ["place loads within Studio defaults", "no per-frame server spam"]
      : ["60fps on target device class", "no unbound asset growth"],
    launchCriteria: ["acceptance criteria pass", "QA hierarchy levels 1-5 pass", "teardown evidence recorded"],
    createdAt: new Date().toISOString(),
  };
}

export function validateBlueprint(raw: unknown): ProductionBlueprint {
  return ProductionBlueprintSchema.parse(raw);
}

/** Role-specific slice so agents get summaries, not the whole blueprint. */
export function blueprintSliceForRole(
  blueprint: ProductionBlueprint,
  role: string,
): string {
  const r = role.toLowerCase();
  const lines = [`BLUEPRINT: ${blueprint.genre} (${blueprint.platform})`, `Goal: ${blueprint.goal}`, `Core loop: ${blueprint.coreLoop}`];
  if (["programmer", "developer", "architect", "builder", "gameplay"].includes(r)) {
    lines.push(`Architecture: ${blueprint.technicalArchitecture}`);
    lines.push(`Systems: ${blueprint.requiredSystems.join(", ")}`);
  }
  if (["visual", "designer"].includes(r)) lines.push(`Visual: ${blueprint.visualDirection}`);
  if (["ui", "designer", "content"].includes(r)) lines.push(`UI: ${blueprint.uiDirection}`);
  if (["qa", "tester", "reviewer", "repair"].includes(r)) {
    lines.push(`Acceptance: ${blueprint.acceptanceCriteria.join("; ")}`);
    lines.push(`QA: ${blueprint.qaCriteria.join("; ")}`);
  }
  if (["researcher", "market", "competitor", "idea", "director", "monetization"].includes(r)) {
    lines.push(`Progression: ${blueprint.progression}`);
    lines.push(`Monetization: ${blueprint.monetization}`);
  }
  return lines.join("\n");
}
