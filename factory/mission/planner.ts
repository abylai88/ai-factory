import {
  Mission,
  ExecutionPlan,
  Objective,
  Delegation,
  Risk,
  ValidationGate,
  createExecutionPlan,
  createDelegation,
} from "./mission.js";
import { selectPipeline, PipelineType } from "../pipeline/pipeline.js";

export interface PlannerConfig {
  maxDelegations: number;
  allowedPipelines: ("game" | "engineering")[];
}

const DEFAULT_CONFIG: PlannerConfig = {
  maxDelegations: 20,
  allowedPipelines: ["game", "engineering"],
};

function classifyMissionGoal(goal: string): { pipelineType: PipelineType; pattern: string } {
  const lower = goal.toLowerCase();

  const packageFixPatterns = [
    /\b(package|pkg|name|metadata)\b/i,
    /\b(fix|change|update|replace|correct)\b/i,
  ];
  const isPackageFix = packageFixPatterns.every((p) => p.test(lower)) &&
    /\b(package\s*name|name\s*field|metadata\s*name|package\s*metadata)\b/i.test(lower);

  const newGamePatterns = [
    /\b(new|create|make|build|develop|создать|разработать)\b/i,
    /\b(game|игра|arcade|puzzle|clicker|idle|match|casual|platformer)\b/i,
  ];

  const bugfixPatterns = [
    /\b(fix|bug|error|исправить|ошибка|баг|repair|patch)\b/i,
  ];

  const engineeringPatterns = [
    /\b(refactor|typescript|build|deploy|config|setup|test|lint|architecture)\b/i,
  ];

  const improvementPatterns = [
    /\b(improve|enhance|optimize|add|feature|feature|улучшить|добавить)\b/i,
  ];

  const isNewGame = newGamePatterns.every((p) => p.test(lower));
  const isBugfix = bugfixPatterns.some((p) => p.test(lower));
  const isEngineering = engineeringPatterns.some((p) => p.test(lower)) && !/\b(game|игра)\b/i.test(lower);
  const isImprovement = improvementPatterns.some((p) => p.test(lower));

  if (isPackageFix) {
    return { pipelineType: "engineering", pattern: "package-name-fix" };
  }

  if (isNewGame) {
    return { pipelineType: "game", pattern: "new-game" };
  }

  if (isBugfix || isEngineering) {
    return { pipelineType: "engineering", pattern: isBugfix ? "bugfix" : "engineering" };
  }

  if (isImprovement) {
    return { pipelineType: "game", pattern: "improvement" };
  }

  return { pipelineType: "game", pattern: "improvement" };
}

function getPipelineSteps(pipelineType: PipelineType, goal: string): Array<{ id: string; title: string; role: string; agent: string; description: string }> {
  const pipeline = selectPipeline(goal, pipelineType);
  return pipeline.steps.map((s) => ({
    id: s.id,
    title: s.title,
    role: s.role,
    agent: s.agent,
    description: s.description,
  }));
}

export class Planner {
  private readonly config: PlannerConfig;

