import { z } from "zod";
import type { CriticDimension } from "./quality-contract.js";
import type { ProductionQualityContract, QualityRequirement } from "./quality-contract.js";
import type { SpecialistRole } from "./specialist-roles.js";

/**
 * Critic loop — post-implementation quality review stage.
 *
 * Reuses reviewer/qa concepts (never a parallel orchestration): critics
 * inspect ACTUAL available evidence only. A critic must never invent a
 * screenshot or runtime observation. When vision evidence is unavailable
 * the visual critic records VISUAL_UNAVAILABLE honestly and never emits
 * a fabricated visual PASS.
 */

export const QualityFindingSchema = z.object({
  id: z.string().min(1).max(100),
  dimension: z.enum(["visual", "ux", "gameplay", "technical"]),
  severity: z.enum(["blocking", "major", "minor", "stretch"]),
  evidence: z.string().min(1).max(2000),
  affectedArea: z.string().max(500).default(""),
  violatedRequirement: z.string().min(1).max(200),
  why: z.string().min(1).max(1000),
  proposedOwner: z.string().min(1).max(50),
  repairObjective: z.string().min(1).max(1000),
  verificationRequirement: z.string().min(1).max(1000),
  createdAt: z.string(),
});
export type QualityFinding = z.infer<typeof QualityFindingSchema>;

/** Honest sentinel statuses — never silently converted to PASS. */
export const VISUAL_UNAVAILABLE = "VISUAL_UNAVAILABLE";

export interface CriticEvidence {
  /** Source/artifact text available for review (bounded summaries). */
  sources?: string[];
  /** Roblox scene structure summary (from scene inspection). */
  sceneSummary?: string;
  /** Runtime state summary (playtest + assertions + logs). */
  runtimeSummary?: string;
  /** Screenshot/viewport evidence reference (path or description). Absent = unavailable. */
  screenshotRef?: string;
  /** Existing runtime assertions summary. */
  assertionSummary?: string;
  /** Existing QA results summary. */
  qaSummary?: string;
  /** Mission blueprint / director quality requirements text. */
  blueprintText?: string;
}

export interface CriticReview {
  dimension: CriticDimension;
  status: "pass" | "fail" | "unavailable";
  findings: QualityFinding[];
  evidenceNotes: string[];
  reviewedAt: string;
}

let findingCounter = 0;
function findingId(dimension: CriticDimension): string {
  findingCounter += 1;
  return `QF-${dimension.toUpperCase().slice(0, 2)}-${Date.now().toString(36)}-${findingCounter}`;
}

function hasEvidence(text: string | undefined, ...keywords: RegExp[]): boolean {
  if (!text) return false;
  return keywords.some((re) => re.test(text));
}

function req(id: string, contract?: ProductionQualityContract): QualityRequirement | undefined {
  return contract?.requirements.find((r) => r.id === id);
}

function makeFinding(input: Omit<QualityFinding, "id" | "createdAt">): QualityFinding {
  return {
    ...input,
    id: findingId(input.dimension),
    createdAt: new Date().toISOString(),
  };
}

const VAGUE_FINDING_PATTERNS = [/make it better/i, /^ui looks bad$/i, /^fix visuals$/i];

/** Reject vague findings at construction time. */
export function isVagueFinding(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 20) return true;
  return VAGUE_FINDING_PATTERNS.some((re) => re.test(t));
}

