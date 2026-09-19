import { z } from "zod";
import type { Mission, ExecutionPlan, Delegation, AgentRole } from "./mission.js";
import { createExecutionPlan, createDelegation } from "./mission.js";
import type { MissionMemory } from "./mission-memory.js";
import { Planner } from "./planner.js";
import { isRobloxMission } from "../roblox/platform.js";

// ── Allowed Build/Test Commands ──────────────────────────────────
// Prevent prompt injection via planner-generated commands.
// Only allow known-safe npm/npx commands used in the project.

const ALLOWED_BUILD_COMMANDS = [
  "npm run build",
  "npm run build:prod",
  "npm run build:dev",
  "npm run build:staging",
  "npx tsc",
  "npx tsc --noEmit",
  // Roblox/Rojo validation commands (Roblox missions only).
  "rojo build",
  "rojo check",
];

const ALLOWED_TEST_COMMANDS = [
  "npm test",
  "npm run test",
  "npm run test:unit",
  "npm run test:integration",
  "npm run test:e2e",
  "npx vitest run",
  "npx vitest",
  "npx playwright test",
  // Roblox/Rojo validation commands (Roblox missions only).
  "rojo build",
  "stylua --check",
];

function isNpmCommand(cmd: string): boolean {
  const t = cmd.trim();
  return t === "npm" || t.startsWith("npm ") || t.startsWith("npx ");
}

function isRojoCommand(cmd: string): boolean {
  const t = cmd.trim();
  return t === "rojo" || t.startsWith("rojo ");
}

function validateBuildCommand(cmd: string, roblox = false): boolean {
  const trimmed = cmd.trim();
  // Cross-platform guard: npm/webpack commands are fake on Roblox, and
  // Rojo commands are meaningless on Web. Reject both directions.
  if (roblox && isNpmCommand(trimmed)) return false;
  if (!roblox && isRojoCommand(trimmed)) return false;
  return ALLOWED_BUILD_COMMANDS.some(allowed => trimmed === allowed || trimmed.startsWith(allowed + " "));
}

function validateTestCommand(cmd: string, roblox = false): boolean {
  const trimmed = cmd.trim();
  if (roblox && isNpmCommand(trimmed)) return false;
  if (!roblox && (isRojoCommand(trimmed) || trimmed.startsWith("stylua "))) {
    // stylua/rojo test commands are only meaningful on Roblox.
    return false;
  }
  return ALLOWED_TEST_COMMANDS.some(allowed => trimmed === allowed || trimmed.startsWith(allowed + " "));
}

// ── Planning Model Interface ──────────────────────────────────

export interface PlanningModel {
  generatePlan(prompt: string): Promise<string>;
}

// ── Zod Schemas ───────────────────────────────────────────────

export const PlannedDelegationSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  role: z.enum([
    "Manager", "Researcher", "Developer", "Designer",
    "QA", "Repair", "Architect",
  ]),
  task: z.string().min(1).max(2000),
  dependsOn: z.array(z.string()).default([]),
  validation: z.object({
    buildCommand: z.string().optional(),
    testCommand: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
  }).nullable().optional(),
});
export type PlannedDelegation = z.infer<typeof PlannedDelegationSchema>;

export const PlannedRiskSchema = z.object({
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().optional(),
});
export type PlannedRisk = z.infer<typeof PlannedRiskSchema>;

export const MissionPlanSchema = z.object({
  goal: z.string().min(1),
  delegations: z.array(PlannedDelegationSchema).min(1).max(30),
  risks: z.array(PlannedRiskSchema).default([]),
});
export type MissionPlan = z.infer<typeof MissionPlanSchema>;

// ── Validation Helpers ────────────────────────────────────────

