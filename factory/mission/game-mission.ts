import {
  Mission,
  ExecutionPlan,
  MissionStatus,
  createMission,
  MissionContext,
  MissionConstraints,
  Delegation,
  AuditResult,
  VisualQaResult,
} from "./mission.js";
import { ProjectProvisioner } from "./project-provisioner.js";
import { Planner, createPlanner } from "./planner.js";
import { MissionState } from "./state.js";
import { MissionOrchestrator, RealFactoryAdapter } from "./orchestrator.js";
import { CodingMissionAuditor } from "./adapters.js";
import { PlaywrightVisualQaAdapter } from "./playwright-visual-qa-adapter.js";
import { DeterministicRepairExecutor } from "./repair-executor.js";
import { InMemoryEventSink, createMissionEventPublisher } from "./events.js";
import { createPixelOfficeReporter } from "./pixel-office-reporter.js";
import { MissionProjectManager, MissionAwareFactoryAdapter } from "./mission-project-manager.js";
import { OpenCodePlannerModel } from "./opencode-planner-model.js";
import { MissionPlanner, createMissionPlanner } from "./mission-planner.js";
import { createModelRouter } from "./model-router.js";
import { createMissionSupervisor } from "./mission-supervisor.js";
import { PeerReviewSystem } from "./peer-review.js";
import { isRobloxGoal } from "../roblox/platform.js";
import { deriveBlueprintFromGoal } from "./blueprint.js";
import { acquireLock, studioLockName, type LockHandle } from "./resource-control.js";

export interface GameMissionInput {
  goal: string;
  projectId?: string;
  templateId?: string;
}

export interface GameMissionResult {
  missionId: string;
  status: MissionStatus;
  projectId: string;
  projectPath: string;
  workflowMode: "research" | "coding" | "game";
  plan: ExecutionPlan;
  build?: { status: string; command?: string; durationMs?: number };
  visualQa?: VisualQaResult;
  audit?: AuditResult;
  repairCycles?: number;
  delegations?: Delegation[];
  result?: Mission;
}

function determineWorkflowMode(goal: string): "research" | "coding" | "game" {
  const lower = goal.toLowerCase();
  
  const researchKeywords = [
    "analyze", "inspect", "review", "investigate", "understand", "document"
  ];
  
  const codingKeywords = [
    "fix", "bug", "error", "refactor", "update", "change"
  ];
  
  if (researchKeywords.some(kw => lower.includes(kw))) {
    return "research";
  }
  
  if (codingKeywords.some(kw => lower.includes(kw))) {
    return "coding";
  }
  
  return "game";
}