/** Visual critic: requires screenshotRef for a PASS; else VISUAL_UNAVAILABLE. */
export function runVisualCritic(
  evidence: CriticEvidence,
  contract?: ProductionQualityContract,
): CriticReview {
  const notes: string[] = [];
  const findings: QualityFinding[] = [];
  const scene = evidence.sceneSummary ?? "";
  const shot = evidence.screenshotRef ?? "";

  if (!shot.trim()) {
    notes.push(`${VISUAL_UNAVAILABLE}: no screenshot/viewport evidence provided; visual PASS withheld honestly.`);
    // Scene-structure reasoning is still allowed WITHOUT claiming visual PASS.
    if (scene && /empty|gray\s?box|default|no .*dressing|placeholder/i.test(scene)) {
      const r = req("scene-composition", contract);
      findings.push(makeFinding({
        dimension: "visual",
        severity: "major",
        evidence: `Scene summary: ${scene.slice(0, 500)} (no screenshot; structure-only observation)`,
        affectedArea: "Workspace scene composition",
        violatedRequirement: r?.id ?? "scene-composition",
        why: "Scene summary describes an empty/default composition; violates scene-composition requirement even without pixels.",
        proposedOwner: "visual",
        repairObjective: "Compose spawn + play field + landmarks per director scene plan",
        verificationRequirement: "Re-inspect scene structure; screenshot still required for visual PASS",
      }));
    }
    return { dimension: "visual", status: "unavailable", findings, evidenceNotes: notes, reviewedAt: new Date().toISOString() };
  }

  notes.push(`Screenshot evidence: ${shot.slice(0, 200)}`);
  const blob = [scene, shot, evidence.qaSummary ?? ""].join("\n");
  if (hasEvidence(blob, /gray\s?box|empty baseplate|default gray|placeholder/i)) {
    findings.push(makeFinding({
      dimension: "visual",
      severity: "major",
      evidence: `Screenshot/scene observation: ${blob.slice(0, 500)}`,
      affectedArea: "Workspace environment",
      violatedRequirement: req("visual-identity", contract)?.id ?? "visual-identity",
      why: "Presentation reads as default graybox; violates visual-identity requirement for a deliberate palette/mood.",
      proposedOwner: "visual",
      repairObjective: "Apply zone palettes + dressing per director visual identity",
      verificationRequirement: "New screenshot shows deliberate palette; scene summary lists zone palettes",
    }));
  }
  if (hasEvidence(blob, /unreadable|tiny text|giant text|clash/i)) {
    findings.push(makeFinding({
      dimension: "visual",
      severity: "major",
      evidence: `Readability observation: ${blob.slice(0, 500)}`,
      affectedArea: "Scene/UI readability",
      violatedRequirement: req("hierarchy-readability", contract)?.id ?? "hierarchy-readability",
      why: "Key elements are not visually distinct at a glance; violates hierarchy/readability.",
      proposedOwner: "visual",
      repairObjective: "Rescale/recolor key elements so collectibles and goals read at a glance",
      verificationRequirement: "Screenshot review confirms distinct key elements",
    }));
  }
  if (scene && /no .*collectible|missing.*collect|empty.*field/i.test(scene)) {
    findings.push(makeFinding({
      dimension: "visual",
      severity: "major",
      evidence: `Scene summary: ${scene.slice(0, 500)}`,
      affectedArea: "Collectible field",
      violatedRequirement: req("scene-composition", contract)?.id ?? "scene-composition",
      why: "Play field lacks the collectible content the loop needs; violates scene composition.",
      proposedOwner: "visual",
      repairObjective: "Place readable collectible field per scene plan",
      verificationRequirement: "Scene inspection lists collectible instances; screenshot shows them",
    }));
  }
  return {
    dimension: "visual",
    status: findings.length > 0 ? "fail" : "pass",
    findings,
    evidenceNotes: notes,
    reviewedAt: new Date().toISOString(),
  };
}

/** UX critic: inspects UI hierarchy evidence. */
export function runUxCritic(evidence: CriticEvidence, contract?: ProductionQualityContract): CriticReview {
  const notes: string[] = [];
  const findings: QualityFinding[] = [];
  const ui = [evidence.sceneSummary ?? "", evidence.runtimeSummary ?? "", evidence.qaSummary ?? "", ...(evidence.sources ?? [])].join("\n");

  const check = (
    requirementId: string,
    pattern: RegExp,
    repairObjective: string,
    verificationRequirement: string,
    affectedArea: string,
    severity: QualityFinding["severity"] = "major",
  ): void => {
    if (pattern.test(ui)) {
      const r = req(requirementId, contract);
      findings.push(makeFinding({
        dimension: "ux",
        severity,
        evidence: `UI evidence excerpt: ${ui.slice(0, 500)}`,
        affectedArea,
        violatedRequirement: r?.id ?? requirementId,
        why: `Observed pattern violates the ${requirementId} quality requirement.`,
        proposedOwner: "ui",
        repairObjective,
        verificationRequirement,
      }));
    }
  };

  if (!/currency|coin.*count|hud/i.test(ui)) {
    const r = req("hud-information", contract);
    findings.push(makeFinding({
      dimension: "ux",
      severity: "major",
      evidence: `UI evidence excerpt: ${ui.slice(0, 500)}`,
      affectedArea: "HUD",
      violatedRequirement: r?.id ?? "hud-information",
      why: "No currency/next-goal HUD element found in available UI evidence; violates HUD information requirement.",
      proposedOwner: "ui",
      repairObjective: "Add HUD showing currency + next goal at all times",
      verificationRequirement: "UI hierarchy lists currency + objective elements after repair",
    }));
  }
  check("ux-hierarchy", /primary.*indistinguishable|no.*hierarchy|all buttons.*same/i, "Restyle primary action distinctly from secondary navigation", "Inspect UI hierarchy: primary vs secondary actions distinct", "Upgrade UI");
  check("no-dead-ui", /dead.*button|button.*no.*action|unexplained.*ui|debug.*button|cheat/i, "Remove or wire dead/debug controls", "UI inventory maps every visible control to a behavior", "UI inventory", "blocking");
  check("interaction-feedback", /no.*button.*state|missing.*pressed|no.*feedback/i, "Add button states + state-update wiring", "Button states defined; state updates observed", "Buttons");
  check("onboarding", /no.*onboarding|no.*prompt|no.*goal.*label/i, "Add first-action onboarding prompt with fantasy wording", "Onboarding prompt present in UI hierarchy or spawn area", "Onboarding");
  notes.push(`UX evidence chars reviewed: ${ui.length}`);
  return { dimension: "ux", status: findings.length > 0 ? "fail" : "pass", findings, evidenceNotes: notes, reviewedAt: new Date().toISOString() };
}

