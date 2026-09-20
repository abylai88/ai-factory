import type { MissionEventSink } from "./mission.js";
import type { MissionState } from "./state.js";
import type {
  ProductionQualityContract,
} from "./quality-contract.js";
import {
  runAllCritics,
  runGameplayCritic,
  runTechnicalCritic,
  runUxCritic,
  runVisualCritic,
  type CriticEvidence,
  type CriticReview,
  type QualityFinding,
} from "./quality-critics.js";
import type { CriticDimension } from "./quality-contract.js";
import { scanForPrototypePatterns } from "./quality-guardrails.js";
import {
  evaluateProductionQualityGate,
  type FunctionalInputs,
  type ProductionQualityGateResult,
  type QualityRepairTask,
} from "./quality-gate.js";
import { triageQualityFinding } from "./failure-triage.js";
import { RepairHistory } from "./repair-history.js";

/**
 * Production quality stage driver — the mandatory post-implementation
 * stage (FUNCTIONAL_PASS → QUALITY_REVIEW → QUALITY_REPAIR →
 * QUALITY_REVIEW → PRODUCTION_QUALITY_PASS).
 *
 * This is orchestration wiring over the EXISTING quality system
 * (critics + guardrails + triage + RepairHistory + gate). It introduces
 * no new QA hierarchy and no new persistence layer: findings persist
 * through MissionState quality findings, stage status through a
 * quality decision + quality-stage record, events through the mission
 * event sink.
 *
 * Quality review never runs before implementation evidence exists: an
 * empty functional evidence string blocks the stage honestly.
 */

export type QualityStageStatus =
  | "not-started"
  | "reviewing"
  | "repairing"
  | "re-reviewing"
  | "passed"
  | "blocked";

export interface QualityStageReview {
  reviews: CriticReview[];
  findings: QualityFinding[];
}

export interface QualityStageCallbacks {
  /**
   * Provide fresh critic evidence for a review round (round 0 = initial,
   * round N = post-repair re-evaluation). Round-aware so callers can
   * recapture affected visual evidence per round.
   */
  review: (round: number) => Promise<QualityStageReview> | QualityStageReview;
  /** Targeted repair for one finding. Verified-fixed only on evidence. */
  repairOne: (
    task: QualityRepairTask,
    finding: QualityFinding,
  ) => Promise<{ fixed: boolean; note: string }>;
}

export interface QualityStageOptions {
  contract?: ProductionQualityContract;
  functional: FunctionalInputs;
  maxRounds?: number;
  repairBudget?: number;
  missionId?: string;
  missionState?: MissionState;
  eventSink?: MissionEventSink;
}

export interface QualityStageResult {
  stage: QualityStageStatus;
  rounds: number;
  resolved: QualityFinding[];
  unresolved: QualityFinding[];
  escalated: QualityFinding[];
  repairTasks: QualityRepairTask[];
  reviews: CriticReview[];
  gate: ProductionQualityGateResult;
  summary: string;
}

function emit(
  sink: MissionEventSink | undefined,
  missionId: string,
  type: string,
  payload: Record<string, unknown>,
): void {
  try {
    sink?.publish({ missionId, type, payload } as never);
  } catch {
    // Events never block the quality stage.
  }
}

/** Default review: all four critics + anti-prototype guardrail scan. */
export function defaultQualityReview(
  evidence: CriticEvidence,
  contract?: ProductionQualityContract,
): QualityStageReview {
  const { reviews, findings } = runAllCritics(evidence, contract);
  return withGuardrailScan(reviews, findings, evidence);
}

/**
 * Dimension-aware review: each critic consumes its own selective
 * evidence slice (see quality-context.ts). Guardrails scan the merged
 * observable blob so prototype patterns are caught in every slice.
 */
export function reviewDimensionEvidence(
  per: Record<CriticDimension, CriticEvidence>,
  contract?: ProductionQualityContract,
): QualityStageReview {
  const reviews = [
    runVisualCritic(per.visual, contract),
    runUxCritic(per.ux, contract),
    runGameplayCritic(per.gameplay, contract),
    runTechnicalCritic(per.technical, contract),
  ];
  const merged: CriticEvidence = {
    sources: [per.visual, per.ux, per.gameplay, per.technical].flatMap((e) => e.sources ?? []),
    sceneSummary: [per.visual.sceneSummary, per.ux.sceneSummary].filter(Boolean).join("\n"),
    runtimeSummary: [per.gameplay.runtimeSummary, per.technical.runtimeSummary].filter(Boolean).join("\n"),
    qaSummary: per.gameplay.qaSummary ?? per.ux.qaSummary,
  };
  return withGuardrailScan(reviews, reviews.flatMap((r) => r.findings), merged);
}

