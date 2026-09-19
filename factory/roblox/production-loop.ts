/**
 * Roblox production loop — the single ordered pipeline for Roblox missions.
 *
 * Uses the ALREADY-BUILT lower-level systems (validation, place artifact,
 * project-ready, scene tools, playtest lifecycle, runtime assertions, logs,
 * screenshot, visual QA, failure classification, repair, rebuild, retest,
 * teardown). This module only defines the stage order + an offline-testable
 * runner with injectable steps, so the loop is integration-tested without a
 * live Studio.
 *
 * Order: source validation → artifact provisioning → Project Ready →
 * connect/reuse Studio → programmer tools → scene tools → UI tools →
 * playtest → runtime assertions → logs → screenshot → visual QA → failure
 * classification → specialist repair → rebuild → retest → teardown.
 */

export const ROBLOX_PRODUCTION_STAGES = [
  "source-validation",
  "artifact-provisioning",
  "project-ready",
  "studio-connect",
  "programmer-tools",
  "scene-tools",
  "ui-tools",
  "playtest",
  "runtime-assertions",
  "logs",
  "screenshot",
  "visual-qa",
  "failure-classification",
  "specialist-repair",
  "rebuild",
  "retest",
  "teardown",
] as const;
export type RobloxProductionStage = (typeof ROBLOX_PRODUCTION_STAGES)[number];

export interface ProductionStepResult {
  stage: RobloxProductionStage;
  status: "passed" | "failed" | "blocked" | "skipped";
  evidence: string;
}

export type ProductionStep = (
  ctx: { projectDir: string; evidence: string[] },
) => Promise<Omit<ProductionStepResult, "stage">>;

export interface ProductionLoopResult {
  status: "passed" | "failed" | "blocked";
  steps: ProductionStepResult[];
  failedStage?: RobloxProductionStage;
}

export async function runRobloxProductionLoop(
  projectDir: string,
  steps: Partial<Record<RobloxProductionStage, ProductionStep>>,
): Promise<ProductionLoopResult> {
  const results: ProductionStepResult[] = [];
  const ctx = { projectDir, evidence: [] as string[] };
  for (const stage of ROBLOX_PRODUCTION_STAGES) {
    const step = steps[stage];
    if (!step) {
      results.push({ stage, status: "skipped", evidence: "no step injected (offline)" });
      continue;
    }
    try {
      const r = await step(ctx);
      ctx.evidence.push(`${stage}: ${r.evidence}`);
      results.push({ stage, ...r });
      if (r.status === "failed") return { status: "failed", steps: results, failedStage: stage };
      if (r.status === "blocked") return { status: "blocked", steps: results, failedStage: stage };
    } catch (e) {
      const evidence = e instanceof Error ? e.message : String(e);
      results.push({ stage, status: "blocked", evidence });
      return { status: "blocked", steps: results, failedStage: stage };
    }
  }
  return { status: "passed", steps: results };
}
