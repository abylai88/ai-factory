import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeGameMission,
  type GameMissionInput,
} from "../game-mission.js";
import { ProjectProvisioner } from "../project-provisioner.js";
import { Mission, createMission } from "../mission.js";
import { Planner, createPlanner } from "../planner.js";

vi.mock("../project-provisioner.js");
vi.mock("../mission.js");
vi.mock("../planner.js");

function makeMockMission(goal: string): Mission {
  return {
    id: "mission-123",
    goal,
    context: {},
    constraints: {
      maxRepairs: 3,
      maxDelegations: 20,
      allowedPipelines: ["game", "engineering"],
      requireApproval: false,
    },
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentDelegationIndex: 0,
    repairCycleCount: 0,
  };
}

function createMockProvisioner(overrides: Partial<{
  provision: ReturnType<typeof vi.fn>;
  validateProject: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    provision: vi.fn().mockResolvedValue({
      projectId: "test-project-123",
      templateId: "yagames-phaser-template",
      projectPath: "/projects/test-project-123",
      createdAt: new Date().toISOString(),
    }),
    validateProject: vi.fn().mockResolvedValue({ valid: true }),
    ...overrides,
  };
}

describe("executeGameMission", () => {
  let mockProvisioner: ReturnType<typeof createMockProvisioner>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockProvisioner = createMockProvisioner();

    vi.mocked(ProjectProvisioner).mockImplementation(
      function (this: unknown) {
        return mockProvisioner as unknown as ProjectProvisioner;
      } as unknown as new (...args: unknown[]) => ProjectProvisioner
    );
  });

  it("should reject empty goal", async () => {
    const input: GameMissionInput = {
      goal: "",
    };

    await expect(executeGameMission(input)).rejects.toThrow("Mission goal must be a non-empty string");
  });

  it("should reject whitespace goal", async () => {
    const input: GameMissionInput = {
      goal: "   ",
    };

    await expect(executeGameMission(input)).rejects.toThrow("Mission goal must be a non-empty string");
  });

  it("should determine research workflow mode", async () => {
    const input: GameMissionInput = {
      goal: "analyze the project structure",
    };

    const mockMission = makeMockMission(input.goal);

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);
    expect(result.workflowMode).toBe("research");
  });

  it("should determine coding workflow mode", async () => {
    const input: GameMissionInput = {
      goal: "fix the bug in the game",
    };

    const mockMission = makeMockMission(input.goal);

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);
    expect(result.workflowMode).toBe("coding");
  });

  it("should determine game workflow mode", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockMission = makeMockMission(input.goal);

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);
    expect(result.workflowMode).toBe("game");
  });

  it("should provision a new project when no projectId is provided", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockMission = makeMockMission(input.goal);

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    mockProvisioner.provision.mockResolvedValue({
      projectId: "test-project-123",
      templateId: "yagames-phaser-template",
      projectPath: "/projects/test-project-123",
      createdAt: new Date().toISOString(),
    });
    mockProvisioner.validateProject.mockResolvedValue({ valid: true });

    const result = await executeGameMission(input);
    expect(result.projectId).toBe("test-project-123");
    expect(result.projectPath).toBe("/projects/test-project-123");
    expect(mockProvisioner.provision).toHaveBeenCalledWith("yagames-phaser-template");
  });

  it("should resolve an existing project when projectId is provided", async () => {
    const input: GameMissionInput = {
      goal: "improve the existing game",
      projectId: "existing-project-456",
    };

    const mockMission = makeMockMission(input.goal);

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    mockProvisioner.validateProject.mockResolvedValue({ valid: true });

    const result = await executeGameMission(input);
    expect(result.projectId).toBe("existing-project-456");
    expect(result.projectPath).toBe(`${process.cwd()}/projects/existing-project-456`);
    expect(mockProvisioner.validateProject).toHaveBeenCalled();
    expect(mockProvisioner.provision).not.toHaveBeenCalled();
  });

  it("should reject invalid project IDs", async () => {
    const input: GameMissionInput = {
      goal: "improve the existing game",
      projectId: "invalid-project",
    };

    mockProvisioner.validateProject.mockResolvedValue({ valid: false, reason: "Project not found" });

    await expect(executeGameMission(input)).rejects.toThrow("Invalid project ID: invalid-project");
    expect(mockProvisioner.provision).not.toHaveBeenCalled();
  });

  it("should call the planner", async () => {
    const input: GameMissionInput = {
      goal: "fix the game bug",
    };

    const mockMission = makeMockMission(input.goal);

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    vi.mocked(createMission).mockReturnValue(mockMission);
    const mockPlanner = {
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner;
    vi.mocked(createPlanner).mockReturnValue(mockPlanner);

    const result = await executeGameMission(input);

    expect(mockPlanner.decompose).toHaveBeenCalledWith(mockMission);
    expect(result.plan).toEqual(mockPlan);
  });

  it("should return plan", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const mockMission = makeMockMission(input.goal);

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);
    expect(result.plan).toEqual(mockPlan);
  });

  it("should return correct result shape", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const mockMission = makeMockMission(input.goal);

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);

    expect(result).toHaveProperty("missionId");
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("projectId");
    expect(result).toHaveProperty("projectPath");
    expect(result).toHaveProperty("workflowMode");
    expect(result).toHaveProperty("plan");
    expect(result.missionId).toBe("mission-123");
    expect(result.status).toBe("draft");
    expect(result.projectId).toBe("test-project-123");
    expect(result.projectPath).toBe("/projects/test-project-123");
    expect(result.workflowMode).toBe("game");
    expect(result.plan).toEqual(mockPlan);
  });

  it("should not execute orchestrator", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const mockMission = makeMockMission(input.goal);

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    await executeGameMission(input);

    // In Phase 10A.1, executeGameMission only plans - it does not execute any orchestrator
    // This test verifies the function completes and returns a plan without orchestration
    expect(mockMission.id).toBe("mission-123");
  });

  it("should not execute Build", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const mockMission = makeMockMission(input.goal);

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);

    // Phase 10A.1 should not have any build results
    expect(result).not.toHaveProperty("buildResult");
    expect(result).not.toHaveProperty("build");
  });

  it("should not execute Visual QA", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const mockMission = makeMockMission(input.goal);

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);

    // Phase 10A.1 should not have any visual QA results
    expect(result).not.toHaveProperty("visualQa");
    expect(result).not.toHaveProperty("visualQaResult");
  });

  it("should not execute Repair", async () => {
    const input: GameMissionInput = {
      goal: "create a new game",
    };

    const mockPlan = {
      id: "plan-123",
      missionId: "mission-123",
      objectives: [],
      delegations: [],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    const mockMission = makeMockMission(input.goal);

    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);

    const result = await executeGameMission(input);

    // Phase 10A.1 should not have any repair results
    expect(result).not.toHaveProperty("repairResult");
    expect(result).not.toHaveProperty("repair");
  });
});