/** Gameplay critic: inspects runtime/assertion evidence. */
export function runGameplayCritic(evidence: CriticEvidence, contract?: ProductionQualityContract): CriticReview {
  const notes: string[] = [];
  const findings: QualityFinding[] = [];
  const run = [evidence.runtimeSummary ?? "", evidence.assertionSummary ?? "", evidence.qaSummary ?? "", ...(evidence.sources ?? [])].join("\n");

  if (!run.trim()) {
    notes.push("No runtime evidence available; gameplay verdict withheld (unavailable).");
    return { dimension: "gameplay", status: "unavailable", findings, evidenceNotes: notes, reviewedAt: new Date().toISOString() };
  }
  notes.push(`Runtime evidence chars reviewed: ${run.length}`);

  const check = (
    requirementId: string,
    present: boolean,
    repairObjective: string,
    verificationRequirement: string,
    affectedArea: string,
    severity: QualityFinding["severity"] = "major",
  ): void => {
    if (!present) {
      const r = req(requirementId, contract);
      findings.push(makeFinding({
        dimension: "gameplay",
        severity,
        evidence: `Runtime evidence excerpt: ${run.slice(0, 500)}`,
        affectedArea,
        violatedRequirement: r?.id ?? requirementId,
        why: `Required gameplay signal for ${requirementId} is absent from runtime evidence.`,
        proposedOwner: "gameplay",
        repairObjective,
        verificationRequirement,
      }));
    }
  };

  check("core-loop-clarity", /collect|loop.*pass|assertion.*pass|upgrade.*pass/i.test(run), "Wire the missing loop step end-to-end", "Runtime assertions for each loop step pass", "Core loop", "blocking");
  check("reward-feedback-clarity", /feedback|counter.*tick|effect|sound|reward/i.test(run), "Add collect reward feedback (effect/sound/counter tick)", "Reward feedback observed in runtime evidence", "Reward feedback");
  check("spawn-safety", /spawn.*safe|floor|spawnlocation/i.test(run), "Add floor + SpawnLocation; re-run runtime QA", "Spawn assertions pass; no void fall", "Spawn", "blocking");
  check("first-minute", /first.*minute|onboard|first.*collect/i.test(run), "Script first-minute beats (spawn → collect → upgrade)", "First-minute checklist observed", "First minute");
  return { dimension: "gameplay", status: findings.length > 0 ? "fail" : "pass", findings, evidenceNotes: notes, reviewedAt: new Date().toISOString() };
}

