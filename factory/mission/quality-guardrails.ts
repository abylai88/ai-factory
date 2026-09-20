import type { QualityFinding } from "./quality-critics.js";

/**
 * Anti-prototype guardrails (Phase 10) — final-quality gate concerns.
 *
 * Prototyping is never banned internally; these checks run at the
 * production-quality gate against common weak-AI output patterns:
 * default graybox, placeholder UI, arbitrary colors, giant text,
 * meaningless decor, empty maps, missing onboarding/feedback,
 * hierarchy-less buttons, disconnected progression, generic copy,
 * exposed debug controls, duplicated systems, dead content, and
 * systems without player-facing purpose.
 */

export interface GuardrailSignal {
  id: string;
  label: string;
  pattern: RegExp;
  requirementId: string;
  dimension: QualityFinding["dimension"];
  severity: QualityFinding["severity"];
  repairObjective: string;
  verificationRequirement: string;
}

const SIGNALS: GuardrailSignal[] = [
  { id: "graybox", label: "default-looking graybox environment", pattern: /empty baseplate|gray[ -]?box|default gray|medium stone gray|smoothplastic gray|no dressing/i, requirementId: "visual-identity", dimension: "visual", severity: "major", repairObjective: "Apply deliberate zone palettes + dressing per director visual identity", verificationRequirement: "Scene summary lists palettes; screenshot shows identity" },
  { id: "placeholder-ui", label: "placeholder UI", pattern: /placeholder.*(ui|button|menu|label)|default.*screen ?gui|unnamed.*button/i, requirementId: "no-placeholder-look", dimension: "visual", severity: "major", repairObjective: "Replace placeholder UI with final hierarchy per UX principles", verificationRequirement: "UI hierarchy review shows final controls" },
  { id: "arbitrary-colors", label: "arbitrary colors with no visual system", pattern: /random color|arbitrary colou?r|clashing colou?rs|neon.*everything/i, requirementId: "style-consistency", dimension: "visual", severity: "major", repairObjective: "Unify colors to the visual system palette", verificationRequirement: "Color coherence noted in scene review" },
  { id: "giant-text", label: "giant text everywhere", pattern: /giant text|text.*(200|500)px|fullscreen label|all-caps everywhere/i, requirementId: "readable-text", dimension: "ux", severity: "major", repairObjective: "Normalize text sizes/contrast per UI hierarchy", verificationRequirement: "UI hierarchy text properties reviewed" },
  { id: "meaningless-decor", label: "meaningless decorative objects", pattern: /meaningless.*(prop|decor)|random.*(part|model).*no purpose|decorative.*no.*purpose/i, requirementId: "environment-dressing", dimension: "visual", severity: "minor", repairObjective: "Remove or repurpose meaningless props toward the fantasy", verificationRequirement: "Dressing list ties each prop to a purpose" },
  { id: "empty-map", label: "empty map", pattern: /empty map|no collectibles|no landmarks|just.*(baseplate|floor).*nothing/i, requirementId: "scene-composition", dimension: "visual", severity: "major", repairObjective: "Compose spawn + play field + landmarks + collectible field", verificationRequirement: "Scene inspection lists all four" },
  { id: "no-onboarding", label: "no onboarding", pattern: /no onboarding|no.*(prompt|tutorial|goal label)|player.*doesn.?t know.*do/i, requirementId: "onboarding", dimension: "ux", severity: "major", repairObjective: "Add first-action prompt with fantasy wording", verificationRequirement: "Onboarding present in UI or spawn area" },
  { id: "no-feedback", label: "no action feedback", pattern: /no.*(feedback|effect|sound|response)|silent.*(collect|reward|upgrade)|button.*nothing happens/i, requirementId: "action-feedback", dimension: "gameplay", severity: "major", repairObjective: "Add per-action feedback (effect/sound/counter tick)", verificationRequirement: "Feedback observed in runtime evidence" },
  { id: "flat-buttons", label: "buttons without hierarchy", pattern: /buttons?.*no hierarchy|primary.*indistinguishable|all buttons.*(same|identical)/i, requirementId: "ux-hierarchy", dimension: "ux", severity: "major", repairObjective: "Restyle primary action distinctly from secondary navigation", verificationRequirement: "UI hierarchy shows distinct primary" },
  { id: "dead-progression", label: "disconnected progression", pattern: /disconnected progression|upgrade.*does nothing|progression.*no effect|dead.?end.*loop/i, requirementId: "meaningful-progression", dimension: "gameplay", severity: "major", repairObjective: "Wire progression tiers to visible effects", verificationRequirement: "Tier escalation observed in runtime" },
  { id: "generic-copy", label: "generic copy", pattern: /lorem ipsum|\bTODO\b|coming soon|test game|foo bar|untitled/i, requirementId: "no-filler-text", dimension: "technical", severity: "major", repairObjective: "Replace filler with final fantasy-coherent copy", verificationRequirement: "Content scan clean" },
  { id: "debug-exposed", label: "debug/test controls exposed to player", pattern: /debug button|cheat|god ?mode|admin panel|test controls?/i, requirementId: "no-debug-ui", dimension: "technical", severity: "blocking", repairObjective: "Remove debug/test controls from production", verificationRequirement: "UI inventory shows no debug controls" },
  { id: "dup-systems", label: "duplicate/redundant systems", pattern: /duplicate.*system|two currencies|redundant.*(upgrade|collect)/i, requirementId: "no-duplication", dimension: "technical", severity: "minor", repairObjective: "Consolidate to a single owner per system", verificationRequirement: "Source review lists one owner per system" },
  { id: "dead-content", label: "obvious dead content", pattern: /dead.*(button|control|content|ui)|orphaned.*system|unused.*system/i, requirementId: "no-dead-ui", dimension: "ux", severity: "blocking", repairObjective: "Remove or wire dead content", verificationRequirement: "Every control mapped to a behavior" },
  { id: "purposeless-system", label: "systems without player-facing purpose", pattern: /no player.*purpose|invisible system|backend.*never.*(shown|surfaced)/i, requirementId: "no-dead-code", dimension: "technical", severity: "minor", repairObjective: "Surface the system to the player or remove it", verificationRequirement: "Every system has a player-facing purpose" },
];

