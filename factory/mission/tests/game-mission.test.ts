import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeGameMission,
  type GameMissionInput,
} from "../game-mission.js";
import { ProjectProvisioner } from "../project-provisioner.js";
import { Mission, createMission } from "../mission.js";
import { Planner, createPlanner } from "../planner.js";
import { MissionOrchestrator, RealFactoryAdapter } from "../orchestrator.js";
import { MissionState } from "../state.js";
import { CodingMissionAuditor } from "../adapters.js";
import { PlaywrightVisualQaAdapter } from "../playwright-visual-qa-adapter.js";
import { DeterministicRepairExecutor } from "../repair-executor.js";
import { MissionProjectManager, MissionAwareFactoryAdapter } from "../mission-project-manager.js";

vi.mock("../project-provisioner.js");
vi.mock("../mission.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mission.js")>();
  return { ...actual, createMission: vi.fn() };
});
vi.mock("../planner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../planner.js")>();
  return { ...actual, createPlanner: vi.fn() };
});
vi.mock("../orchestrator.js");
vi.mock("../state.js");
vi.mock("../adapters.js");
vi.mock("../playwright-visual-qa-adapter.js");
vi.mock("../repair-executor.js");
vi.mock("../mission-project-manager.js");

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

function makeMockPlan(missionId: string) {
  return {
    id: "plan-123",
    missionId,
    objectives: [],
    delegations: [],
    risks: [],
    validationGates: [],
    createdAt: new Date().toISOString(),
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

let mockOrchestratorInstance: {
  executeMission: ReturnType<typeof vi.fn>;
  getCurrentMission: ReturnType<typeof vi.fn>;
  getCurrentPlan: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

let mockStateInstance: {
  init: ReturnType<typeof vi.fn>;
  setMission: ReturnType<typeof vi.fn>;
  setPlan: ReturnType<typeof vi.fn>;
  addDelegation: ReturnType<typeof vi.fn>;
  getMission: ReturnType<typeof vi.fn>;
  getPlan: ReturnType<typeof vi.fn>;
  getDelegations: ReturnType<typeof vi.fn>;
  getDelegation: ReturnType<typeof vi.fn>;
  getAuditResult: ReturnType<typeof vi.fn>;
  getVisualQaResult: ReturnType<typeof vi.fn>;
  getRepairCycleCount: ReturnType<typeof vi.fn>;
};

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

    mockOrchestratorInstance = {
      executeMission: vi.fn(),
      getCurrentMission: vi.fn(),
      getCurrentPlan: vi.fn(),
      stop: vi.fn(),
    };
    vi.mocked(MissionOrchestrator).mockImplementation(
      function (this: unknown) {
        return mockOrchestratorInstance as unknown as InstanceType<typeof MissionOrchestrator>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof MissionOrchestrator>
    );

    mockStateInstance = {
      init: vi.fn().mockResolvedValue(undefined),
      setMission: vi.fn().mockResolvedValue(undefined),
      setPlan: vi.fn().mockResolvedValue(undefined),
      addDelegation: vi.fn().mockResolvedValue(undefined),
      getMission: vi.fn().mockReturnValue(makeMockMission("test")),
      getPlan: vi.fn().mockReturnValue(null),
      getDelegations: vi.fn().mockReturnValue([]),
      getDelegation: vi.fn().mockReturnValue(undefined),
      getAuditResult: vi.fn().mockReturnValue(undefined),
      getVisualQaResult: vi.fn().mockReturnValue(undefined),
      getRepairCycleCount: vi.fn().mockReturnValue(0),
    };
    vi.mocked(MissionState).mockImplementation(
      function (this: unknown) {
        return mockStateInstance as unknown as InstanceType<typeof MissionState>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof MissionState>
    );

    vi.mocked(RealFactoryAdapter).mockImplementation(
      function (this: unknown) {
        return { runDelegation: vi.fn() } as unknown as InstanceType<typeof RealFactoryAdapter>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof RealFactoryAdapter>
    );

    vi.mocked(MissionProjectManager).mockImplementation(
      function (this: unknown) {
        return {
          resolveProject: vi.fn().mockResolvedValue({
            projectId: "test-project-123",
            projectPath: "/projects/test-project-123",
            templateId: "yagames-phaser-template",
            isNew: false,
          }),
        } as unknown as InstanceType<typeof MissionProjectManager>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof MissionProjectManager>
    );

    vi.mocked(MissionAwareFactoryAdapter).mockImplementation(
      function (this: unknown) {
        return { runDelegation: vi.fn() } as unknown as InstanceType<typeof MissionAwareFactoryAdapter>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof MissionAwareFactoryAdapter>
    );

    vi.mocked(PlaywrightVisualQaAdapter).mockImplementation(
      function (this: unknown) {
        return {
          init: vi.fn().mockResolvedValue(undefined),
          run: vi.fn().mockResolvedValue({
            status: "passed",
            passed: true,
            checks: 0,
            failedChecks: 0,
            errors: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
          }),
        } as unknown as InstanceType<typeof PlaywrightVisualQaAdapter>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof PlaywrightVisualQaAdapter>
    );

    vi.mocked(DeterministicRepairExecutor).mockImplementation(
      function (this: unknown) {
        return { execute: vi.fn() } as unknown as InstanceType<typeof DeterministicRepairExecutor>;
      } as unknown as new (...args: unknown[]) => InstanceType<typeof DeterministicRepairExecutor>
    );
  });

  it("should reject empty goal", async () => {
    const input: GameMissionInput = { goal: "" };
    await expect(executeGameMission(input)).rejects.toThrow("Mission goal must be a non-empty string");
  });

  it("should reject whitespace goal", async () => {
    const input: GameMissionInput = { goal: "   " };
    await expect(executeGameMission(input)).rejects.toThrow("Mission goal must be a non-empty string");
  });

  it("should determine research workflow mode", async () => {
    const input: GameMissionInput = { goal: "analyze the project structure" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result.workflowMode).toBe("research");
  });

  it("should determine coding workflow mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug in the game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result.workflowMode).toBe("coding");
  });

  it("should determine game workflow mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result.workflowMode).toBe("game");
  });

  it("should provision a new project when no projectId is provided", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result.projectId).toBe("test-project-123");
    expect(result.projectPath).toBe("/projects/test-project-123");
    expect(mockProvisioner.provision).toHaveBeenCalledWith("yagames-phaser-template");
  });

  it("should resolve an existing project when projectId is provided", async () => {
    const input: GameMissionInput = { goal: "improve the existing game", projectId: "existing-project-456" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result.projectId).toBe("existing-project-456");
    expect(result.projectPath).toBe(`${process.cwd()}/projects/existing-project-456`);
    expect(mockProvisioner.validateProject).toHaveBeenCalled();
    expect(mockProvisioner.provision).not.toHaveBeenCalled();
  });

  it("should reject invalid project IDs", async () => {
    const input: GameMissionInput = { goal: "improve the existing game", projectId: "invalid-project" };
    mockProvisioner.validateProject.mockResolvedValue({ valid: false, reason: "Project not found" });
    await expect(executeGameMission(input)).rejects.toThrow("Invalid project ID: invalid-project");
    expect(mockProvisioner.provision).not.toHaveBeenCalled();
  });

  it("should call the planner", async () => {
    const input: GameMissionInput = { goal: "fix the game bug" };
    const mockMission = makeMockMission(input.goal);
    const mockPlan = makeMockPlan("mission-123");
    vi.mocked(createMission).mockReturnValue(mockMission);
    const mockPlanner = { decompose: vi.fn().mockReturnValue(mockPlan) } as unknown as Planner;
    vi.mocked(createPlanner).mockReturnValue(mockPlanner);
    const result = await executeGameMission(input);
    expect(mockPlanner.decompose).toHaveBeenCalledWith(mockMission);
    expect(result.plan).toEqual(mockPlan);
  });

  it("should return plan", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockPlan = makeMockPlan("mission-123");
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result.plan).toEqual(mockPlan);
  });

  it("should return correct result shape for research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockPlan = makeMockPlan("mission-123");
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
    expect(result.workflowMode).toBe("research");
    expect(result.plan).toEqual(mockPlan);
  });

  it("should not execute orchestrator for research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockPlan = makeMockPlan("mission-123");
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    await executeGameMission(input);
    expect(MissionOrchestrator).not.toHaveBeenCalled();
  });

  it("should not execute Build for research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockPlan = makeMockPlan("mission-123");
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result).not.toHaveProperty("build");
  });

  it("should not execute Visual QA for research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockPlan = makeMockPlan("mission-123");
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result).not.toHaveProperty("visualQa");
  });

  it("should not execute Repair for research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockPlan = makeMockPlan("mission-123");
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    const result = await executeGameMission(input);
    expect(result).not.toHaveProperty("repairCycles");
  });

  it("should execute orchestrator for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionOrchestrator).toHaveBeenCalled();
    expect(mockOrchestratorInstance.executeMission).toHaveBeenCalled();
  });

  it("should execute orchestrator for game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionOrchestrator).toHaveBeenCalled();
    expect(mockOrchestratorInstance.executeMission).toHaveBeenCalled();
  });

  it("should initialize MissionState for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionState).toHaveBeenCalled();
    expect(mockStateInstance.init).toHaveBeenCalled();
  });

  it("should initialize MissionState for game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionState).toHaveBeenCalled();
    expect(mockStateInstance.init).toHaveBeenCalled();
  });

  it("should persist Mission for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(mockStateInstance.setMission).toHaveBeenCalledWith(mockMission);
  });

  it("should persist Plan for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    const mockPlan = makeMockPlan("mission-123");
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(mockStateInstance.setPlan).toHaveBeenCalledWith(mockPlan);
  });

  it("should persist delegations for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    const mockDelegation = { id: "del-1", title: "step 1", description: "do something" };
    const mockPlan = { ...makeMockPlan("mission-123"), delegations: [mockDelegation] };
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(mockStateInstance.addDelegation).toHaveBeenCalledWith(mockDelegation);
  });

  it("should propagate final mission status for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const completedMission = { ...mockMission, status: "completed" as const };
    mockOrchestratorInstance.executeMission.mockResolvedValue(completedMission);
    mockStateInstance.getMission.mockReturnValue(completedMission);
    const result = await executeGameMission(input);
    expect(result.status).toBe("completed");
  });

  it("should propagate actual plan for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    const mockPlan = makeMockPlan("mission-123");
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(mockPlan),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    const result = await executeGameMission(input);
    expect(result.plan).toEqual(mockPlan);
  });

  it("should propagate build result when available in coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    mockStateInstance.getDelegations.mockReturnValue([
      {
        id: "del-1",
        description: "ROLE: builder\nBUILD_COMMAND: npm run build",
        status: "passed",
        result: "Build output",
      },
    ]);
    const result = await executeGameMission(input);
    expect(result.build).toBeDefined();
    expect(result.build?.status).toBe("passed");
  });

  it("should propagate audit result in game mode when available", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    const mockAuditResult = {
      delegationId: "del-last",
      status: "PASS" as const,
      summary: "All criteria passed",
      findings: [],
      acceptanceCriteriaResults: [],
    };
    mockStateInstance.getDelegations.mockReturnValue([
      { id: "del-last", description: "final step" },
    ]);
    mockStateInstance.getAuditResult.mockReturnValue(mockAuditResult);
    const result = await executeGameMission(input);
    expect(result.audit).toEqual(mockAuditResult);
  });

  it("should propagate repair cycle count in game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    mockStateInstance.getRepairCycleCount.mockReturnValue(2);
    const result = await executeGameMission(input);
    expect(result.repairCycles).toBe(2);
  });

  it("should propagate delegations in coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    const mockDelegations = [{ id: "del-1", title: "step 1", description: "do something" }];
    mockStateInstance.getDelegations.mockReturnValue(mockDelegations);
    const result = await executeGameMission(input);
    expect(result.delegations).toEqual(mockDelegations);
  });

  it("should not return placeholder values", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    const result = await executeGameMission(input);
    const json = JSON.stringify(result);
    expect(json).not.toContain("Build results would be here");
    expect(json).not.toContain("Audit results would be here");
    expect(json).not.toContain("placeholder");
  });

  it("should not trigger Build/QA/Repair in research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    await executeGameMission(input);
    expect(MissionOrchestrator).not.toHaveBeenCalled();
    expect(PlaywrightVisualQaAdapter).not.toHaveBeenCalled();
    expect(DeterministicRepairExecutor).not.toHaveBeenCalled();
  });

  it("should propagate execution failures", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const failedMission = { ...mockMission, status: "failed" as const };
    mockOrchestratorInstance.executeMission.mockResolvedValue(failedMission);
    mockStateInstance.getMission.mockReturnValue(failedMission);
    const result = await executeGameMission(input);
    expect(result.status).toBe("failed");
  });

  it("should keep orchestrator as the only execution authority for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockOrchestratorInstance.executeMission).toHaveBeenCalledTimes(1);
  });

  it("should keep orchestrator as the only execution authority for game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockOrchestratorInstance.executeMission).toHaveBeenCalledTimes(1);
  });

  it("should return result from orchestrator in coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const completedMission = { ...mockMission, status: "completed" as const };
    mockOrchestratorInstance.executeMission.mockResolvedValue(completedMission);
    mockStateInstance.getMission.mockReturnValue(completedMission);
    const result = await executeGameMission(input);
    expect(result.result).toEqual(completedMission);
  });

  it("should return result from orchestrator in game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    const completedMission = { ...mockMission, status: "completed" as const };
    mockOrchestratorInstance.executeMission.mockResolvedValue(completedMission);
    mockStateInstance.getMission.mockReturnValue(completedMission);
    const result = await executeGameMission(input);
    expect(result.result).toEqual(completedMission);
  });

  it("should not initialize MissionState for research mode", async () => {
    const input: GameMissionInput = { goal: "analyze the codebase" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    await executeGameMission(input);
    expect(MissionState).not.toHaveBeenCalled();
  });

  it("should use MissionAwareFactoryAdapter for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionAwareFactoryAdapter).toHaveBeenCalled();
    expect(RealFactoryAdapter).toHaveBeenCalled();
  });

  it("should use MissionAwareFactoryAdapter for game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionAwareFactoryAdapter).toHaveBeenCalled();
    expect(RealFactoryAdapter).toHaveBeenCalled();
  });

  it("should construct MissionProjectManager for coding mode", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionProjectManager).toHaveBeenCalled();
  });

  it("should construct MissionProjectManager for game mode", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    expect(MissionProjectManager).toHaveBeenCalled();
  });

  it("should wire visualQaAdapter in game mode orchestrator config", async () => {
    const input: GameMissionInput = { goal: "create a new game" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    const config = vi.mocked(MissionOrchestrator).mock.calls[0][0];
    expect(config.visualQaAdapter).toBeDefined();
    expect(config.repairExecutor).toBeDefined();
  });

  it("should not wire visualQaAdapter in coding mode orchestrator config", async () => {
    const input: GameMissionInput = { goal: "fix the bug" };
    const mockMission = makeMockMission(input.goal);
    vi.mocked(createMission).mockReturnValue(mockMission);
    vi.mocked(createPlanner).mockReturnValue({
      decompose: vi.fn().mockReturnValue(makeMockPlan("mission-123")),
    } as unknown as Planner);
    mockOrchestratorInstance.executeMission.mockResolvedValue({ ...mockMission, status: "completed" });
    mockStateInstance.getMission.mockReturnValue({ ...mockMission, status: "completed" });
    await executeGameMission(input);
    const config = vi.mocked(MissionOrchestrator).mock.calls[0][0];
    expect(config.visualQaAdapter).toBeUndefined();
    expect(config.repairExecutor).toBeUndefined();
  });
});