function withGuardrailScan(
  reviews: CriticReview[],
  findings: QualityFinding[],
  evidence: CriticEvidence,
): QualityStageReview {
  const guardrailHits = scanForPrototypePatterns({
    sources: evidence.sources,
    sceneSummary: evidence.sceneSummary,
    runtimeNotes: [evidence.runtimeSummary, evidence.qaSummary].filter(Boolean).join("\n"),
  });
  const extra: QualityFinding[] = guardrailHits.map((h, i) => ({
    ...h,
    id: `QF-GR-${Date.now().toString(36)}-${i}`,
    createdAt: new Date().toISOString(),
  }));
  const seen = new Set(findings.map((f) => `${f.violatedRequirement}:${f.affectedArea}`));
  const deduped = extra.filter((f) => {
    const key = `${f.violatedRequirement}:${f.affectedArea}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { reviews, findings: [...findings, ...deduped] };
}

export async function runProductionQualityStage(
  callbacks: QualityStageCallbacks,
  opts: QualityStageOptions,
): Promise<QualityStageResult> {
  const missionId = opts.missionId ?? "unknown";
  const maxRounds = Math.max(1, opts.maxRounds ?? 3);
  const history = new RepairHistory(opts.repairBudget ?? 3);

  // Restore persisted repair ledger so repeat detection survives restarts.
  try {
    const persisted = opts.missionState?.getRepairRecords() ?? [];
    if (persisted.length > 0) history.importState(persisted);
  } catch {
    // Hydration never blocks the stage.
  }

  // Gate 0: quality review requires implementation evidence.
  if (!opts.functional.functionalEvidence?.trim()) {
    const gate = evaluateProductionQualityGate({
      functional: { ...opts.functional, functionalPass: false },
      reviews: [],
      contract: opts.contract,
      unresolvedFindings: [],
    });
    const summary =
      "QUALITY_BLOCKED: no implementation evidence — quality review refused before FUNCTIONAL evidence exists";
    await persistStage(opts, "blocked", 0, summary, gate.productionPass);
    emit(opts.eventSink, missionId, "mission.quality.stage", {
      stage: "blocked",
      reason: summary,
    });
    return {
      stage: "blocked",
      rounds: 0,
      resolved: [],
      unresolved: [],
      escalated: [],
      repairTasks: [],
      reviews: [],
      gate,
      summary,
    };
  }

  emit(opts.eventSink, missionId, "mission.quality.stage", { stage: "reviewing", round: 0 });
  await persistStage(opts, "reviewing", 0, "QUALITY_REVIEW: initial critic review", false);

  let current = await callbacks.review(0);
  await recordFindings(opts, current.findings);

  let unresolved = current.findings.filter((f) => f.severity !== "stretch");
  const stretch = current.findings.filter((f) => f.severity === "stretch");
  const resolved: QualityFinding[] = [...stretch];
  const escalated: QualityFinding[] = [];
  const repairTasks: QualityRepairTask[] = [];
  let rounds = 0;

  while (unresolved.length > 0 && rounds < maxRounds) {
    rounds += 1;
    emit(opts.eventSink, missionId, "mission.quality.stage", {
      stage: "repairing",
      round: rounds,
      open: unresolved.length,
    });
    await persistStage(
      opts,
      "repairing",
      rounds,
      `QUALITY_REPAIR round ${rounds}: ${unresolved.length} open finding(s)`,
      false,
    );

    const roundTargets = [...unresolved];
    unresolved = [];
    for (const finding of roundTargets) {
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
        await markFinding(opts, finding.id, "escalated", undefined, decision.reason);
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
      emit(opts.eventSink, missionId, "mission.quality.repair", {
        findingId: finding.id,
        specialist,
        round: rounds,
      });
      const result = await callbacks.repairOne(task, finding);
      history.record({
        delegationId: finding.id,
        failure: finding.why.slice(0, 500),
        evidence: finding.evidence.slice(0, 500),
        diagnosis: `quality ${finding.dimension}/${finding.severity} → ${specialist}`,
        repairAttempted: finding.repairObjective.slice(0, 500),
        repairResult: result.fixed ? "fixed" : "failed",
        regressionResult: result.note.slice(0, 500),
      });
      try {
        await opts.missionState?.syncRepairRecords(history.exportState());
      } catch {
        // Best-effort.
      }
      if (result.fixed) {
        // Claimed-fixed is NOT trusted: re-evaluation below decides.
        await markFinding(opts, finding.id, "open", undefined, `repair claimed: ${result.note.slice(0, 300)}`);
        unresolved.push(finding);
      } else {
        unresolved.push(finding);
      }
    }

    // Re-evaluation: fresh critics over recaptured evidence. Only
    // affected checks re-run — the review callback is round-aware.
    emit(opts.eventSink, missionId, "mission.quality.stage", {
      stage: "re-reviewing",
      round: rounds,
    });
    await persistStage(
      opts,
      "re-reviewing",
      rounds,
      `QUALITY_REVIEW round ${rounds}: re-evaluating ${unresolved.length} candidate(s)`,
      false,
    );
    const reReview = await callbacks.review(rounds);
    current = reReview;
    const stillOpen = new Set(reReview.findings.map((f) => findingKey(f)));
    const newlyResolved: QualityFinding[] = [];
    const stillUnresolved: QualityFinding[] = [];
    for (const f of unresolved) {
      if (!stillOpen.has(findingKey(f))) {
        newlyResolved.push(f);
        await markFinding(opts, f.id, "fixed", undefined, `verified fixed in round ${rounds} re-review`);
      } else {
        stillUnresolved.push(f);
      }
    }
    // Fresh findings the previous round did not know about.
    const knownKeys = new Set([...resolved, ...unresolved, ...escalated].map(findingKey));
    for (const f of reReview.findings.filter((f) => f.severity !== "stretch")) {
      if (!knownKeys.has(findingKey(f))) {
        await recordFindings(opts, [f]);
        stillUnresolved.push(f);
      }
    }
    resolved.push(...newlyResolved);
    unresolved = stillUnresolved;
    if (unresolved.length > 0 && rounds >= maxRounds) {
      for (const f of unresolved) {
        escalated.push(f);
        await markFinding(opts, f.id, "escalated", undefined, "repair budget exhausted");
      }
      unresolved = [];
    }
  }

  // Escalated findings are still broken: they block the gate alongside
  // any remaining unresolved findings. Stretch never blocks.
  const gate = evaluateProductionQualityGate({
    functional: opts.functional,
    reviews: current.reviews,
    contract: opts.contract,
    unresolvedFindings: [...unresolved, ...escalated].filter((f) => f.severity !== "stretch"),
  });
  const stage: QualityStageStatus = gate.productionPass ? "passed" : "blocked";
  const summary = gate.productionPass
    ? `PRODUCTION_QUALITY_PASS after ${rounds} repair round(s): ${resolved.length} resolved`
    : `QUALITY_BLOCKED after ${rounds} repair round(s): ${gate.summary}`;
  await persistStage(opts, stage, rounds, summary, gate.productionPass);
  emit(opts.eventSink, missionId, "mission.quality.gate", {
    stage,
    productionPass: gate.productionPass,
    rounds,
    resolved: resolved.length,
    escalated: escalated.length,
    summary: summary.slice(0, 500),
  });
  return {
    stage,
    rounds,
    resolved,
    unresolved,
    escalated,
    repairTasks,
    reviews: current.reviews,
    gate,
    summary,
  };
}

function findingKey(f: QualityFinding): string {
  return `${f.dimension}:${f.violatedRequirement}:${(f.affectedArea ?? "").slice(0, 80)}`;
}

async function recordFindings(
  opts: QualityStageOptions,
  findings: QualityFinding[],
): Promise<void> {
  if (!opts.missionState) return;
  for (const f of findings.slice(0, 50)) {
    try {
      await opts.missionState.recordQualityFinding({
        id: f.id.slice(0, 100),
        dimension: f.dimension,
        severity: f.severity,
        evidence: f.evidence,
        affectedArea: f.affectedArea,
        violatedRequirement: f.violatedRequirement,
        why: f.why,
        proposedOwner: f.proposedOwner,
        repairObjective: f.repairObjective,
        verificationRequirement: f.verificationRequirement,
      });
    } catch {
      // One bad finding never blocks the stage.
    }
  }
}

async function markFinding(
  opts: QualityStageOptions,
  id: string,
  status: "open" | "fixed" | "escalated",
  repairDelegationId?: string,
  verificationOutcome?: string,
): Promise<void> {
  try {
    // Only include defined fields: an explicit `undefined` would wipe the
    // persisted repair linkage via object spread in MissionState.
    const patch: Record<string, unknown> = { status };
    if (repairDelegationId !== undefined) patch.repairDelegationId = repairDelegationId;
    if (verificationOutcome !== undefined) patch.verificationOutcome = verificationOutcome.slice(0, 500);
    await opts.missionState?.updateQualityFinding(id, patch as never);
  } catch {
    // Best-effort.
  }
}

async function persistStage(
  opts: QualityStageOptions,
  status: QualityStageStatus,
  rounds: number,
  summary: string,
  productionPass: boolean,
): Promise<void> {
  try {
    await opts.missionState?.recordQualityStage({
      status,
      rounds,
      summary: summary.slice(0, 1000),
      productionPass,
    });
  } catch {
    // Stage persistence never blocks the stage.
  }
}
