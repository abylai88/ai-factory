import { deriveBlueprintFromGoal } from "./blueprint.js";
import { buildDirectorVision, renderDirectorVision } from "./director-vision.js";
import { deriveQualityContract } from "./quality-contract.js";
import { buildQualityCriticEvidence } from "./quality-context.js";
import {
  runProductionQualityStage,
  reviewDimensionEvidence,
  type QualityStageResult,
} from "./quality-stage.js";

/**
 * Deterministic offline quality benchmark (no Studio, no network).
 *
 * Weak case: an intentionally prototype-like evidence set. The system
 * must (1) detect multiple concrete anti-prototype findings, (2) reject
 * the initial gate, (3) map findings to different specialist owners,
 * (4) simulate targeted repairs, (5) re-review, (6) reach
 * PRODUCTION_QUALITY_PASS.
 *
 * Strong case: complete evidence passes without fake findings.
 * No numeric quality scores or rankings anywhere.
 */

export interface QualityBenchmarkCase {
  name: string;
  sceneSummary?: string;
  uiInventory?: string;
  runtimeSummary?: string;
  screenshotRef?: string;
  sources?: string[];
}

export function weakBenchmarkCase(): QualityBenchmarkCase {
  return {
    name: "weak-prototype",
    sceneSummary:
      "Workspace: empty baseplate, default gray SmoothPlastic plastic, no dressing, no collectibles, no landmarks",
    uiInventory:
      "StarterGui: ScreenGui with Button1 Button2 Button3, giant text label, debug button (godmode), no HUD",
    runtimeSummary:
      "playtest running; no collect feedback; silent reward increments; no onboarding prompt; player does not know what to do",
    screenshotRef: "viewport-1280x720.png: empty gray baseplate, default gray plastic, placeholder UI",
    sources: ["test game TODO lorem ipsum, duplicate currency system, dead button with nothing happens"],
  };
}

export function strongBenchmarkCase(): QualityBenchmarkCase {
  return {
    name: "strong-production",
    sceneSummary:
      "Workspace: SpawnLocation + ground/baseplate + gold/teal coin field with 24 readable collectibles + zone gates + landmark tower; zone palettes listed",
    uiInventory:
      "StarterGui: HUD ScreenGui with CoinCount TextLabel + ObjectiveLabel + UpgradeButton (primary, distinct size/color) + MenuButton (secondary); button states defined",
    runtimeSummary:
      "playtest PASS; collect loop assertions 4/4 pass; reward feedback effect + counter tick + sound; spawn safe with floor + SpawnLocation; first-minute onboarding shown with goal prompt",
    screenshotRef:
      "viewport-1280x720.png: bright coin field with gold/teal palette, readable HUD with currency + objective",
    sources: ["server-authoritative currency in CollectService; runtime logs clean"],
  };
}

export interface QualityBenchmarkResult {
  weak: {
    initialFindingCount: number;
    owners: string[];
    gateInitiallyPass: boolean;
    final: QualityStageResult;
  };
  strong: QualityStageResult;
}

function evidenceFor(c: QualityBenchmarkCase) {
  const blueprint = deriveBlueprintFromGoal("Create a Roblox coin simulator with upgrades");
  const contract = deriveQualityContract(blueprint);
  const vision = renderDirectorVision(buildDirectorVision(blueprint));
  const per = buildQualityCriticEvidence({
    blueprint,
    directorVisionText: vision,
    contract,
    sceneSummary: c.sceneSummary,
    uiInventory: c.uiInventory,
    runtimeSummary: c.runtimeSummary,
    qaSummary: "readiness ok; PLACE_READY",
    screenshotRef: c.screenshotRef,
    artifactSummaries: c.sources?.map((s) => `- artifact: ${s.slice(0, 160)}`),
  });
  return { contract, per };
}

/**
 * Run the benchmark. `improveEvidence` simulates targeted specialist
 * repairs: after each repair round the evidence set is the strong one
 * (each repair observably fixes its dimension).
 */
export async function runQualityBenchmark(): Promise<QualityBenchmarkResult> {
  const weak = weakBenchmarkCase();
  const strong = strongBenchmarkCase();

  // 1-2: initial review of the weak case.
  const weakInputs = evidenceFor(weak);
  const initial = reviewDimensionEvidence(weakInputs.per, weakInputs.contract);
  const owners = [...new Set(initial.findings.map((f) => f.proposedOwner))];

  const { evaluateProductionQualityGate } = await import("./quality-gate.js");
  const initialGate = evaluateProductionQualityGate({
    functional: {
      functionalPass: true,
      functionalEvidence: "rojo build exit 0; delegation graph passed",
      runtimePass: true,
      runtimeEvidence: "playtest running; assertions observed",
    },
    reviews: initial.reviews,
    contract: weakInputs.contract,
    unresolvedFindings: initial.findings.filter((f) => f.severity !== "stretch"),
  });

  // 3-6: full stage with simulated targeted repairs → repaired evidence.
  let round = 0;
  const final = await runProductionQualityStage(
    {
      review: async (r: number) => {
        round = r;
        // Simulated targeted repairs observably fix the evidence: after
        // round 0 the evidence set is the strong one.
        const inputs = evidenceFor(r === 0 ? weak : strong);
        return reviewDimensionEvidence(inputs.per, inputs.contract);
      },
      repairOne: async (task) => ({
        fixed: true,
        note: `${task.specialist} completed: ${task.objective.slice(0, 120)}`,
      }),
    },
    {
      contract: weakInputs.contract,
      functional: {
        functionalPass: true,
        functionalEvidence: "rojo build exit 0; delegation graph passed",
        runtimePass: true,
        runtimeEvidence: "playtest running; assertions observed",
      },
      maxRounds: 3,
      missionId: "benchmark-weak",
    },
  );
  void round;

  const strongInputs = evidenceFor(strong);
  const strongResult = await runProductionQualityStage(
    {
      review: async () => reviewDimensionEvidence(strongInputs.per, strongInputs.contract),
      repairOne: async () => ({ fixed: true, note: "no repair needed" }),
    },
    {
      contract: strongInputs.contract,
      functional: {
        functionalPass: true,
        functionalEvidence: "rojo build exit 0; delegation graph passed",
        runtimePass: true,
        runtimeEvidence: "playtest PASS; assertions 4/4",
      },
      missionId: "benchmark-strong",
    },
  );

  return {
    weak: {
      initialFindingCount: initial.findings.length,
      owners,
      gateInitiallyPass: initialGate.productionPass,
      final,
    },
    strong: strongResult,
  };
}