export class PlanValidationError extends Error {
  constructor(
    message: string,
    public readonly details: z.ZodError,
  ) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export function validatePlan(raw: unknown): MissionPlan {
  const result = MissionPlanSchema.safeParse(raw);
  if (!result.success) {
    throw new PlanValidationError(
      `Invalid plan from LLM: ${result.error.issues.map(i => i.message).join(", ")}`,
      result.error,
    );
  }
  return result.data;
}

export function validatePlanStructure(plan: MissionPlan): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const del of plan.delegations) {
    if (ids.has(del.id)) {
      errors.push(`Duplicate delegation ID: ${del.id}`);
    }
    ids.add(del.id);
  }

  for (const del of plan.delegations) {
    for (const depId of del.dependsOn) {
      if (!ids.has(depId)) {
        errors.push(`Delegation "${del.id}" depends on unknown ID: "${depId}"`);
      }
    }
  }

  if (hasCycle(plan.delegations)) {
    errors.push("Circular dependency detected in delegation graph");
  }

  return errors;
}

function hasCycle(delegations: PlannedDelegation[]): boolean {
  const adj = new Map<string, string[]>();
  for (const d of delegations) {
    adj.set(d.id, d.dependsOn);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const d of delegations) color.set(d.id, WHITE);

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const neighbor of (adj.get(node) ?? [])) {
      if (color.get(neighbor) === GRAY) return true;
      if (color.get(neighbor) === WHITE && dfs(neighbor)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const d of delegations) {
    if (color.get(d.id) === WHITE && dfs(d.id)) return true;
  }
  return false;
}

// ── Prompt Builder ────────────────────────────────────────────

function buildPlannerPrompt(
  goal: string,
  availableRoles: string[],
  memoryContext: string | null,
  roblox = false,
  blueprintText?: string,
): string {
  const sections: string[] = [];

  sections.push("You are a mission planner for an AI software factory.");
  sections.push("Given a high-level goal, produce a structured execution plan.");
  sections.push("");

  if (blueprintText) {
    sections.push("PRODUCTION BLUEPRINT (Director contract — delegations must serve it, never redefine its core loop):");
    sections.push(blueprintText.slice(0, 1500));
    sections.push("");
  }

  if (roblox) {
    sections.push("TARGET PLATFORM: Roblox (Luau + Rojo).");
    sections.push("- Implementation tasks MUST be Luau-specific: ModuleScripts, Script vs LocalScript,");
    sections.push("  RemoteEvents/RemoteFunctions, server-authoritative gameplay, DataStore persistence.");
    sections.push("- Validation commands MUST be Rojo-based (e.g. \"rojo build default.project.json -o build.rbxlx\").");
    sections.push("- NEVER emit npm/npx/webpack/tsc commands for this mission: they do not exist on Roblox");
    sections.push("  and would be fake commands.");
    sections.push("");
  }

  if (memoryContext) {
    sections.push("MISSION MEMORY (previous context):");
    sections.push(memoryContext);
    sections.push("");
  }

  sections.push("GOAL:");
  sections.push(goal);
  sections.push("");

  sections.push(`AVAILABLE ROLES: ${availableRoles.join(", ")}`);
  sections.push("");

  sections.push("REQUIREMENTS:");
  sections.push("1. Each delegation MUST have a unique id (kebab-case, e.g. 'research-market')");
  sections.push("2. Each delegation MUST use one of the available roles");
  sections.push("3. The 'dependsOn' array must reference delegation IDs that exist in this plan");
  sections.push("4. NO circular dependencies allowed");
  sections.push("5. Tasks that can run independently should have empty dependsOn");
  sections.push("6. Include validation requirements for code-producing tasks");
  sections.push("7. Keep the plan focused: 2-8 delegations is ideal for most goals");
  sections.push("8. Role does NOT need to be unique — multiple agents can share a role");
  sections.push("");

  sections.push("RESPOND WITH STRICT JSON ONLY (no markdown, no comments):");
  sections.push(JSON.stringify({
    goal: goal,
    delegations: [
      {
        id: "example-id",
        title: "Example Task",
        role: "Developer",
        task: "Description of what this agent should do",
        dependsOn: [],
        validation: roblox
          ? {
            buildCommand: "rojo build default.project.json -o build.rbxlx",
            acceptanceCriteria: ["Criterion 1", "Criterion 2"],
          }
          : {
            buildCommand: "npm run build",
            testCommand: "npm test",
            acceptanceCriteria: ["Criterion 1", "Criterion 2"],
          },
      },
    ],
    risks: [
      { description: "Risk description", severity: "low", mitigation: "How to mitigate" },
    ],
  }, null, 2));

  return sections.join("\n");
}