  constructor(config?: Partial<PlannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  decompose(mission: Mission): ExecutionPlan {
    const { pipelineType, pattern } = classifyMissionGoal(mission.goal);

    if (!this.config.allowedPipelines.includes(pipelineType)) {
      throw new Error(`Pipeline type "${pipelineType}" not allowed for this mission`);
    }

    const steps = getPipelineSteps(pipelineType, mission.goal);
    const objectives: Objective[] = [];
    const delegations: Delegation[] = [];
    const risks: Risk[] = [];
    const validationGates: ValidationGate[] = [];

    let objectiveCounter = 0;
    let delegationIndex = 0;

    const nextObjectiveId = (): string => `obj-${++objectiveCounter}`;

    switch (pattern) {
      case "package-name-fix": {
        const obj1 = this.createObjective(
          nextObjectiveId(),
          "Inspect Package Metadata",
          "Read the target file and verify current package metadata",
          ["research"]
        );
        objectives.push(obj1);

        const obj2 = this.createObjective(
          nextObjectiveId(),
          "Apply Package Metadata Change",
          "Modify the package name field in the target file",
          ["implementation"]
        );
        objectives.push(obj2);

        const obj3 = this.createObjective(
          nextObjectiveId(),
          "Build Project & Audit",
          "Run the project build and verify the change",
          ["build", "review"]
        );
        objectives.push(obj3);

        const inspectDelegation = createDelegation(
          mission.id,
          obj1.id,
          "[1] Inspect Package Metadata",
          "Read package.json and report current name field\nROLE: coder\nFILE: package.json\nOPERATION: read",
          "engineering",
          {
            stepIds: ["research"],
            dependsOn: [],
            parallelizable: false,
            acceptanceCriteria: [
              "Intended file changed",
              "No protected file was modified",
              "Mission objective satisfied",
            ],
          }
        );
        delegations.push(inspectDelegation);

        const modifyDelegation = createDelegation(
          mission.id,
          obj2.id,
          "[2] Apply Package Metadata Change",
          "Replace the incorrect package name with the correct one\nROLE: coder\nFILE: package.json\nOPERATION: replace\nFIELD: name\nOLD_VALUE: neon-breaker\nVALUE: traffic-dodge",
          "engineering",
          {
            stepIds: ["implementation"],
            dependsOn: [inspectDelegation.id],
            parallelizable: false,
            acceptanceCriteria: [
              "Intended file changed",
              "Only intended change occurred",
              "Project remains structurally valid",
              "No protected file was modified",
            ],
          }
        );
        delegations.push(modifyDelegation);

        const buildDelegation = createDelegation(
          mission.id,
          obj3.id,
          "[3] Build Project",
          "Run the project build command\nROLE: builder\nBUILD_COMMAND: npm run build:prod",
          "engineering",
          {
            stepIds: ["build"],
            dependsOn: [modifyDelegation.id],
            parallelizable: false,
            acceptanceCriteria: [
              "Build succeeded",
              "Mission objective satisfied",
            ],
          }
        );
        delegations.push(buildDelegation);

        risks.push(
          { id: "risk-1", description: "Package name change may break imports or references", severity: "low", mitigation: "Build verification after change" },
          { id: "risk-2", description: "Unexpected files may be modified", severity: "medium", mitigation: "Auditor verifies only intended changes" }
        );

        for (const del of delegations) {
          validationGates.push({
            id: `gate-${del.id}`,
            delegationId: del.id,
            criteria: del.acceptanceCriteria,
          });
        }
        break;
      }

      case "new-game": {
        const obj1 = this.createObjective(
          nextObjectiveId(),
          "Research & Concept",
          "Analyze market, competitors, and define game concept",
          ["market", "competitor", "idea"]
        );
        objectives.push(obj1);

        const obj2 = this.createObjective(
          nextObjectiveId(),
          "Design & Architecture",
          "Create GDD, gameplay design, technical design, and architecture",
          ["director", "gameplay", "design", "architect"]
        );
        objectives.push(obj2);

        const obj3 = this.createObjective(
          nextObjectiveId(),
          "Implementation",
          "Implement game code and content",
          ["implementation", "content", "monetization"]
        );
        objectives.push(obj3);

        const obj4 = this.createObjective(
          nextObjectiveId(),
          "Validation & Release",
          "Test, review, build, and prepare release",
          ["test", "review", "build", "release"]
        );
        objectives.push(obj4);

        for (const obj of objectives) {
          for (const stepId of obj.delegations) {
            const step = steps.find((s) => s.id === stepId);
            if (step) {
              delegations.push(this.createDelegationForStep(mission, obj.id, step, delegations, delegationIndex++));
            }
          }
        }

        risks.push(
          { id: "risk-1", description: "Scope creep during implementation", severity: "medium", mitigation: "Strict adherence to GDD" },
          { id: "risk-2", description: "Technical debt from rapid prototyping", severity: "low", mitigation: "Regular code reviews" }
        );

        for (const del of delegations) {
          validationGates.push({
            id: `gate-${del.id}`,
            delegationId: del.id,
            criteria: del.acceptanceCriteria.length > 0 ? del.acceptanceCriteria : [`${del.title} completed successfully`],
          });
        }
        break;
      }

      case "improvement": {
        const obj1 = this.createObjective(
          nextObjectiveId(),
          "Research & Diagnosis",
          "Analyze existing project and identify issues",
          ["research"]
        );
        objectives.push(obj1);

        const obj2 = this.createObjective(
          nextObjectiveId(),
          "Design Solution",
          "Design targeted solution based on research",
          ["design"]
        );
        objectives.push(obj2);

        const obj3 = this.createObjective(
          nextObjectiveId(),
          "Implementation & Validation",
          "Implement fix and verify",
          ["implementation", "test", "review", "build", "release"]
        );
        objectives.push(obj3);

        for (const obj of objectives) {
          for (const stepId of obj.delegations) {
            const step = steps.find((s) => s.id === stepId);
            if (step) {
              delegations.push(this.createDelegationForStep(mission, obj.id, step, delegations, delegationIndex++));
            }
          }
        }

        risks.push(
          { id: "risk-1", description: "Regression in existing functionality", severity: "high", mitigation: "Comprehensive test coverage" }
        );

        for (const del of delegations) {
          validationGates.push({
            id: `gate-${del.id}`,
            delegationId: del.id,
            criteria: del.acceptanceCriteria.length > 0 ? del.acceptanceCriteria : [`${del.title} completed successfully`],
          });
        }
        break;
      }

      case "bugfix":
      case "engineering":
      default: {
        const obj1 = this.createObjective(
          nextObjectiveId(),
          "Research & Diagnosis",
          "Analyze codebase and identify root cause",
          ["research"]
        );
        objectives.push(obj1);

        const obj2 = this.createObjective(
          nextObjectiveId(),
          "Design & Implementation",
          "Design fix and implement",
          ["design", "implementation"]
        );
        objectives.push(obj2);

        const obj3 = this.createObjective(
          nextObjectiveId(),
          "Validation",
          "Test fix and verify no regressions",
          ["test", "review", "build", "release"]
        );
        objectives.push(obj3);

        for (const obj of objectives) {
          for (const stepId of obj.delegations) {
            const step = steps.find((s) => s.id === stepId);
            if (step) {
              delegations.push(this.createDelegationForStep(mission, obj.id, step, delegations, delegationIndex++));
            }
          }
        }

        risks.push(
          { id: "risk-1", description: "Incomplete root cause analysis", severity: "high", mitigation: "Thorough research phase" },
          { id: "risk-2", description: "Fix introduces new bugs", severity: "medium", mitigation: "Comprehensive testing" }
        );

        for (const del of delegations) {
          validationGates.push({
            id: `gate-${del.id}`,
            delegationId: del.id,
            criteria: del.acceptanceCriteria.length > 0 ? del.acceptanceCriteria : [`${del.title} completed successfully`],
          });
        }
        break;
      }
    }

    if (delegations.length > this.config.maxDelegations) {
      delegations.length = this.config.maxDelegations;
    }

    return createExecutionPlan(mission, objectives, delegations, risks, validationGates);
  }

  private createObjective(id: string, title: string, description: string, delegations: string[]): Objective {
    return { id, title, description, delegations };
  }

  private createDelegationForStep(
    mission: Mission,
    objectiveId: string,
    step: { id: string; title: string; role: string; agent: string; description: string },
    previousDelegations: Delegation[],
    index: number
  ): Delegation {
    const dependsOn = index > 0 ? [previousDelegations[index - 1].id] : [];

    const acceptanceCriteria = this.getAcceptanceCriteria(step.id, step.role);

    return createDelegation(
      mission.id,
      objectiveId,
      `[${index + 1}] ${step.title}`,
      step.description,
      mission.context?.engine === "unity" ? "engineering" : "game",
      {
        stepIds: [step.id],
        dependsOn,
        parallelizable: step.role === "research",
        acceptanceCriteria,
      }
    );
  }

  private getAcceptanceCriteria(stepId: string, role: string): string[] {
    const criteriaMap: Record<string, string[]> = {
      market: ["Target audience defined", "Market size estimated", "Monetization benchmarks identified"],
      competitor: ["Top 5 competitors analyzed", "Differentiation opportunities identified"],
      idea: ["Unique selling proposition defined", "Core game loop described", "Key features listed"],
      director: ["GDD created with vision, mechanics, systems", "Phaser scene structure defined", "Production priorities set"],
      gameplay: ["Physics and tuning documented", "Feedback systems specified", "Difficulty curve defined"],
      design: ["Technical plan with file changes", "Solution designed", "Acceptance criteria defined", "No code modified"],
      architect: ["Module structure defined", "State management approach chosen", "Build configuration specified", "Risks identified"],
      implementation: ["Code compiles without errors", "TypeScript passes", "Game runs without runtime errors"],
      content: ["Level data created", "Configurations integrated", "Data-driven approach followed"],
      monetization: ["Ad placement strategy defined", "Reward system designed", "Yandex Games SDK integration planned", "KPIs set"],
      test: ["Build succeeds", "TypeCheck passes", "Gameplay flow tested", "No critical bugs found"],
      review: ["Goal alignment verified", "Code quality assessed", "Regression check passed", "Verdict: release / release-with-fixes / block"],
      build: ["Production build succeeds", "No build errors", "Artifact created"],
      release: ["Final build verified", "Tests pass", "Release report generated"],
      research: ["Codebase analyzed", "Root cause identified", "Issues documented"],
    };

    return criteriaMap[stepId] ?? [`${stepId} completed successfully`];
  }
}

export function createPlanner(config?: Partial<PlannerConfig>): Planner {
  return new Planner(config);
}

export interface ReadOnlyPlannerConfig {
  maxDelegations: number;
}

const DEFAULT_READ_ONLY_CONFIG: ReadOnlyPlannerConfig = {
  maxDelegations: 1,
};

export class ReadOnlyPlanner {
  private readonly config: ReadOnlyPlannerConfig;

