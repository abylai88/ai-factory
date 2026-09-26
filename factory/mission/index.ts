import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMission,
  Mission,
  ExecutionPlan,
  MissionStatus,
  Delegation,
  DelegationStatus,
  MissionContext,
  MissionConstraints,
} from "./mission.js";
import { MissionState } from "./state.js";
import { Planner, createPlanner, ReadOnlyPlanner, createReadOnlyPlanner } from "./planner.js";
import { MissionOrchestrator, RealFactoryAdapter, ReadOnlyFactoryAdapter, DeterministicAuditor } from "./orchestrator.js";
import { InMemoryEventSink, NoopEventSink, MissionEventPublisher, createMissionEventPublisher, MissionEventTypes } from "./events.js";
import { createPixelOfficeReporter } from "./pixel-office-reporter.js";
import { resolveWorkspaceDir } from "../setup/project-setup.js";
import { classifyGoal, detectEngine } from "../engine/engine.js";
import { TemplateManager } from "../setup/project-setup.js";
import { ProjectProvisioner } from "./project-provisioner.js";
import { MissionProjectManager, MissionAwareFactoryAdapter } from "./mission-project-manager.js";
import { classifyDiagnosis, generateRepairPlan } from "./diagnosis.js";
import { auditRepairPlan, isRepairPlanSafe } from "./repair-plan-audit.js";
import type { DiagnosisInput } from "./mission.js";
import { OpenCodePlannerModel } from "./opencode-planner-model.js";
import { MissionPlanner, createMissionPlanner } from "./mission-planner.js";
import { createModelRouter } from "./model-router.js";
import { createMissionSupervisor } from "./mission-supervisor.js";
import { PeerReviewSystem } from "./peer-review.js";
import { deriveBlueprintFromGoal } from "./blueprint.js";
import { acquireLock, studioLockName, type LockHandle } from "./resource-control.js";
import { createStudioBridge } from "../studio/mcp-bridge.js";

const ALLOWED_TEMPLATES = ["phaser-generic-web-template", "yagames-phaser-template", "roblox-rojo-template"] as const;

function parseArgs(argv: string[]): {
  command: string;
  goal: string;
  project?: string;
  projectId?: string;
  template?: string;
  dryRun: boolean;
  readOnly: boolean;
  maxRepairs: number;
  engine?: string;
  force: boolean;
  fromStep?: string;
  listTemplates: boolean;
  missionId?: string;
} {
  const args = [...argv];
  const command = args.shift() ?? "";

  const positional: string[] = [];
  let project: string | undefined;
  let projectId: string | undefined;
  let template: string | undefined;
  let dryRun = false;
  let readOnly = false;
  let maxRepairs = 3;
  let engine: string | undefined;
  let force = false;
  let fromStep: string | undefined;
  let listTemplates = false;
  let missionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--project") {
      project = args[++i];
    } else if (a === "--project-id") {
      projectId = args[++i];
    } else if (a === "--template") {
      template = args[++i];
    } else if (a === "--list-templates") {
      listTemplates = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--read-only") {
      readOnly = true;
    } else if (a === "--max-repairs") {
      const n = Number(args[++i]);
      maxRepairs = Number.isFinite(n) && n > 0 ? n : 3;
    } else if (a === "--engine") {
      engine = args[++i];
    } else if (a === "--force") {
      force = true;
    } else if (a === "--from-step") {
      fromStep = args[++i];
    } else if (a === "--mission-id") {
      missionId = args[++i];
    } else if (a.startsWith("--")) {
    } else {
      positional.push(a);
    }
  }

  return {
    command,
    goal: positional.join(" ").trim(),
    project,
    projectId,
    template,
    dryRun,
    readOnly,
    maxRepairs,
    engine,
    force,
    fromStep,
    listTemplates,
    missionId,
  };
}