// ── Mission Planner ───────────────────────────────────────────

export interface MissionPlannerConfig {
  maxPlanRetries: number;
  maxDelegations: number;
  availableRoles: string[];
}

const DEFAULT_PLANNER_CONFIG: MissionPlannerConfig = {
  maxPlanRetries: 3,
  maxDelegations: 20,
  availableRoles: [
    "Manager", "Researcher", "Developer", "Designer",
    "QA", "Repair", "Architect",
  ],
};

export class MissionPlanner {
  private readonly model: PlanningModel;
  private readonly config: MissionPlannerConfig;
  private readonly deterministicFallback: Planner;

  constructor(
    model: PlanningModel,
    config?: Partial<MissionPlannerConfig>,
  ) {
    this.model = model;
    this.config = { ...DEFAULT_PLANNER_CONFIG, ...config };
    this.deterministicFallback = new Planner({
      maxDelegations: this.config.maxDelegations,
    });
  }

  async createPlan(
    mission: Mission,
    memory?: MissionMemory,
  ): Promise<ExecutionPlan> {
    let memoryContext: string | null = null;
    if (memory) {
      memoryContext = memory.buildContextBlock();
    }

    // Platform-aware planning: Roblox missions get Luau/Rojo instructions
    // and Rojo validation commands — never npm.
    const roblox = isRobloxMission(mission);

    // Attach the Production Blueprint summary so the planning model serves
    // the Director contract instead of inventing its own direction.
    let blueprintText: string | undefined;
    try {
      const { deriveBlueprintFromGoal } = await import("./blueprint.js");
      const bp = deriveBlueprintFromGoal(mission.goal);
      blueprintText = [
        `genre: ${bp.genre} (${bp.platform})`,
        `core loop: ${bp.coreLoop}`,
        `systems: ${bp.requiredSystems.join(", ")}`,
        `acceptance: ${bp.acceptanceCriteria.join("; ")}`,
      ].join("\n");
    } catch {
      blueprintText = undefined;
    }

    const prompt = buildPlannerPrompt(
      mission.goal,
      this.config.availableRoles,
      memoryContext,
      roblox,
      blueprintText,
    );

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxPlanRetries; attempt++) {
      try {
        const raw = await this.model.generatePlan(prompt);
        const parsed = parseLlmJson(raw);
        const validated = validatePlan(parsed);
        const structuralErrors = validatePlanStructure(validated);

        if (structuralErrors.length > 0) {
          throw new PlanValidationError(
            `Structural errors: ${structuralErrors.join("; ")}`,
            new z.ZodError([]),
          );
        }

        return normalizePlan(mission, validated, roblox);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }

    // Fallback to deterministic planner
    return this.deterministicFallback.decompose(mission);
  }
}

// ── JSON Parsing Helper ───────────────────────────────────────

function parseLlmJson(raw: string): unknown {
  let cleaned = raw.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try direct parse first
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from text
    const objStart = cleaned.indexOf("{");
    const objEnd = cleaned.lastIndexOf("}");
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(cleaned.slice(objStart, objEnd + 1));
    }
    throw new Error("Failed to parse JSON from LLM output");
  }
}

// ── Plan Normalization ────────────────────────────────────────

function normalizePlan(mission: Mission, plan: MissionPlan, roblox = false): ExecutionPlan {
  const objectives = buildObjectives(plan);
  const delegations = plan.delegations.map((pd) =>
    convertToDelegation(mission, pd, roblox)
  );

  const risks = plan.risks.map((r, i) => ({
    id: `risk-${i + 1}`,
    description: r.description,
    severity: r.severity,
    mitigation: r.mitigation,
  }));

  const validationGates = plan.delegations
    .filter((pd) => pd.validation?.buildCommand || pd.validation?.testCommand)
    .map((pd) => ({
      id: `vg-${pd.id}`,
      delegationId: pd.id,
      criteria: pd.validation?.acceptanceCriteria ?? [],
    }));

  return createExecutionPlan(mission, objectives, delegations, risks, validationGates);
}

