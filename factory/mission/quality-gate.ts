import type { ProductionQualityContract } from "./quality-contract.js";
import { requiredForGate } from "./quality-contract.js";
import type { QualityFinding, CriticReview } from "./quality-critics.js";
import { triageQualityFinding } from "./failure-triage.js";
import { RepairHistory } from "./repair-history.js";

/**
 * Quality gate semantics (Phase 11) + quality repair loop driver (Phase 6).
 *
 * Clear separation — each is a distinct verdict with its own evidence:
 *   FUNCTIONAL_PASS ≠ RUNTIME_PASS ≠ VISUAL_PASS ≠ UX_PASS ≠
 *   GAMEPLAY_PASS ≠ PRODUCTION_QUALITY_PASS
 *
 * A final PRODUCTION_QUALITY_PASS requires the applicable dimensions to
 * have evidence. VISUAL_UNAVAILABLE never silently becomes PASS.
 * Stretch goals never block production completion.
 */

export type QualityGateDimension = "functional" | "runtime" | "visual" | "ux" | "gameplay" | "production";

export interface DimensionVerdict {
  dimension: QualityGateDimension;
  status: "pass" | "fail" | "unavailable" | "not-required";
  evidence: string;
}

export interface ProductionQualityGateResult {
  dimensions: DimensionVerdict[];
  productionPass: boolean;
  summary: string;
  blockingFindings: QualityFinding[];
}

export interface FunctionalInputs {
  functionalPass: boolean;
  functionalEvidence: string;
  runtimePass: boolean;
  runtimeEvidence: string;
}

function verdict(
  dimension: QualityGateDimension,
  status: DimensionVerdict["status"],
  evidence: string,
): DimensionVerdict {
  return { dimension, status, evidence: evidence.slice(0, 500) };
}

/**
 * Evaluate the production-quality gate.
 *
 * - functional/runtime come from the existing pipeline (build, readiness,
 *   playtest, runtime assertions).
 * - visual/ux/gameplay come from critic reviews (with honest unavailable).
 * - production passes only when every REQUIRED (non-stretch) finding is
 *   resolved AND functional+runtime pass AND no blocking findings remain
 *   AND visual is not silently passed when unavailable.
 */
export function evaluateProductionQualityGate(input: {
  functional: FunctionalInputs;
  reviews: CriticReview[];
  contract?: ProductionQualityContract;
  unresolvedFindings?: QualityFinding[];
}): ProductionQualityGateResult {
  const findings = input.unresolvedFindings ?? [];
  const blocking = findings.filter((f) => f.severity === "blocking");
  const requiredBlocking = findings.filter((f) => f.severity !== "stretch");

  const byDim = new Map(input.reviews.map((r) => [r.dimension, r]));
  const visual = byDim.get("visual");
  const ux = byDim.get("ux");
  const gameplay = byDim.get("gameplay");

  const dims: DimensionVerdict[] = [];
  dims.push(verdict(
    "functional",
    input.functional.functionalPass ? "pass" : "fail",
    input.functional.functionalEvidence || "no functional evidence",
  ));
  dims.push(verdict(
    "runtime",
    input.functional.runtimePass ? "pass" : "fail",
    input.functional.runtimeEvidence || "no runtime evidence",
  ));

  // Visual: unavailable stays unavailable — never auto-PASS.
  if (!visual) {
    dims.push(verdict("visual", "unavailable", "VISUAL_UNAVAILABLE: no visual critic review recorded"));
  } else if (visual.status === "unavailable") {
    dims.push(verdict("visual", "unavailable", visual.evidenceNotes.join("; ").slice(0, 500) || "VISUAL_UNAVAILABLE"));
  } else {
    dims.push(verdict("visual", visual.status === "pass" ? "pass" : "fail", visual.evidenceNotes.join("; ").slice(0, 500) || `visual ${visual.status}`));
  }
  if (!ux) {
    dims.push(verdict("ux", "unavailable", "no UX critic review recorded"));
  } else {
    dims.push(verdict("ux", ux.status === "pass" ? "pass" : ux.status === "unavailable" ? "unavailable" : "fail", ux.evidenceNotes.join("; ").slice(0, 500) || `ux ${ux.status}`));
  }
  if (!gameplay) {
    dims.push(verdict("gameplay", "unavailable", "no gameplay critic review recorded"));
  } else {
    dims.push(verdict("gameplay", gameplay.status === "pass" ? "pass" : gameplay.status === "unavailable" ? "unavailable" : "fail", gameplay.evidenceNotes.join("; ").slice(0, 500) || `gameplay ${gameplay.status}`));
  }

  // Production requires: functional + runtime pass, no required findings,
  // and visual must not be a silent pass. UX/gameplay unavailable blocks
  // production too (applicable dimensions need evidence) — but stretch
  // findings never block.
  const reasons: string[] = [];
  if (!input.functional.functionalPass) reasons.push("functional FAIL");
  if (!input.functional.runtimePass) reasons.push("runtime FAIL");
  if (requiredBlocking.length > 0) {
    reasons.push(`${requiredBlocking.length} unresolved required finding(s): ${requiredBlocking.map((f) => f.id).join(", ")}`);
  }
  const visualDim = dims.find((d) => d.dimension === "visual")!;
  if (visualDim.status !== "pass") reasons.push(`visual not PASS (${visualDim.status})`);
  for (const d of ["ux", "gameplay"] as const) {
    const v = dims.find((x) => x.dimension === d)!;
    if (v.status === "fail") reasons.push(`${d} FAIL`);
    else if (v.status === "unavailable") reasons.push(`${d} unavailable (no evidence)`);
  }
  void blocking;

  const productionPass = reasons.length === 0;
  dims.push(verdict(
    "production",
    productionPass ? "pass" : "fail",
    productionPass ? "PRODUCTION_QUALITY_PASS: all applicable dimensions evidenced" : `production blocked: ${reasons.join("; ")}`,
  ));
  void requiredForGate;
  return {
    dimensions: dims,
    productionPass,
    summary: productionPass
      ? "PRODUCTION_QUALITY_PASS: functional, runtime, visual, UX, and gameplay evidenced"
      : `production-quality BLOCKED: ${reasons.join("; ")}`,
    blockingFindings: findings.filter((f) => f.severity === "blocking"),
  };
}