  constructor(config?: Partial<ReadOnlyPlannerConfig>) {
    this.config = { ...DEFAULT_READ_ONLY_CONFIG, ...config };
  }

  decompose(mission: Mission): ExecutionPlan {
    const objectives: Objective[] = [];
    const delegations: Delegation[] = [];
    const risks: Risk[] = [];
    const validationGates: ValidationGate[] = [];

    const objective: Objective = {
      id: "obj-1",
      title: "Read-Only Investigation",
      description: "Investigate and analyze the project without modifying files",
      delegations: ["del-1"],
    };
    objectives.push(objective);

    const delegation: Delegation = createDelegation(
      mission.id,
      objective.id,
      "[1] Project Investigation",
      mission.goal,
      "engineering",
      {
        stepIds: ["research"],
        dependsOn: [],
        parallelizable: false,
        acceptanceCriteria: [
          "Codebase analyzed",
          "Architecture documented",
          "Key components identified",
          "No files modified",
        ],
      }
    );
    delegations.push(delegation);

    risks.push({
      id: "risk-1",
      description: "Agent may attempt to modify files despite read-only instructions",
      severity: "low",
      mitigation: "Agent permissions enforce read-only access",
    });

    validationGates.push({
      id: `gate-${delegation.id}`,
      delegationId: delegation.id,
      criteria: delegation.acceptanceCriteria,
    });

    if (delegations.length > this.config.maxDelegations) {
      delegations.length = this.config.maxDelegations;
    }

    return createExecutionPlan(mission, objectives, delegations, risks, validationGates);
  }
}

export function createReadOnlyPlanner(config?: Partial<ReadOnlyPlannerConfig>): ReadOnlyPlanner {
  return new ReadOnlyPlanner(config);
}