function buildObjectives(plan: MissionPlan): Array<{ id: string; title: string; description: string; delegations: string[] }> {
  const objectives: Array<{ id: string; title: string; description: string; delegations: string[] }> = [];
  const roleGroups = new Map<string, string[]>();

  for (const del of plan.delegations) {
    const existing = roleGroups.get(del.role) ?? [];
    existing.push(del.id);
    roleGroups.set(del.role, existing);
  }

  let objIndex = 1;
  for (const [role, delIds] of roleGroups) {
    objectives.push({
      id: `obj-${objIndex}`,
      title: `${role} Tasks`,
      description: `Delegations handled by ${role} agents`,
      delegations: delIds,
    });
    objIndex++;
  }

  return objectives;
}

function convertToDelegation(mission: Mission, pd: PlannedDelegation, roblox = false): Delegation {
  const roleToPipelineType: Record<string, "game" | "engineering"> = {
    Developer: "engineering",
    Architect: "engineering",
    QA: "engineering",
    Repair: "engineering",
    Researcher: "game",
    Designer: "game",
    Manager: "game",
  };

  const pipelineType = roleToPipelineType[pd.role] ?? "engineering";

  // Phase 8: Map planned role to reviewer role for independent review
  const reviewerRole = defaultReviewerRoleFor(pd.role as AgentRole);

  const descriptionParts: string[] = [];
  descriptionParts.push(`ROLE: ${pd.role.toLowerCase()}`);
  descriptionParts.push("");
  descriptionParts.push(pd.task);

  if (pd.validation?.buildCommand) {
    const cmd = pd.validation.buildCommand.trim();
    if (validateBuildCommand(cmd, roblox)) {
      descriptionParts.push("");
      descriptionParts.push(`BUILD_COMMAND: ${cmd}`);
    } else {
      // Log warning but don't include invalid command in delegation.
      // For Roblox this also strips fake npm commands the model may emit.
      console.warn(`[MissionPlanner] Rejected invalid buildCommand: ${cmd}`);
    }
  }
  if (pd.validation?.testCommand) {
    const cmd = pd.validation.testCommand.trim();
    if (validateTestCommand(cmd, roblox)) {
      descriptionParts.push("");
      descriptionParts.push(`TEST_COMMAND: ${cmd}`);
    } else {
      console.warn(`[MissionPlanner] Rejected invalid testCommand: ${cmd}`);
    }
  }

  const acceptanceCriteria = pd.validation?.acceptanceCriteria ?? [
    `${pd.title} completed successfully`,
  ];

  // Phase 8: Use first-class role fields. Implementation/architecture/QA work
  // always benefits from peer review. Research/design work is reviewed by Manager.
  const requiresReview = pd.role !== "Manager" && pd.role !== "Researcher";

  const delegation = createDelegation(
    mission.id,
    "obj-dynamic",
    pd.title,
    descriptionParts.join("\n"),
    pipelineType,
    {
      stepIds: [],
      dependsOn: pd.dependsOn,
      parallelizable: pd.dependsOn.length === 0,
      acceptanceCriteria,
      role: pd.role as AgentRole,
      reviewerRole,
      requiresReview,
    },
  );

  // Preserve the original planned ID for dependency tracking
  // Validate ID: must be unique within plan and not collide with deterministic pattern
  const deterministicPattern = /^del-[a-f0-9]{8}$/;
  if (deterministicPattern.test(pd.id)) {
    // LLM provided an ID that looks like our deterministic format - regenerate to avoid collision
    delegation.id = `llm-${pd.id}`;
  } else {
    delegation.id = pd.id;
  }

  // Check for duplicates within the plan (will be validated later by validatePlanStructure)
  return delegation;
}

function defaultReviewerRoleFor(role: AgentRole): AgentRole | undefined {
  switch (role) {
    case "Developer":
    case "Repair":
      return "QA";
    case "QA":
      return "Architect";
    case "Architect":
      return "Developer";
    case "Designer":
      return "QA";
    case "Researcher":
    case "Manager":
    default:
      return undefined;
  }
}

// ── Factory ───────────────────────────────────────────────────

export function createMissionPlanner(
  model: PlanningModel,
  config?: Partial<MissionPlannerConfig>,
): MissionPlanner {
  return new MissionPlanner(model, config);
}