// ── Quality repair loop driver (Phase 6) ─────────────────────────
// implementation → functional QA → critics → findings → targeted
// repair delegation(s) → re-run affected checks → critics again → gate.
// Repairs only affected dimensions; preserves previous evidence; tracks
// history via the existing RepairHistory; detects repeats; escalates
// when the budget is exhausted. A failed quality review is classified
// separately — it never means the game is technically broken.

export interface QualityRepairTask {
  findingId: string;
  specialist: string;
  objective: string;
  verification: string;
}

export interface QualityLoopOutcome {
  rounds: number;
  resolved: QualityFinding[];
  unresolved: QualityFinding[];
  escalated: QualityFinding[];
  repairTasks: QualityRepairTask[];
  gate: ProductionQualityGateResult;
}

/**
 * Drive the quality repair loop with injected check/repair callbacks so
 * the loop stays deterministic and offline-testable. The callbacks stand
 * in for specialist repair + affected-check re-runs.
 */
export async function runQualityRepairLoop(input: {
  initialFindings: QualityFinding[];
  functional: FunctionalInputs;
  reviews: CriticReview[];
  contract?: ProductionQualityContract;
  maxRounds?: number;
  repairBudget?: number;
  /** Return true when the repair task for a finding is verified fixed. */
  repairOne: (task: QualityRepairTask, finding: QualityFinding) => Promise<{ fixed: boolean; note: string }>;
}): Promise<QualityLoopOutcome> {
  const maxRounds = Math.max(1, input.maxRounds ?? 3);
  const history = new RepairHistory(input.repairBudget ?? 3);
  let unresolved = [...input.initialFindings];
  const resolved: QualityFinding[] = [];
  const escalated: QualityFinding[] = [];
  const repairTasks: QualityRepairTask[] = [];
  let rounds = 0;

  while (unresolved.length > 0 && rounds < maxRounds) {
    rounds += 1;
    // Repair only affected dimensions this round: group by finding, one
    // targeted task each (no whole-company rerun).
    const roundTargets = [...unresolved];
    unresolved = [];
    for (const finding of roundTargets) {
      if (finding.severity === "stretch") {
        // Stretch never blocks; record and move on.
        resolved.push(finding);
        continue;
      }
      const triage = triageQualityFinding({
        findingId: finding.id,
        dimension: finding.dimension,
        severity: finding.severity,
        violatedRequirement: finding.violatedRequirement,
        proposedOwner: finding.proposedOwner,
        evidenceText: finding.evidence,
      });
      const decision = history.decide(finding.id, finding.why, finding.repairObjective);
      if (decision.action === "blocked") {
        escalated.push(finding);
        history.record({
          delegationId: finding.id,
          failure: finding.why.slice(0, 500),
          evidence: finding.evidence.slice(0, 500),
          diagnosis: `quality ${finding.dimension}/${finding.severity}`,
          repairAttempted: finding.repairObjective.slice(0, 500),
          repairResult: "failed",
          regressionResult: decision.reason.slice(0, 500),
        });
        continue;
      }
      const specialist = triage.specialist ?? finding.proposedOwner;
      const task: QualityRepairTask = {
        findingId: finding.id,
        specialist,
        objective: finding.repairObjective,
        verification: finding.verificationRequirement,
      };
      repairTasks.push(task);
      const result = await input.repairOne(task, finding);
      history.record({
        delegationId: finding.id,
        failure: finding.why.slice(0, 500),
        evidence: finding.evidence.slice(0, 500),
        diagnosis: `quality ${finding.dimension}/${finding.severity} → ${specialist}`,
        repairAttempted: finding.repairObjective.slice(0, 500),
        repairResult: result.fixed ? "fixed" : "failed",
        regressionResult: result.note.slice(0, 500),
      });
      if (result.fixed) resolved.push(finding);
      else unresolved.push(finding);
    }
    // Loop re-evaluates affected dimensions next round via fresh findings
    // supplied by the caller (critics again). Here the repair callback is
    // authoritative for the round; unresolved findings cycle again.
    if (unresolved.length > 0 && rounds >= maxRounds) {
      escalated.push(...unresolved);
      unresolved = [];
    }
  }

  const gate = evaluateProductionQualityGate({
    functional: input.functional,
    reviews: input.reviews,
    contract: input.contract,
    unresolvedFindings: unresolved.filter((f) => f.severity !== "stretch"),
  });
  return { rounds, resolved, unresolved, escalated, repairTasks, gate };
}