function printUsage(): void {
  console.log(`
🎯 AI FACTORY — Mission Orchestrator

Usage:
  npx tsx factory/mission/index.ts run "Goal" [options]
  npm run mission -- run "Goal" [options]
  npm run mission -- resume <mission-id> [options]
  npm run mission -- diagnose <mission-id>
  npm run mission -- list-templates

Options:
  --project <dir>       Project directory (default: ./projects/<slug>)
  --project-id <id>     Use existing project by ID (must be in projects/)
  --template <id>       Template to use for new project (default: auto)
  --list-templates      List available allowlisted templates
  --engine <name>       Engine: web | roblox (default: auto-classified)
  --max-repairs <N>     Max repair iterations per delegation (default: 3)
  --dry-run             Show mission plan, do NOT execute
  --read-only           Execute read-only investigation (no file modifications)
  --force               Replace existing workspace (DESTROYS content)
  --from-step <id>      Resume pipeline from this step ID (manual override)
  --mission-id <id>     Mission ID for diagnose command

Resume Options:
  --from-step <id>      Override resume point (default: auto-detect from state)

Examples:
  npm run mission -- run "Build a platformer game"
  npm run mission -- run "Create a Roblox simulator with coins and upgrades" --engine roblox
  npm run mission -- run "Fix TypeScript errors" --dry-run
  npm run mission -- run "Add new level" --project-id traffic-dodge
  npm run mission -- run "Inspect project architecture" --read-only --project-id traffic-dodge
  npm run mission -- resume mission-abc12345
  npm run mission -- resume mission-abc12345 --from-step build-step
  npm run mission -- diagnose mission-abc12345
  npm run mission -- list-templates
`);
}

async function setupWorkspace(
  baseDir: string,
  goal: string,
  projectDir: string | undefined,
  engineOverride: string | undefined,
  force: boolean,
  provisioner: ProjectProvisioner,
  projectId?: string,
  templateOverride?: string
): Promise<{ workspaceDir: string; engine: ReturnType<typeof classifyGoal>; template: NonNullable<Awaited<ReturnType<TemplateManager["templateFor"]>>> }> {
  const explicitEngine = engineOverride ? classifyGoal(goal, engineOverride) : undefined;
  const goalEngine = explicitEngine ?? classifyGoal(goal);

  if (goalEngine.kind === "unity") {
    throw new Error("Unity not supported. Use --engine web for Phaser/TypeScript projects or --engine roblox for Roblox/Luau projects.");
  }

  // Web and Roblox are both first-class platforms. Anything else is rejected.
  if ((goalEngine.kind !== "web" && goalEngine.kind !== "roblox") || !goalEngine.supported) {
    throw new Error(`Unsupported engine: ${goalEngine.reason}`);
  }

  const setup = new TemplateManager(baseDir);
  const template = await setup.templateFor(goalEngine, goal);

  if (!template) {
    throw new Error(`No embedded template found for ${goalEngine.kind.toUpperCase()} projects.`);
  }

  let workspaceDir: string;

  if (projectDir) {
    workspaceDir = projectDir;
  } else if (projectId) {
    const candidatePath = path.join(baseDir, "projects", projectId);
    const validation = await provisioner.validateProject(candidatePath);
    if (validation.valid) {
      workspaceDir = candidatePath;
    } else {
      const handle = await provisioner.provision(templateOverride ?? template.id, projectId);
      workspaceDir = handle.projectPath;
    }
  } else {
    workspaceDir = resolveWorkspaceDir(baseDir, goal);
  }

  console.log("📦 Setting up project workspace...");
  const setupResult = await setup.copyTemplate(template, workspaceDir, { force });

  if (setupResult.resumed) {
    console.log(`   📁 Existing workspace detected at ${workspaceDir} — resuming`);
  } else {
    console.log(`   ✅ Template "${template.id}" copied to ${workspaceDir}`);
  }

  return { workspaceDir, engine: goalEngine, template };
}