export async function executeGameMission(
  input: GameMissionInput
): Promise<GameMissionResult> {
  // 1. Validate goal is a non-empty string
  if (!input.goal || input.goal.trim().length === 0) {
    throw new Error("Mission goal must be a non-empty string");
  }
  
  // 2. Determine workflowMode
  const workflowMode = determineWorkflowMode(input.goal);
  
  // 3. Resolve or provision project
  const baseDir = process.env.AI_FACTORY_HOME ?? process.cwd();
  const provisioner = new ProjectProvisioner({
    baseDir,
    templatesDir: `${baseDir}/templates`,
    projectsDir: `${baseDir}/projects`,
    allowedTemplateIds: ["phaser-generic-web-template", "yagames-phaser-template", "roblox-rojo-template"],
  });
  
  let projectId: string;
  let projectPath: string;
  
  if (input.projectId) {
    // Validate existing project
    const projectPathCandidate = `${baseDir}/projects/${input.projectId}`;
    const validation = await provisioner.validateProject(projectPathCandidate);
    if (!validation.valid) {
      throw new Error(`Invalid project ID: ${input.projectId}. ${validation.reason || "Project not found."}`);
    }
    projectId = input.projectId;
    projectPath = projectPathCandidate;
  } else {
    // Provision new project
    const templateId =
      input.templateId ||
      (isRobloxGoal(input.goal)
        ? "roblox-rojo-template"
        : "phaser-generic-web-template");
    const handle = await provisioner.provision(templateId);
    projectId = handle.projectId;
    projectPath = handle.projectPath;
  }
  
  // 4. Create Mission
  const resolvedTemplate =
    input.templateId ||
    (isRobloxGoal(input.goal)
      ? "roblox-rojo-template"
      : "phaser-generic-web-template");

  const isRoblox = resolvedTemplate === "roblox-rojo-template";

  const context: MissionContext = {
    projectId,
    engine: isRoblox ? "roblox" : "web",
    stack: isRoblox ? "roblox-luau-rojo" : "phaser",
    template: resolvedTemplate,
    workspace: projectPath,
    requiresVisualQa: workflowMode === "game" && !isRoblox,
  };
  
  const constraints: MissionConstraints = {
    maxRepairs: 3,
    maxDelegations: 20,
    allowedPipelines: ["game", "engineering"],
    requireApproval: false,
  };
  
  const mission = createMission(input.goal, context, constraints);

  // Production Blueprint: structured pre-implementation contract carried on
  // the mission so every specialist receives a slice of it via handoff.
  try {
    (mission as any).blueprint = deriveBlueprintFromGoal(input.goal);
  } catch {
    // Blueprint derivation never blocks mission creation.
  }
  
  // 5. Create MissionPlanner (Phase 10: OpenCode-backed planning with deterministic fallback)
  const plannerModel = new OpenCodePlannerModel({
    projectDir: projectPath,
  });
  const planner: MissionPlanner = createMissionPlanner(plannerModel, {
    maxDelegations: constraints.maxDelegations,
  });
  
  // 6. Generate ExecutionPlan via MissionPlanner
  const plan = await planner.createPlan(mission);

  // Research mode: planning only — no execution
  if (workflowMode === "research") {
    return {
      missionId: mission.id,
      status: mission.status,
      projectId,
      projectPath,
      workflowMode,
      plan,
    };
  }

  // 7. Execution modes: initialize MissionState
  const state = new MissionState(baseDir, mission.id);
  await state.init();
  await state.setMission(mission);
  await state.setPlan(plan);
  for (const delegation of plan.delegations) {
    await state.addDelegation(delegation);
  }

  // 8. Configure adapter: MissionAwareFactoryAdapter wrapping RealFactoryAdapter
  //    This matches the CLI pattern: all delegations go through runGoal()
  //    which dispatches to the appropriate agent based on pipeline type.
  const eventSink = new InMemoryEventSink();
  const publisher = createMissionEventPublisher(eventSink);
// Phase 10: Wire Phase 8-9 systems
  const modelRouter = createModelRouter();

  const supervisor = createMissionSupervisor({
    missionState: state,
    eventSink,
    publisher,
    modelRouter,
    replanner: planner,
  });

  // Peer review is not enabled in production until a real ReviewExecutor is implemented.
  // The defaultReviewExecutor was a stub that always failed; peer review requires
  // an explicit production executor to be provided.
  const peerReview = undefined;

  const validation = {
    // Roblox missions validate with the Rojo validator (see ValidationGate);
    // Web missions keep the existing npm build. Never emit fake commands
    // such as `npm run build` for Roblox.
    buildCommand: isRoblox ? undefined : "npm run build",
    engine: isRoblox ? "roblox" : "web",
    timeoutMs: 120_000,
    maxRepairAttempts: 3,
  };

  // Start Pixel Office reporting if configured
  const pixelOfficeReporter = createPixelOfficeReporter(eventSink);
  if (pixelOfficeReporter) {
    pixelOfficeReporter.start();
  }

  const projectManager = new MissionProjectManager({ baseDir, provisioner });
  const innerAdapter = new RealFactoryAdapter(state);
  const factoryAdapter = new MissionAwareFactoryAdapter({ baseDir, projectManager, missionState: state }, innerAdapter);

  // Single-Studio policy: only one mission may drive Roblox Studio at a
  // time. Contended → honest BLOCKED error, never a second Studio instance.
  let studioLock: LockHandle | null = null;
  if (isRoblox) {
    studioLock = await acquireLock(baseDir, studioLockName());
    if (!studioLock) {
      throw new Error(
        "BLOCKED (infrastructure): another mission holds the Roblox Studio singleton lock. " +
        "Queue this mission instead of opening a second Studio.",
      );
    }
  }

  try {
  if (workflowMode === "coding") {
    const auditor = new CodingMissionAuditor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs: constraints.maxRepairs,
      baseDir,
      project: projectPath,
      factoryAdapter,
      auditor,
      eventSink,
      missionState: state,
      modelRouter,
      // peerReview: undefined (not enabled without real executor)
      validation,
      supervisor,
      replanner: planner,
    });

    const completedMission = await orchestrator.executeMission(mission, plan);
    const finalMission = state.getMission();
    const finalDelegations = state.getDelegations();
    const repairCycles = state.getRepairCycleCount();
    const buildDelegation = finalDelegations.find(
      (d) => d.description.includes("ROLE: builder") || d.description.includes("BUILD_COMMAND:")
    );

    return {
      missionId: finalMission.id,
      status: finalMission.status,
      projectId,
      projectPath,
      workflowMode,
      plan,
      delegations: finalDelegations,
      result: completedMission,
      ...(buildDelegation && buildDelegation.result
        ? { build: { status: buildDelegation.status, durationMs: buildDelegation.result ? 0 : undefined } }
        : {}),
      ...(repairCycles > 0 ? { repairCycles } : {}),
    };
  }

  // Game mode: execute with Visual QA and self-healing
  const visualQaAdapter = new PlaywrightVisualQaAdapter({ factoryRoot: baseDir });
  await visualQaAdapter.init();
  const repairExecutor = new DeterministicRepairExecutor();
  const auditor = new CodingMissionAuditor();

  const orchestrator = new MissionOrchestrator({
    maxRepairs: constraints.maxRepairs,
    baseDir,
    project: projectPath,
    factoryAdapter,
    auditor,
    eventSink,
    missionState: state,
    visualQaAdapter,
    repairExecutor,
    modelRouter,
    // peerReview: undefined (not enabled without real executor)
    validation,
    supervisor,
    replanner: planner,
  });

  const completedMission = await orchestrator.executeMission(mission, plan);
  const finalMission = state.getMission();
  const finalDelegations = state.getDelegations();
  const repairCycles = state.getRepairCycleCount();
  const visualQa = state.getVisualQaResult();
  const buildDelegation = finalDelegations.find(
    (d) => d.description.includes("ROLE: builder") || d.description.includes("BUILD_COMMAND:")
  );
  const lastAuditDelegation = finalDelegations[finalDelegations.length - 1];
  const audit = lastAuditDelegation ? state.getAuditResult(lastAuditDelegation.id) : undefined;

  return {
    missionId: finalMission.id,
    status: finalMission.status,
    projectId,
    projectPath,
    workflowMode,
    plan,
    delegations: finalDelegations,
    result: completedMission,
    ...(buildDelegation && buildDelegation.result
      ? { build: { status: buildDelegation.status, durationMs: buildDelegation.result ? 0 : undefined } }
      : {}),
    ...(visualQa ? { visualQa } : {}),
    ...(audit ? { audit } : {}),
    ...(repairCycles > 0 ? { repairCycles } : {}),
  };
  } finally {
    pixelOfficeReporter?.stop();
    await studioLock?.release();
  }
}