export function listGuardrailSignals(): GuardrailSignal[] {
  return [...SIGNALS];
}

/**
 * Scan bounded evidence text (sources, scene summaries, UI inventories,
 * runtime notes) for anti-prototype patterns. Returns concrete candidate
 * findings — never a numeric "AI quality score".
 */
export function scanForPrototypePatterns(input: {
  sources?: string[];
  sceneSummary?: string;
  uiInventory?: string;
  runtimeNotes?: string;
  affectedArea?: string;
}): Omit<QualityFinding, "id" | "createdAt">[] {
  const blob = [
    ...(input.sources ?? []),
    input.sceneSummary ?? "",
    input.uiInventory ?? "",
    input.runtimeNotes ?? "",
  ].join("\n");
  if (!blob.trim()) return [];
  const out: Omit<QualityFinding, "id" | "createdAt">[] = [];
  for (const signal of SIGNALS) {
    if (signal.pattern.test(blob)) {
      const idx = blob.search(signal.pattern);
      out.push({
        dimension: signal.dimension,
        severity: signal.severity,
        evidence: `Guardrail "${signal.label}" matched: …${blob.slice(Math.max(0, idx - 80), idx + 120).trim().slice(0, 400)}…`,
        affectedArea: input.affectedArea ?? "",
        violatedRequirement: signal.requirementId,
        why: `Anti-prototype guardrail "${signal.label}" fired; violates ${signal.requirementId}.`,
        proposedOwner: signal.dimension === "visual" ? "visual" : signal.dimension === "ux" ? "ui" : signal.dimension === "gameplay" ? "gameplay" : signal.requirementId === "no-filler-text" || signal.requirementId === "no-debug-ui" ? "content" : "programmer",
        repairObjective: signal.repairObjective,
        verificationRequirement: signal.verificationRequirement,
      });
    }
  }
  return out;
}
