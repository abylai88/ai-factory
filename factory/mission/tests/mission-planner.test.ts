import { describe, it, expect } from "vitest";
import {
  validatePlan,
  validatePlanStructure,
  PlanValidationError,
  MissionPlanSchema,
  PlannedDelegationSchema,
  type PlanningModel,
  type MissionPlan,
} from "../mission-planner.js";
import { createMission } from "../mission.js";
import { MissionPlanner, createMissionPlanner } from "../mission-planner.js";

// ── Helpers ──────────────────────────────────────────────────

function createMockModel(response: string | Error): PlanningModel {
  return {
    async generatePlan(): Promise<string> {
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

function validPlanJson(overrides?: Partial<MissionPlan>): string {
  return JSON.stringify({
    goal: "Build a puzzle game",
    delegations: [
      {
        id: "research-market",
        title: "Research market",
        role: "Researcher",
        task: "Analyze browser puzzle game market",
        dependsOn: [],
        validation: null,
      },
      {
        id: "implement-game",
        title: "Implement game",
        role: "Developer",
        task: "Build the puzzle game with Phaser",
        dependsOn: ["research-market"],
        validation: {
          buildCommand: "npm run build",
          testCommand: "npm test",
          acceptanceCriteria: ["Build succeeds", "Tests pass"],
        },
      },
    ],
    risks: [
      { description: "Scope creep", severity: "medium", mitigation: "Time-box research" },
    ],
    ...overrides,
  });
}

// ── Schema Validation ─────────────────────────────────────────

describe("MissionPlanner Zod schemas", () => {
  it("validates a complete plan", () => {
    const raw = JSON.parse(validPlanJson());
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it("rejects empty delegations array", () => {
    const raw = JSON.parse(validPlanJson());
    raw.delegations = [];
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects delegation with unknown role", () => {
    const raw = JSON.parse(validPlanJson());
    raw.delegations[0].role = "UnknownRole";
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects delegation with empty id", () => {
    const raw = JSON.parse(validPlanJson());
    raw.delegations[0].id = "";
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("rejects delegation with empty title", () => {
    const raw = JSON.parse(validPlanJson());
    raw.delegations[0].title = "";
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("accepts delegation with empty task", () => {
    const raw = JSON.parse(validPlanJson());
    raw.delegations[0].task = "";
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(false);
  });

  it("defaults dependsOn to empty array", () => {
    const raw = JSON.parse(validPlanJson());
    delete raw.delegations[0].dependsOn;
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delegations[0].dependsOn).toEqual([]);
    }
  });

  it("defaults risks to empty array", () => {
    const raw = JSON.parse(validPlanJson());
    delete raw.risks;
    const result = MissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.risks).toEqual([]);
    }
  });

  it("accepts all valid roles", () => {
    const roles = ["Manager", "Researcher", "Developer", "Designer", "QA", "Repair", "Architect"];
    for (const role of roles) {
      const del = PlannedDelegationSchema.safeParse({
        id: "test",
        title: "Test",
        role,
        task: "Do something",
        dependsOn: [],
        validation: null,
      });
      expect(del.success).toBe(true);
    }
  });

  it("accepts null validation", () => {
    const del = PlannedDelegationSchema.safeParse({
      id: "test",
      title: "Test",
      role: "Developer",
      task: "Build something",
      dependsOn: [],
      validation: null,
    });
    expect(del.success).toBe(true);
  });
});

// ── Structural Validation ─────────────────────────────────────

describe("validatePlanStructure()", () => {
  it("returns no errors for valid plan", () => {
    const plan = JSON.parse(validPlanJson()) as MissionPlan;
    const errors = validatePlanStructure(plan);
    expect(errors).toEqual([]);
  });

  it("detects duplicate delegation IDs", () => {
    const plan = JSON.parse(validPlanJson()) as MissionPlan;
    plan.delegations.push({ ...plan.delegations[0] });
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("detects unknown dependencies", () => {
    const plan = JSON.parse(validPlanJson()) as MissionPlan;
    plan.delegations[0].dependsOn = ["nonexistent-id"];
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes("unknown"))).toBe(true);
  });

  it("detects circular dependencies", () => {
    const plan: MissionPlan = {
      goal: "Test",
      delegations: [
        { id: "a", title: "A", role: "Developer", task: "Do A", dependsOn: ["b"], validation: null },
        { id: "b", title: "B", role: "Developer", task: "Do B", dependsOn: ["a"], validation: null },
      ],
      risks: [],
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes("Circular"))).toBe(true);
  });

  it("detects longer circular chains", () => {
    const plan: MissionPlan = {
      goal: "Test",
      delegations: [
        { id: "a", title: "A", role: "Developer", task: "Do A", dependsOn: ["c"], validation: null },
        { id: "b", title: "B", role: "Developer", task: "Do B", dependsOn: ["a"], validation: null },
        { id: "c", title: "C", role: "Developer", task: "Do C", dependsOn: ["b"], validation: null },
      ],
      risks: [],
    };
    const errors = validatePlanStructure(plan);
    expect(errors.some((e) => e.includes("Circular"))).toBe(true);
  });

  it("allows valid dependency chains", () => {
    const plan: MissionPlan = {
      goal: "Test",
      delegations: [
        { id: "a", title: "A", role: "Researcher", task: "Research", dependsOn: [], validation: null },
        { id: "b", title: "B", role: "Developer", task: "Build", dependsOn: ["a"], validation: null },
        { id: "c", title: "C", role: "QA", task: "Test", dependsOn: ["b"], validation: null },
      ],
      risks: [],
    };
    const errors = validatePlanStructure(plan);
    expect(errors).toEqual([]);
  });
});

// ── validatePlan() ────────────────────────────────────────────

describe("validatePlan()", () => {
  it("parses and validates valid JSON", () => {
    const raw = JSON.parse(validPlanJson());
    const plan = validatePlan(raw);
    expect(plan.delegations).toHaveLength(2);
    expect(plan.delegations[0].id).toBe("research-market");
  });

  it("throws PlanValidationError for invalid input", () => {
    expect(() => validatePlan({ goal: "test", delegations: [] })).toThrow(PlanValidationError);
  });
});

// ── MissionPlanner ────────────────────────────────────────────

describe("MissionPlanner", () => {
  it("creates a plan from valid LLM output", async () => {
    const model = createMockModel(validPlanJson());
    const planner = createMissionPlanner(model);
    const mission = createMission("Build a puzzle game");

    const plan = await planner.createPlan(mission);
    expect(plan.delegations).toHaveLength(2);
    expect(plan.delegations[0].id).toBe("research-market");
    expect(plan.delegations[1].dependsOn).toContain("research-market");
  });

  it("retries on invalid JSON", async () => {
    let callCount = 0;
    const model: PlanningModel = {
      async generatePlan(): Promise<string> {
        callCount++;
        if (callCount === 1) return "not valid json {{{";
        return validPlanJson();
      },
    };

    const planner = createMissionPlanner(model);
    const mission = createMission("Build a puzzle game");
    const plan = await planner.createPlan(mission);

    expect(callCount).toBe(2);
    expect(plan.delegations).toHaveLength(2);
  });

  it("retries on invalid schema", async () => {
    let callCount = 0;
    const model: PlanningModel = {
      async generatePlan(): Promise<string> {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ goal: "test", delegations: [] });
        }
        return validPlanJson();
      },
    };

    const planner = createMissionPlanner(model);
    const mission = createMission("Build a puzzle game");
    const plan = await planner.createPlan(mission);

    expect(callCount).toBe(2);
    expect(plan.delegations.length).toBeGreaterThan(0);
  });

  it("retries on structural errors (circular deps)", async () => {
    let callCount = 0;
    const model: PlanningModel = {
      async generatePlan(): Promise<string> {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            goal: "test",
            delegations: [
              { id: "a", title: "A", role: "Developer", task: "A", dependsOn: ["b"] },
              { id: "b", title: "B", role: "Developer", task: "B", dependsOn: ["a"] },
            ],
          });
        }
        return validPlanJson();
      },
    };

    const planner = createMissionPlanner(model);
    const mission = createMission("Build a puzzle game");
    const plan = await planner.createPlan(mission);

    expect(callCount).toBe(2);
  });

  it("falls back to deterministic planner after max retries", async () => {
    const model = createMockModel(new Error("LLM unavailable"));
    const planner = createMissionPlanner(model, { maxPlanRetries: 2 });
    const mission = createMission("Build a puzzle game");

    const plan = await planner.createPlan(mission);
    // Deterministic planner should produce a plan
    expect(plan.delegations.length).toBeGreaterThan(0);
  });

  it("handles markdown code fences in LLM output", async () => {
    const model = createMockModel("```json\n" + validPlanJson() + "\n```");
    const planner = createMissionPlanner(model);
    const mission = createMission("Build a puzzle game");

    const plan = await planner.createPlan(mission);
    expect(plan.delegations).toHaveLength(2);
  });

  it("handles LLM output with surrounding text", async () => {
    const model = createMockModel("Here is the plan:\n" + validPlanJson() + "\nDone.");
    const planner = createMissionPlanner(model);
    const mission = createMission("Build a puzzle game");

    const plan = await planner.createPlan(mission);
    expect(plan.delegations).toHaveLength(2);
  });

  it("rejects unknown role in delegation", async () => {
    const badPlan = JSON.stringify({
      goal: "test",
      delegations: [
        { id: "a", title: "A", role: "Hacker", task: "Do something" },
      ],
    });
    const model = createMockModel(badPlan);
    const planner = createMissionPlanner(model, { maxPlanRetries: 1 });
    const mission = createMission("Build a puzzle game");

    // Should fall back to deterministic planner
    const plan = await planner.createPlan(mission);
    expect(plan.delegations.length).toBeGreaterThan(0);
  });

  it("rejects duplicate delegation IDs", async () => {
    const badPlan = JSON.stringify({
      goal: "test",
      delegations: [
        { id: "same", title: "A", role: "Developer", task: "A" },
        { id: "same", title: "B", role: "Developer", task: "B" },
      ],
    });
    const model = createMockModel(badPlan);
    const planner = createMissionPlanner(model, { maxPlanRetries: 1 });
    const mission = createMission("Build a puzzle game");

    const plan = await planner.createPlan(mission);
    expect(plan.delegations.length).toBeGreaterThan(0);
  });
});
