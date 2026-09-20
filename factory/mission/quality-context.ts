import type { CriticEvidence } from "./quality-critics.js";
import type { CriticDimension } from "./quality-contract.js";
import type { ProductionQualityContract } from "./quality-contract.js";
import type { ProductionBlueprint } from "./blueprint.js";
import { blueprintSliceForRole } from "./blueprint.js";

/**
 * Quality execution context (orchestration wiring, not a new framework).
 *
 * Builds the per-critic evidence slice from the existing handoff inputs:
 * blueprint slice, Director quality vision, relevant quality contract
 * requirements, implementation artifacts, runtime/readiness evidence,
 * screenshot + UI evidence when available, previous findings, and repair
 * history. Selective by design — each critic receives only what its
 * dimension can observe, within the existing context-handoff budgets.
 */

export interface QualityContextInputs {
  blueprint?: ProductionBlueprint;
  /** Rendered Director vision text (fantasy, pillars, quality bar). */
  directorVisionText?: string;
  contract?: ProductionQualityContract;
  /** Bounded implementation-artifact summaries (never file contents). */
  artifactSummaries?: string[];
  /** Roblox scene-structure summary (scene inspection). */
  sceneSummary?: string;
  /** Bounded player-facing UI inventory (StarterGui evidence). */
  uiInventory?: string;
  /** Runtime/playtest + assertion summary. */
  runtimeSummary?: string;
  /** Assertion summary line (name:pass/fail). */
  assertionSummary?: string;
  /** Readiness / functional QA summary. */
  qaSummary?: string;
  /** Safe screenshot reference (path/description). Absent = unavailable. */
  screenshotRef?: string;
  /** Previous critic findings (bounded excerpts). */
  previousFindings?: string[];
  /** Repair-history notes (bounded excerpts). */
  repairHistoryNotes?: string[];
}

const BUDGET = 800;

function clip(text: string, max = BUDGET): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 20)}\n... (truncated)`;
}

function baseBlueprint(inputs: QualityContextInputs, role: string): string {
  const parts: string[] = [];
  if (inputs.blueprint) {
    try {
      parts.push(blueprintSliceForRole(inputs.blueprint, role).slice(0, 600));
    } catch {
      // Blueprint slice never blocks quality review.
    }
  }
  if (inputs.directorVisionText?.trim()) {
    parts.push(`Director quality: ${inputs.directorVisionText.trim().slice(0, 600)}`);
  }
  return parts.join("\n");
}

function priorBlock(inputs: QualityContextInputs): string {
  const parts: string[] = [];
  if (inputs.previousFindings?.length) {
    parts.push(`Previous findings:\n${inputs.previousFindings.slice(0, 6).join("\n")}`);
  }
  if (inputs.repairHistoryNotes?.length) {
    parts.push(`Repair history:\n${inputs.repairHistoryNotes.slice(0, 6).join("\n")}`);
  }
  if (parts.length === 0) return "";
  return clip(parts.join("\n\n"), 600);
}

/**
 * Build the per-dimension critic evidence. Selective routing:
 * - visual: screenshot + scene (+ artifacts + blueprint/vision)
 * - ux: UI inventory + scene + screenshot ref note (+ artifacts)
 * - gameplay: runtime/assertions (+ artifacts)
 * - technical: sources/artifact summaries + runtime notes
 *
 * Deliberately EXCLUDED from the pattern-matched observation fields:
 * - quality-contract requirement text (the contract travels as the
 *   structured `contract` argument for requirement-ID resolution; its
 *   wording — "no dead UI", "placeholder", "runtime errors" — would
 *   self-trigger the keyword critics as false findings AND false passes)
 * - previous findings / repair history (tracked by the stage driver via
 *   finding keys; re-injecting their wording would make resolved findings
 *   re-fire forever). They are preserved on blueprintText — a field no
 *   pattern critic scans — so the context stays transparent for
 *   LLM-based reviewers without corrupting deterministic verdicts.
 */
export function buildQualityCriticEvidence(
  inputs: QualityContextInputs,
): Record<CriticDimension, CriticEvidence> {
  const priors = priorBlock(inputs);
  const artifacts = (inputs.artifactSummaries ?? []).join("\n").slice(0, 800);

  const visualSources = [artifacts ? `implementation artifacts:\n${artifacts}` : ""].filter(Boolean);

  const visual: CriticEvidence = {
    sources: visualSources.length > 0 ? [clip(visualSources.join("\n\n"))] : undefined,
    sceneSummary: inputs.sceneSummary ? clip(inputs.sceneSummary, 1500) : undefined,
    screenshotRef: inputs.screenshotRef?.trim()
      ? inputs.screenshotRef.trim().slice(0, 500)
      : undefined,
    qaSummary: inputs.qaSummary ? clip(inputs.qaSummary, 500) : undefined,
    blueprintText: clip([baseBlueprint(inputs, "visual"), priors].filter(Boolean).join("\n\n")),
  };

  const uxBlob = [
    inputs.uiInventory ? `UI inventory:\n${inputs.uiInventory}` : "",
    inputs.sceneSummary ? `Scene:\n${inputs.sceneSummary.slice(0, 600)}` : "",
    inputs.screenshotRef ? `Screenshot: ${inputs.screenshotRef.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const ux: CriticEvidence = {
    sources: artifacts ? [clip(artifacts)] : undefined,
    sceneSummary: uxBlob ? clip(uxBlob, 1500) : undefined,
    runtimeSummary: inputs.runtimeSummary ? clip(inputs.runtimeSummary, 800) : undefined,
    qaSummary: inputs.qaSummary ? clip(inputs.qaSummary, 500) : undefined,
    blueprintText: clip([baseBlueprint(inputs, "ui"), priors].filter(Boolean).join("\n\n")),
  };

  const gameplay: CriticEvidence = {
    sources: artifacts ? [clip(`implementation artifacts:\n${artifacts}`)] : undefined,
    runtimeSummary: inputs.runtimeSummary ? clip(inputs.runtimeSummary, 1500) : undefined,
    assertionSummary: inputs.assertionSummary ? clip(inputs.assertionSummary, 500) : undefined,
    qaSummary: inputs.qaSummary ? clip(inputs.qaSummary, 500) : undefined,
    blueprintText: clip([baseBlueprint(inputs, "gameplay"), priors].filter(Boolean).join("\n\n")),
  };

  const technicalSources = [
    artifacts ? `implementation artifacts:\n${artifacts}` : "",
    inputs.qaSummary ? `qa:\n${inputs.qaSummary}` : "",
    inputs.runtimeSummary ? `runtime:\n${inputs.runtimeSummary.slice(0, 400)}` : "",
  ].filter(Boolean);

  const technical: CriticEvidence = {
    sources: technicalSources.length > 0 ? [clip(technicalSources.join("\n\n"))] : undefined,
    qaSummary: inputs.qaSummary ? clip(inputs.qaSummary, 500) : undefined,
    runtimeSummary: inputs.runtimeSummary ? clip(inputs.runtimeSummary, 500) : undefined,
    blueprintText: clip([baseBlueprint(inputs, "programmer"), priors].filter(Boolean).join("\n\n")),
  };

  return { visual, ux, gameplay, technical };
}
