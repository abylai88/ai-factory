import {
  Mission,
  ExecutionPlan,
  MissionStatus,
  createMission,
  MissionContext,
  MissionConstraints,
} from "./mission.js";
import { ProjectProvisioner } from "./project-provisioner.js";
import { Planner, createPlanner } from "./planner.js";

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
    allowedTemplateIds: ["yagames-phaser-template"],
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
    const templateId = input.templateId || "yagames-phaser-template";
    const handle = await provisioner.provision(templateId);
    projectId = handle.projectId;
    projectPath = handle.projectPath;
  }
  
  // 4. Create Mission
  const context: MissionContext = {
    projectId,
    engine: "web",
    stack: "phaser",
    template: input.templateId || "yagames-phaser-template",
    workspace: projectPath,
  };
  
  const constraints: MissionConstraints = {
    maxRepairs: 3,
    maxDelegations: 20,
    allowedPipelines: ["game", "engineering"],
    requireApproval: false,
  };
  
  const mission = createMission(input.goal, context, constraints);
  
  // 5. Create Planner
  const planner: Planner = createPlanner({ 
    maxDelegations: constraints.maxDelegations, 
    allowedPipelines: constraints.allowedPipelines 
  });
  
  // 6. Generate ExecutionPlan
  const plan = planner.decompose(mission);
  
  // 7. Return structured GameMissionResult
  return {
    missionId: mission.id,
    status: mission.status,
    projectId,
    projectPath,
    workflowMode,
    plan,
  };
}