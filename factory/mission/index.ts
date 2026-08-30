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
import { Planner, createPlanner } from "./planner.js";
import { MissionOrchestrator, RealFactoryAdapter, DeterministicAuditor } from "./orchestrator.js";
import { InMemoryEventSink, NoopEventSink, MissionEventPublisher, createMissionEventPublisher, MissionEventTypes } from "./events.js";
import { resolveWorkspaceDir } from "../setup/project-setup.js";
import { classifyGoal, detectEngine } from "../engine/engine.js";
import { TemplateManager } from "../setup/project-setup.js";
import { ProjectProvisioner } from "./project-provisioner.js";
import { MissionProjectManager, MissionAwareFactoryAdapter } from "./mission-project-manager.js";

const ALLOWED_TEMPLATES = ["yagames-phaser-template"] as const;

function parseArgs(argv: string[]): {
  command: string;
  goal: string;
  project?: string;
  projectId?: string;
  template?: string;
  dryRun: boolean;
  maxRepairs: number;
  engine?: string;
  force: boolean;
  fromStep?: string;
  listTemplates: boolean;
} {
  const args = [...argv];
  const command = args.shift() ?? "";

  const positional: string[] = [];
  let project: string | undefined;
  let projectId: string | undefined;
  let template: string | undefined;
  let dryRun = false;
  let maxRepairs = 3;
  let engine: string | undefined;
  let force = false;
  let fromStep: string | undefined;
  let listTemplates = false;

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
    } else if (a === "--max-repairs") {
      const n = Number(args[++i]);
      maxRepairs = Number.isFinite(n) && n > 0 ? n : 3;
    } else if (a === "--engine") {
      engine = args[++i];
    } else if (a === "--force") {
      force = true;
    } else if (a === "--from-step") {
      fromStep = args[++i];
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
    maxRepairs,
    engine,
    force,
    fromStep,
    listTemplates,
  };
}

function printUsage(): void {
  console.log(`
🎯 AI FACTORY — Mission Orchestrator

Usage:
  npx tsx factory/mission/index.ts run "Goal" [options]
  npm run mission -- run "Goal" [options]
  npm run mission -- list-templates

Options:
  --project <dir>       Project directory (default: ./projects/<slug>)
  --project-id <id>     Use existing project by ID (must be in projects/)
  --template <id>       Template to use for new project (default: auto)
  --list-templates      List available allowlisted templates
  --engine <name>       Engine: web | unity (default: auto-classified)
  --max-repairs <N>     Max repair iterations per delegation (default: 3)
  --dry-run             Show mission plan, do NOT execute
  --force               Replace existing workspace (DESTROYS content)
  --from-step <id>      Resume pipeline from this step ID

Examples:
  npm run mission -- run "Build a platformer game"
  npm run mission -- run "Fix TypeScript errors" --dry-run
  npm run mission -- run "Add new level" --project-id traffic-dodge
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
    throw new Error("Unity not supported. Use --engine web for Phaser/TypeScript projects.");
  }

  if (goalEngine.kind !== "web" || !goalEngine.supported) {
    throw new Error(`Unsupported engine: ${goalEngine.reason}`);
  }

  const setup = new TemplateManager(baseDir);
  const template = await setup.templateFor(goalEngine);

  if (!template) {
    throw new Error("No embedded template found for WEB projects.");
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
  const { command, goal, project, projectId, template, dryRun, maxRepairs, engine, force, fromStep, listTemplates } = parseArgs(process.argv.slice(2));

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
  console.log(dryRun ? "🧪 MODE: DRY-RUN" : "🧠 MODE: LIVE");
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
  const planner = createPlanner({ maxDelegations: constraints.maxDelegations, allowedPipelines: constraints.allowedPipelines });
  const plan = planner.decompose(mission);

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
  });

  console.log("\n🚀 Starting mission execution...\n");

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
  }
}

main().catch((error) => {
  console.error("\n❌ FATAL ERROR:");
  console.error(error);
  process.exitCode = 1;
});