/** Technical reviewer: inspects source/structural evidence. */
export function runTechnicalCritic(evidence: CriticEvidence, contract?: ProductionQualityContract): CriticReview {
  const notes: string[] = [];
  const findings: QualityFinding[] = [];
  const src = [...(evidence.sources ?? []), evidence.qaSummary ?? "", evidence.runtimeSummary ?? ""].join("\n");

  if (!src.trim()) {
    notes.push("No source evidence available; technical verdict withheld (unavailable).");
    return { dimension: "technical", status: "unavailable", findings, evidenceNotes: notes, reviewedAt: new Date().toISOString() };
  }
  notes.push(`Source evidence chars reviewed: ${src.length}`);

  if (/runtime error|stack trace|attempt to index nil|unknown global/i.test(src)) {
    const r = req("no-runtime-errors", contract);
    findings.push(makeFinding({
      dimension: "technical",
      severity: "blocking",
      evidence: `Source/runtime excerpt: ${src.slice(0, 500)}`,
      affectedArea: "Runtime errors",
      violatedRequirement: r?.id ?? "no-runtime-errors",
      why: "Project code produces runtime errors in a live session.",
      proposedOwner: "programmer",
      repairObjective: "Fix runtime errors; re-run live session with clean logs",
      verificationRequirement: "Runtime logs clean; assertions pass",
    }));
  }
  if (/client.*currency|currency.*localscript|client.*trusted/i.test(src)) {
    const r = req("server-authority", contract);
    findings.push(makeFinding({
      dimension: "technical",
      severity: "blocking",
      evidence: `Source excerpt: ${src.slice(0, 500)}`,
      affectedArea: "Server authority",
      violatedRequirement: r?.id ?? "server-authority",
      why: "Currency/collect logic appears client-trusted; violates server-authority requirement.",
      proposedOwner: "programmer",
      repairObjective: "Move currency authority to the server",
      verificationRequirement: "Source review confirms server-side currency handling",
    }));
  }
  if (/duplicate.*system|two.*currenc|copy.*upgrade/i.test(src)) {
    findings.push(makeFinding({
      dimension: "technical",
      severity: "minor",
      evidence: `Source excerpt: ${src.slice(0, 500)}`,
      affectedArea: "System duplication",
      violatedRequirement: req("no-duplication", contract)?.id ?? "no-duplication",
      why: "Unnecessary duplication of a player-facing system.",
      proposedOwner: "programmer",
      repairObjective: "Consolidate duplicated systems to a single owner",
      verificationRequirement: "Source review lists one owner per system",
    }));
  }
  if (/placeholder|todo|debug.*ui|lorem/i.test(src)) {
    findings.push(makeFinding({
      dimension: "technical",
      severity: "major",
      evidence: `Source excerpt: ${src.slice(0, 500)}`,
      affectedArea: "Placeholder content",
      violatedRequirement: req("no-placeholder-names", contract)?.id ?? "no-placeholder-names",
      why: "Placeholder/filler content present in player-facing surfaces.",
      proposedOwner: "content",
      repairObjective: "Replace placeholders with final fantasy-coherent content",
      verificationRequirement: "Content scan clean after repair",
    }));
  }
  return { dimension: "technical", status: findings.length > 0 ? "fail" : "pass", findings, evidenceNotes: notes, reviewedAt: new Date().toISOString() };
}

/** Run all four critics and aggregate. */
export function runAllCritics(
  evidence: CriticEvidence,
  contract?: ProductionQualityContract,
): { reviews: CriticReview[]; findings: QualityFinding[] } {
  const reviews = [
    runVisualCritic(evidence, contract),
    runUxCritic(evidence, contract),
    runGameplayCritic(evidence, contract),
    runTechnicalCritic(evidence, contract),
  ];
  return { reviews, findings: reviews.flatMap((r) => r.findings) };
}

export function validateQualityFinding(raw: unknown): QualityFinding {
  const parsed = QualityFindingSchema.parse(raw);
  if (isVagueFinding(parsed.repairObjective) || isVagueFinding(parsed.verificationRequirement)) {
    throw new Error(`Vague quality finding rejected (${parsed.id}): repair objective and verification must be concrete`);
  }
  return parsed;
}

/** Map a validated finding to its owning specialist role. */
export function ownerForFinding(finding: QualityFinding): SpecialistRole {
  const o = (finding.proposedOwner ?? "").toLowerCase();
  if (["visual", "ui", "gameplay", "content", "programmer", "architect", "qa", "reviewer", "director", "monetization", "researcher", "market", "competitor"].includes(o)) {
    return o as SpecialistRole;
  }
  switch (finding.dimension) {
    case "visual": return "visual";
    case "ux": return "ui";
    case "gameplay": return "gameplay";
    case "technical": return "programmer";
    default: return "programmer";
  }
}
