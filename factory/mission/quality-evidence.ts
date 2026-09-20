import type { CriticEvidence } from "./quality-critics.js";
import type { EnsureProjectReadyResult } from "../roblox/project-ready.js";
import type { ManagedPlaytestResult } from "../studio/playtest-lifecycle.js";
import { scrubEphemeralIds } from "./readiness-evidence.js";

/**
 * Real Roblox quality evidence (Phase 7).
 *
 * Reuses current capabilities instead of inventing new ones: scene
 * inspection summaries, project-ready state, playtest lifecycle results,
 * runtime assertions, screenshot references, and validation-gate output.
 * Quality critics consume this — never fabricated observations.
 *
 * Every builder returns honest "unavailable" markers when the underlying
 * capability produced no evidence.
 */

export interface RobloxQualityInputs {
  sceneSummary?: string;
  /** Bounded StarterGui/UI inventory summary (see factory/roblox/ui-evidence.ts). */
  uiInventory?: string;
  readiness?: EnsureProjectReadyResult | null;
  playtest?: ManagedPlaytestResult | null;
  screenshotRef?: string;
  runtimeLogs?: string;
  validationOutput?: string;
  blueprintText?: string;
}

export interface RobloxQualityEvidence extends CriticEvidence {
  mapCompositionNotes: string[];
  interactionReadabilityNotes: string[];
  placeholderNotes: string[];
}

/** Summarize map composition from a scene-inspection summary. */
export function summarizeMapComposition(sceneSummary: string): string[] {
  const notes: string[] = [];
  const s = sceneSummary ?? "";
  if (!s.trim()) return ["map composition: no scene evidence (unavailable)"];
  if (/spawnlocation/i.test(s)) notes.push("spawn presentation: SpawnLocation present");
  else notes.push("spawn presentation: NO SpawnLocation found in scene summary");
  if (/baseplate|ground|floor/i.test(s)) notes.push("ground: floor/BasePlate present");
  else notes.push("ground: NO floor/BasePlate found in scene summary");
  if (/collect/i.test(s)) notes.push("collectibles: collectible instances listed");
  else notes.push("collectibles: none listed in scene summary");
  const similar = (s.match(/part|meshpart/gi) ?? []).length;
  notes.push(`structure density: ~${similar} part-like mentions`);
  if (/gray|medium stone|plastic.*gray|smoothplastic/i.test(s) && !/color|material.*(gold|teal|bright|neon)/i.test(s)) {
    notes.push("default-look risk: materials read as default gray plastic");
  }
  if (/test|foo|untitled|placeholder|debug/i.test(s)) notes.push("placeholder risk: placeholder-like names in scene summary");
  return notes;
}

/** Summarize interaction readability from scene + runtime evidence. */
export function summarizeInteractionReadability(input: RobloxQualityInputs): string[] {
  const notes: string[] = [];
  const blob = [input.sceneSummary ?? "", input.playtest ? JSON.stringify(input.playtest.assertions).slice(0, 1000) : "", input.runtimeLogs ?? ""].join("\n");
  if (!blob.trim()) return ["interaction readability: no evidence (unavailable)"];
  if (/upgrade.*gui|hud|screen ?gui|surface ?gui|proximity ?prompt|click ?detector/i.test(blob)) {
    notes.push("interaction readability: UI/prompt affordance present");
  } else {
    notes.push("interaction readability: NO UI/prompt affordance found in evidence");
  }
  if (/feedback|reward|effect|sound|tween/i.test(blob)) notes.push("gameplay feedback: feedback signal present");
  else notes.push("gameplay feedback: NO feedback signal found in evidence");
  return notes;
}

/** Surface placeholder content signals honestly. */
export function detectRobloxPlaceholderContent(input: RobloxQualityInputs): string[] {
  const notes: string[] = [];
  const blob = [input.sceneSummary ?? "", input.validationOutput ?? "", input.runtimeLogs ?? ""].join("\n");
  if (!blob.trim()) return [];
  if (/\btest\b|\bfoo\b|untitled|lorem|todo|coming soon/i.test(blob)) {
    notes.push(`placeholder content: placeholder-like text in evidence: ${blob.slice(0, 200)}`);
  }
  if (/debug.*button|cheat|godmode|admin.*panel/i.test(blob)) {
    notes.push("debug UI risk: test/debug controls referenced in evidence");
  }
  return notes;
}

/**
 * Build critic-ready evidence from real Roblox lifecycle outputs.
 * Never invents observations: missing inputs stay missing.
 */
export function buildRobloxQualityEvidence(input: RobloxQualityInputs): RobloxQualityEvidence {
  const sources: string[] = [];
  if (input.validationOutput?.trim()) sources.push(`validation: ${scrubEphemeralIds(input.validationOutput).slice(0, 800)}`);
  if (input.runtimeLogs?.trim()) sources.push(`runtime logs: ${scrubEphemeralIds(input.runtimeLogs).slice(0, 800)}`);
  if (input.uiInventory?.trim()) sources.push(`UI hierarchy: ${scrubEphemeralIds(input.uiInventory).slice(0, 800)}`);

  let runtimeSummary: string | undefined;
  if (input.playtest) {
    const p = input.playtest;
    const passed = p.assertions.filter((a) => a.passed).length;
    const parts = [
      `playtest ${p.status} (${p.state}, ${p.durationMs}ms)`,
      `assertions: ${passed}/${p.assertions.length}`,
      ...p.assertions.map((a) => `- ${a.passed ? "PASS" : "FAIL"} ${a.name}${a.message ? `: ${a.message}` : ""}`),
    ];
    if (p.infraReason) parts.push(`infra: ${p.infraReason.slice(0, 200)}`);
    if (p.evidence.teardownUnconfirmed) parts.push("teardown: unconfirmed");
    runtimeSummary = scrubEphemeralIds(parts.join("; ")).slice(0, 1500);
  }
  const assertionSummary = input.playtest
    ? input.playtest.assertions.map((a) => `${a.name}:${a.passed ? "pass" : "fail"}`).join(", ").slice(0, 500)
    : undefined;

  let qaSummary: string | undefined;
  if (input.readiness) {
    qaSummary = scrubEphemeralIds(
      input.readiness.ok
        ? [`readiness ok`, input.readiness.state].join("; ")
        : [`readiness not-ok`, input.readiness.code, input.readiness.reason.slice(0, 200)].join("; "),
    ).slice(0, 500);
  }

  const sceneSummary = input.sceneSummary?.trim()
    ? scrubEphemeralIds(input.sceneSummary).slice(0, 1500)
    : undefined;

  return {
    sources,
    sceneSummary,
    runtimeSummary,
    screenshotRef: input.screenshotRef?.trim() ? input.screenshotRef.trim().slice(0, 500) : undefined,
    assertionSummary,
    qaSummary,
    blueprintText: input.blueprintText?.slice(0, 1000),
    mapCompositionNotes: summarizeMapComposition(input.sceneSummary ?? ""),
    interactionReadabilityNotes: summarizeInteractionReadability(input),
    placeholderNotes: detectRobloxPlaceholderContent(input),
  };
}