async function main(): Promise<void> {
  const { command, goal, project, projectId, template, dryRun, readOnly, maxRepairs, engine, force, fromStep, listTemplates, missionId } = parseArgs(process.argv.slice(2));

  if (command === "list-templates" || listTemplates) {
    const baseDir = path.resolve(process.env.AI_FACTORY_HOME ?? process.cwd());
    const provisioner = new ProjectProvisioner({
      baseDir,
      templatesDir: path.join(baseDir, "templates"),
      projectsDir: path.join(baseDir, "projects"),
      allowedTemplateIds: ALLOWED_TEMPLATES,
    });
    const templates = await provisioner.listTemplates();
    console.log("\nAvailable Templates:");
    for (const t of templates) {
      const status = t.exists ? "✅" : "❌ missing";
      console.log(`  ${t.id} — ${status}`);
    }
    return;
  }

  if (command === "diagnose") {
    const baseDir = path.resolve(process.env.AI_FACTORY_HOME ?? process.cwd());
    const mid = goal || missionId;
    if (!mid) {
      console.error("Usage: npm run mission -- diagnose <mission-id>");
      process.exitCode = 1;
      return;
    }

    const state = new MissionState(baseDir, mid);
    await state.init();
    const mission = state.getMission();

    if (!mission.id || mission.status === "draft") {
      console.error(`Mission ${mid} not found or not yet executed.`);
      process.exitCode = 1;
      return;
    }

    const visualQa = state.getVisualQaResult();
    if (!visualQa) {
      console.error(`Mission ${mid} has no Visual QA result. Cannot diagnose.`);
      process.exitCode = 1;
      return;
    }

    const delegations = state.getDelegations();
    const buildDelegation = delegations.find(
      (d) => d.description.includes("ROLE: builder") || d.description.includes("BUILD_COMMAND:")
    );
    const buildFailed = buildDelegation?.status === "failed";
    const buildError = buildDelegation?.error;

    const failedChecks = (visualQa.checkDetails ?? [])
      .filter((c) => c.status === "failed")
      .map((c) => ({ name: c.name, viewport: c.viewport, message: c.message }));

    const affectedFiles = [...new Set(
      delegations
        .filter((d) => d.status === "passed" || d.status === "failed")
        .flatMap((d) => {
          const files: string[] = [];
          const match = d.description.match(/FILE: (.+)/);
          if (match) files.push(match[1].trim());
          return files;
        })
    )];

    const input: DiagnosisInput = {
      missionId: mission.id,
      projectId: mission.context?.projectId ?? "unknown",
      projectPath: mission.context?.workspace ?? "unknown",
      acceptanceCriteria: delegations.flatMap((d) => d.acceptanceCriteria),
      buildFailed,
      buildError: buildError ?? undefined,
      runtimeErrors: visualQa.errors,
      visualQaStatus: visualQa.status,
      visualQaEvidence: state.getVisualQaEvidence(),
      failedChecks,
      artifactMetadata: visualQa.artifacts.map((a) => ({ id: a.id, type: a.type, label: a.label })),
      affectedFiles,
      engine: mission.context?.engine,
    };

    await state.recordDiagnosisStarted();

    const diagnosis = classifyDiagnosis(input);
    const repairPlan = generateRepairPlan(input, diagnosis, mission.constraints?.maxRepairs ?? 3);

    const violations = auditRepairPlan(repairPlan);
    if (violations.length > 0) {
      console.error("\n❌ RepairPlan safety audit failed:");
      for (const v of violations) {
        console.error(`  [${v.rule}] ${v.message}`);
      }
      process.exitCode = 1;
      return;
    }

    await state.recordDiagnosisCompleted(diagnosis, repairPlan);

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║     🔍 DIAGNOSIS REPORT             ║");
    console.log("╚══════════════════════════════════════╝");
    console.log(`Mission: ${mission.id}`);
    console.log(`Category: ${diagnosis.category}`);
    console.log(`Severity: ${diagnosis.severity}`);
    console.log(`Confidence: ${diagnosis.confidence}`);
    console.log(`Summary: ${diagnosis.summary}`);
    if (diagnosis.evidence.length > 0) {
      console.log("\nEvidence:");
      for (const e of diagnosis.evidence) {
        console.log(`  - ${e}`);
      }
    }

    console.log("\n📋 REPAIR PLAN:");
    console.log(`Plan ID: ${repairPlan.id}`);
    console.log(`Max Attempts: ${repairPlan.maxAttempts}`);
    console.log(`Actions: ${repairPlan.actions.length}`);
    for (const action of repairPlan.actions) {
      console.log(`\n  [${action.operation}] ${action.file}`);
      console.log(`    Reason: ${action.reason}`);
      console.log(`    Expected: ${action.expectedOutcome}`);
      console.log(`    Scope: ${action.scope}`);
    }

    console.log("\n✅ Verification Plan:");
    console.log(`  Steps: ${repairPlan.verificationPlan.steps.join(" → ")}`);
    console.log(`  ${repairPlan.verificationPlan.description}`);

    console.log("\n🔒 Safety: PASS (no violations)");
    return;
  }

  // ─── Resume Command ──────────────────────────────────────────────
  if (command === "resume") {
    const baseDir = path.resolve(process.env.AI_FACTORY_HOME ?? process.cwd());
    const mid = goal || missionId;
    if (!mid) {
      console.error("Usage: npm run mission -- resume <mission-id>");
      process.exitCode = 1;
      return;
    }

    console.log(`
╔══════════════════════════════════════╗
║      🔄 MISSION RESUME              ║
╚══════════════════════════════════════╝
`);
    console.log(`🔄 Resuming mission: ${mid}`);

    const missionState = new MissionState(baseDir, mid);
    await missionState.init();

    const mission = missionState.getMission();
    if (!mission.id || mission.status === "draft") {
      console.error(`Mission ${mid} not found or not yet executed.`);
      process.exitCode = 1;
      return;
    }

    if (mission.status === "completed") {
      console.log(`✅ Mission ${mid} is already completed. Nothing to resume.`);
      return;
    }

    // Show current progress before resume (from persisted state, not plan)
    const progressBefore = missionState.getProgress();
    console.log(`📊 Progress before resume: ${progressBefore.completed}/${progressBefore.total} delegations passed`);
    console.log(`📌 Status: ${mission.status}`);

    // Show repair history for failed delegations
    const failedDels = missionState.getDelegations().filter((d) => d.status === "failed" && !d.retryOf);
    for (const del of failedDels) {
      const repairCount = missionState.getRepairAttemptCount(del.id);
      const maxRepairs = mission.constraints?.maxRepairs ?? 3;
      const exhausted = missionState.isBudgetExhausted(del.id);
      console.log(`   ⚠️  ${del.title} (${del.id}): ${repairCount}/${maxRepairs} repairs${exhausted ? " - BUDGET EXHAUSTED" : ""}`);
    }

    // Prepare state for resume: reset only running delegations, preserve all history
    const { plan, delegations } = await missionState.prepareForResume();

    if (!plan) {
      console.error(`Mission ${mid} has no execution plan. Cannot resume.`);
      process.exitCode = 1;
      return;
    }

    const workspaceDir = mission.context?.workspace;
    if (!workspaceDir) {
      console.error(`Mission ${mid} has no workspace path in context. Cannot resume.`);
      process.exitCode = 1;
      return;
    }

    console.log(`📁 Workspace: ${workspaceDir}`);
    console.log(`📋 Plan: ${plan.id} (${plan.delegations.length} delegations)`);

    // Show resume state from persisted delegation history
    const resumeState = missionState.getResumeState();
    console.log(`✅ Completed (skipped): ${resumeState.completed.size}`);
    console.log(`❌ Failed/repair-delegations (skipped): ${resumeState.failed.size}`);
    console.log(`🔄 Will attempt: ${resumeState.resumable.size} delegations`);

    // Validate workspace exists
    const fs = await import("node:fs/promises");
    try {
      await fs.access(workspaceDir);
    } catch {
      console.error(`❌ Workspace not found: ${workspaceDir}`);
      console.error("The project directory may have been moved or deleted.");
      process.exitCode = 1;
      return;
    }

    const provisioner = new ProjectProvisioner({
      baseDir,
      templatesDir: path.join(baseDir, "templates"),
      projectsDir: path.join(baseDir, "projects"),
      allowedTemplateIds: ALLOWED_TEMPLATES,
    });
    const projectManager = new MissionProjectManager({ baseDir, provisioner });

    const eventSink = new InMemoryEventSink();
    const publisher = createMissionEventPublisher(eventSink);
    const modelRouter = createModelRouter();

    const supervisor = createMissionSupervisor({
      missionState,
      eventSink,
      publisher,
      modelRouter,
    });

    // Roblox missions validate with the Rojo validator; Web uses npm build.
    const isResumeRoblox = mission.context?.engine === "roblox";
    const validation = {
      buildCommand: isResumeRoblox ? undefined : "npm run build",
      engine: isResumeRoblox ? "roblox" : "web",
      timeoutMs: 120_000,
      maxRepairAttempts: 3,
    };

    // Quality stage for resume: same bridge setup as main path.
    let resumeQualityStage: typeof qualityStage;
    if (isResumeRoblox) {
      let bridge: ReturnType<typeof createStudioBridge> | undefined;
      try {
        bridge = createStudioBridge();
      } catch {
        bridge = undefined;
      }
      resumeQualityStage = {
        enabled: true,
        bridge,
        maxRounds: 3,
        repairBudget: maxRepairs,
      };
    } else {
      resumeQualityStage = undefined;
    }

    const pixelOfficeReporter = createPixelOfficeReporter(eventSink, console.log);
    if (pixelOfficeReporter) {
      pixelOfficeReporter.start();
    }

    const innerAdapter = new RealFactoryAdapter();
    const factoryAdapter = new MissionAwareFactoryAdapter({ baseDir, projectManager }, innerAdapter);
    const auditor = new DeterministicAuditor();

    const orchestrator = new MissionOrchestrator({
      maxRepairs,
      baseDir,
      project: workspaceDir,
      factoryAdapter,
      auditor,
      eventSink,
      missionState,
      modelRouter,
      validation,
      supervisor,
      resume: true,
      qualityStage: resumeQualityStage,
    });

    console.log("\n🚀 Resuming mission execution...\n");

    try {
      const finalMission = await orchestrator.executeMission(mission, plan);

      console.log("\n╔══════════════════════════════════════╗");
      console.log(`║  ${finalMission.status === "completed" ? "✅ MISSION COMPLETED" : "❌ MISSION FAILED"}  ║`);
      console.log("╚══════════════════════════════════════╝");
      console.log(`Status: ${finalMission.status}`);

      const progressAfter = missionState.getProgress();
      console.log(`Progress: ${progressAfter.completed}/${progressAfter.total} delegations passed`);
      console.log(`Resumed from: ${resumeState.completed.size} previously completed`);

      const events = eventSink.recent();
      if (events.length > 0) {
        console.log(`\n📡 Events emitted: ${events.length}`);
      }

      if (finalMission.status === "failed") {
        process.exitCode = 1;
      }
    } catch (error) {
      console.error("\n❌ MISSION RESUME ERROR:");
      console.error(error instanceof Error ? error.message : error);
      await missionState.completeMission("failed");
      process.exitCode = 1;
    } finally {
      pixelOfficeReporter?.stop();
    }
    return;
  }

  if (!command || command !== "run" || !goal) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const baseDir = path.resolve(process.env.AI_FACTORY_HOME ?? process.cwd());

  console.log(`
╔══════════════════════════════════════╗
║      🎯 MISSION ORCHESTRATOR        ║
╚══════════════════════════════════════╝
`);
  console.log("🎯 GOAL:", goal);
  console.log(dryRun ? "🧪 MODE: DRY-RUN" : readOnly ? "👁️  MODE: READ-ONLY" : "🧠 MODE: LIVE");
  console.log(`🔧 MAX REPAIRS: ${maxRepairs}`);

  const provisioner = new ProjectProvisioner({
    baseDir,
    templatesDir: path.join(baseDir, "templates"),
    projectsDir: path.join(baseDir, "projects"),
    allowedTemplateIds: ALLOWED_TEMPLATES,
  });

  const projectManager = new MissionProjectManager({ baseDir, provisioner });

  const { workspaceDir, engine: goalEngine, template: templateDesc } = await setupWorkspace(baseDir, goal, project, engine, force, provisioner, projectId, template);

  console.log("📁 WORKSPACE:", workspaceDir);
  console.log(`⚙️  ENGINE: ${goalEngine.kind}${goalEngine.stack ? " — " + goalEngine.stack : ""}`);
  console.log(`🗂  TEMPLATE: templates/${templateDesc.id}`);

  const context: MissionContext = {
    projectId: projectId ?? path.basename(workspaceDir),
    engine: goalEngine.kind,
    stack: goalEngine.stack,
    template: templateDesc.id,
    workspace: workspaceDir,
  };

  const constraints: MissionConstraints = {
    maxRepairs,
    maxDelegations: 20,
    allowedPipelines: ["game", "engineering"],
    requireApproval: false,
  };

  const mission = createMission(goal, context, constraints);

  // Production Blueprint: structured pre-implementation contract carried on
  // the mission so every specialist receives a slice of it via handoff.
  try {
    (mission as any).blueprint = deriveBlueprintFromGoal(goal);
  } catch {
    // Blueprint derivation never blocks mission creation.
  }

  let plan: ExecutionPlan;
  if (readOnly) {
    const readOnlyPlanner = createReadOnlyPlanner({ maxDelegations: 1 });
    plan = readOnlyPlanner.decompose(mission);
  } else {
    const plannerModel = new OpenCodePlannerModel({
      projectDir: workspaceDir,
    });
    const missionPlanner = createMissionPlanner(plannerModel, {
      maxDelegations: constraints.maxDelegations,
    });
    plan = await missionPlanner.createPlan(mission);
  }

  console.log("\n📋 EXECUTION PLAN:");
  console.log("══════════════════");
  console.log(`Plan ID: ${plan.id}`);
  console.log(`Objectives: ${plan.objectives.length}`);
  console.log(`Delegations: ${plan.delegations.length}`);
  console.log(`Risks: ${plan.risks.length}`);

  for (const obj of plan.objectives) {
    console.log(`\n  📌 ${obj.title} (${obj.id})`);
    console.log(`     ${obj.description}`);
    for (const delId of obj.delegations) {
      const del = plan.delegations.find((d: Delegation) => d.id === delId);
      if (del) {
        const deps = del.dependsOn.length > 0 ? ` ← ${del.dependsOn.join(", ")}` : "";
        console.log(`     • ${del.title}${deps}`);
      }
    }
  }

  if (plan.risks.length > 0) {
    console.log("\n⚠️  RISKS:");
    for (const risk of plan.risks) {
      console.log(`   [${risk.severity.toUpperCase()}] ${risk.description}`);
      if (risk.mitigation) console.log(`      Mitigation: ${risk.mitigation}`);
    }
  }

  if (dryRun) {
    console.log("\n🧪 DRY-RUN: Plan generated. No execution performed.");
    return;
  }

  const missionState = new MissionState(baseDir, mission.id);
  await missionState.init();
  await missionState.setMission(mission);
  await missionState.setPlan(plan);

  for (const del of plan.delegations) {
    await missionState.addDelegation(del);
  }

  const eventSink = new InMemoryEventSink();
  const publisher = createMissionEventPublisher(eventSink);

  // Phase 10: Wire Phase 8-9 systems
  const modelRouter = createModelRouter();

  const supervisor = createMissionSupervisor({
    missionState,
    eventSink,
    publisher,
    modelRouter,
  });

  // Peer review is not enabled in production until a real ReviewExecutor is implemented.
  // The defaultReviewExecutor was a stub that always failed; peer review requires
  // an explicit production executor to be provided.
  const peerReview = undefined;

  // Roblox missions validate with the Rojo validator; Web uses npm build.
  const isMainRoblox = goalEngine.kind === "roblox";
  const validation = {
    buildCommand: isMainRoblox ? undefined : "npm run build",
    engine: isMainRoblox ? "roblox" : "web",
    timeoutMs: 120_000,
    maxRepairAttempts: 3,
  };

// Production quality stage config: enabled by default for Roblox,
 // optional/absent for Web to preserve backward compatibility.
 // Delegates to orchestrator.collectQualityReview / executeQualityRepair which use
 // the Studio bridge for real evidence (screenshot, UI, scene) and real repair delegations.
 let qualityStageBridge: ReturnType<typeof createStudioBridge> | undefined;
 if (isMainRoblox) {
   try {
     qualityStageBridge = createStudioBridge();
   } catch {
     // Bridge creation failed (e.g., no STUDIO_BRIDGE_URL configured).
     // Quality stage will honestly report unavailable evidence.
     qualityStageBridge = undefined;
   }
 }
 const qualityStage = isMainRoblox
   ? {
       enabled: true,
       bridge: qualityStageBridge,
       maxRounds: 3,
       repairBudget: maxRepairs,
     }
   : undefined;

  // Start Pixel Office reporting if configured
  const pixelOfficeReporter = createPixelOfficeReporter(eventSink, console.log);
  if (pixelOfficeReporter) {
    pixelOfficeReporter.start();
  }

  let innerAdapter;
  if (readOnly) {
    innerAdapter = new ReadOnlyFactoryAdapter();
  } else {
    innerAdapter = new RealFactoryAdapter();
  }
  const factoryAdapter = new MissionAwareFactoryAdapter({ baseDir, projectManager }, innerAdapter);
  const auditor = new DeterministicAuditor();

  const orchestrator = new MissionOrchestrator({
    maxRepairs,
    baseDir,
    project: workspaceDir,
    factoryAdapter,
    auditor,
    eventSink,
    missionState,
    modelRouter,
    // peerReview: undefined (not enabled without real executor)
    validation,
    supervisor,
    qualityStage,
  });

  console.log("\n🚀 Starting mission execution...\n");

  // Single-Studio policy: only one mission may drive Roblox Studio at a
  // time. Contended → honest BLOCKED error, never a second Studio instance.
  let studioLock: LockHandle | null = null;
  if (isMainRoblox) {
    studioLock = await acquireLock(baseDir, studioLockName());
    if (!studioLock) {
      console.error("❌ BLOCKED (infrastructure): another mission holds the Roblox Studio singleton lock.");
      console.error("Queue this mission instead of opening a second Studio.");
      process.exitCode = 1;
      return;
    }
  }

  try {
    const finalMission = await orchestrator.executeMission(mission, plan);

    console.log("\n╔══════════════════════════════════════╗");
    console.log(`║  ${finalMission.status === "completed" ? "✅ MISSION COMPLETED" : "❌ MISSION FAILED"}  ║`);
    console.log("╚══════════════════════════════════════╝");
    console.log(`Status: ${finalMission.status}`);

    const progress = missionState.getProgress();
    console.log(`Progress: ${progress.completed}/${progress.total} delegations passed`);

    const events = eventSink.recent();
    if (events.length > 0) {
      console.log(`\n📡 Events emitted: ${events.length}`);
    }

    if (finalMission.status === "failed") {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("\n❌ MISSION ERROR:");
    console.error(error instanceof Error ? error.message : error);
    await missionState.completeMission("failed");
    process.exitCode = 1;
  } finally {
    pixelOfficeReporter?.stop();
    await studioLock?.release();
  }
}

main().catch((error) => {
  console.error("\n❌ FATAL ERROR:");
  console.error(error);
  process.exitCode = 1;
});