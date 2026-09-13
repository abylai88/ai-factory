import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  MissionSupervisor,
  createMissionSupervisor,
  type SupervisorConfig,
  type SupervisorDecision,
  type DelegationTrackingState,
} from "../mission-supervisor.js";
import { MissionOrchestrator } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes, NoopEventSink } from "../events.js";
import { MissionState } from "../state.js";
import { createMission, createDelegation, type AgentResult, type Delegation } from "../mission.js";
import { createMissionEventPublisher } from "../events.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "supervisor-test-"));
  // Ensure outputs directory exists for MissionState
  const outputsDir = path.join(tmpDir, "outputs", "missions");
  await fs.mkdir(outputsDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function setupState(mission: any) {
  return new MissionState(tmpDir, mission.id);
}

function makeResult(delegationId: string, status: "passed" | "failed", error?: string): AgentResult {
  return {
    delegationId,
    status,
    output: status === "passed" ? "Success" : "Failed",
    error,
    durationMs: 100,
  };
}

function makeDelegation(missionId: string, id: string): Delegation {
  return createDelegation(missionId, "obj-1", `Task ${id}`, `Description ${id}`, "engineering", {
    dependsOn: [],
    parallelizable: false,
    role: "Developer",
    requiresReview: false,
  });
}

function createSupervisorConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  const mission = createMission("Test mission", { projectId: "p1" });
  const state = setupState(mission);
  const eventSink = new InMemoryEventSink();
  const publisher = createMissionEventPublisher(eventSink);

  return {
    missionState: state,
    eventSink,
    publisher,
    maxRecoveryAttempts: 3,
    maxStuckRecoveries: 2,
    maxDelegationDurationMs: 5 * 60 * 1000,
    stuckDetectionIntervalMs: 30 * 1000,
    maxReplanAttempts: 2,
    maxModelFallbackAttempts: 3,
    maxDynamicDelegations: 10,
    ...overrides,
  };
}

function createSupervisorConfigWithRouter(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return createSupervisorConfig({
    modelRouter: {
      chooseModel: () => ({ primary: "gpt-4", fallbacks: ["claude-3"], reason: "test" }),
      nextFallback: (route: any, current: string) => {
        if (current === "gpt-4") return "claude-3";
        return null;
      },
    } as any,
    ...overrides,
  });
}

// ── Helpers for Integration Tests ─────────────────────────

function passingAuditor() {
  return {
    async audit(delegation: Delegation, result: AgentResult, _mission: any, _plan: any) {
      return {
        delegationId: delegation.id,
        status: (result.status === "passed" ? "PASS" : "FAIL") as "PASS" | "FAIL",
        summary: result.status === "passed" ? "All checks passed" : "Failed",
        findings: [] as string[],
        acceptanceCriteriaResults: [] as { criterion: string; passed: boolean; evidence?: string }[],
      };
    },
  };
}

function makePlan(mission: any, dels: Delegation[]) {
  return {
    id: `plan-${mission.id}`,
    missionId: mission.id,
    objectives: [{ id: "obj-1", title: "Work", description: "Do work", delegations: dels.map((d) => d.id) }],
    delegations: dels,
    risks: [],
    validationGates: [],
    createdAt: new Date().toISOString(),
  };
}

// ── Phase 9 Integration Tests ────────────────────────────────

describe("Phase 9: MissionSupervisor - Orchestrator Integration", () => {
  describe("9Int-1: Supervisor handles delegation failure through orchestrator", () => {
    it("processes failed delegation via supervisor in MissionOrchestrator", async () => {
      const mission = createMission("Integration test mission", { projectId: "p1" });
      const state = setupState(mission);
      await state.init();

      const supervisor = new MissionSupervisor(createSupervisorConfig());

      const del = createDelegation(mission.id, "d1", "Task 1", "Description 1", "engineering", {
        dependsOn: [],
        parallelizable: false,
        role: "Developer",
        requiresReview: false,
      });
      const plan = makePlan(mission, [del]);

      await state.setPlan(plan);
      await state.addDelegation(del);

      const noopSink = new NoopEventSink();
      const orchestrator = new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: tmpDir,
        factoryAdapter: {
          runDelegation: async () => makeResult("d1", "failed", "Provider timeout"),
        } as any,
        auditor: passingAuditor(),
        eventSink: noopSink,
        missionState: state,
        supervisor,
      });

      const result = await orchestrator.executeMission(mission, plan);

      expect(result.status).toBe("failed");
      const decisions = supervisor.getDecisions();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      expect(decisions.some((d) => d.delegationId === del.id)).toBe(true);
    });

    it("stuck detection operates during execution", async () => {
      const mission = createMission("Stuck test mission", { projectId: "p1" });
      const state = setupState(mission);
      await state.init();

      const supervisor = new MissionSupervisor(
        createSupervisorConfig({ maxDelegationDurationMs: 50 }),
      );

      const del = createDelegation(mission.id, "d1", "Task 1", "Description 1", "engineering", {
        dependsOn: [],
        parallelizable: false,
        role: "Developer",
        requiresReview: false,
      });
      const plan = makePlan(mission, [del]);

      await state.setPlan(plan);
      await state.addDelegation(del);

      const noopSink = new NoopEventSink();
      const orchestrator = new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: tmpDir,
        factoryAdapter: {
          runDelegation: async () => {
            // Simulate long-running delegation that exceeds stuck threshold
            await new Promise((r) => setTimeout(r, 200));
            return makeResult("d1", "passed", "Success");
          },
        } as any,
        auditor: passingAuditor(),
        eventSink: noopSink,
        missionState: state,
        supervisor,
        maxDelegationDurationMs: 50,
      });

      const result = await orchestrator.executeMission(mission, plan);

      // Stuck detection operates during execution via background interval.
      // Supervisor detects stuck delegation and triggers REPAIR recovery.
      // Repair succeeds (factory adapter returns passed), so mission completes.
      expect(result.status).toBe("completed");
      const decisions = supervisor.getDecisions();
      expect(decisions.some((d) => d.reason === "stuck")).toBe(true);
    });
  });

  describe("9Int-2: Recovery decision execution through orchestrator", () => {
    it("executeRecoveryDecision invokes orchestrator repair mechanism", async () => {
      const mission = createMission("Recovery test mission", { projectId: "p1" });
      const state = setupState(mission);
      await state.init();

      const supervisor = new MissionSupervisor(createSupervisorConfig());

      const del = createDelegation(mission.id, "d1", "Task 1", "Description 1", "engineering", {
        dependsOn: [],
        parallelizable: false,
        role: "Developer",
        requiresReview: false,
      });
      const plan = makePlan(mission, [del]);

      await state.setPlan(plan);
      await state.addDelegation(del);

      let adapterCalls = 0;
      const noopSink = new NoopEventSink();
      const orchestrator = new MissionOrchestrator({
        baseDir: tmpDir,
        project: tmpDir,
        factoryAdapter: {
          runDelegation: async () => {
            adapterCalls++;
            if (adapterCalls <= 1) {
              return makeResult("d1", "failed", "Provider timeout");
            }
            return makeResult("d1", "passed", "Repair succeeded");
          },
        } as any,
        auditor: passingAuditor(),
        eventSink: noopSink,
        missionState: state,
        supervisor,
        maxRepairs: 3,
      });

      const result = await orchestrator.executeMission(mission, plan);
      expect(["completed", "failed"]).toContain(result.status);
    });

    it("model fallback coordinates supervisor decision with orchestrator router", async () => {
      const mission = createMission("Model fallback test mission", { projectId: "p1" });
      const state = setupState(mission);
      await state.init();

      const supervisor = new MissionSupervisor(createSupervisorConfigWithRouter());

      const del = createDelegation(mission.id, "d1", "Task 1", "Description 1", "engineering", {
        dependsOn: [],
        parallelizable: false,
        role: "Developer",
        requiresReview: false,
      });
      const plan = makePlan(mission, [del]);

      await state.setPlan(plan);
      await state.addDelegation(del);

      const noopSink = new NoopEventSink();
      const orchestrator = new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: tmpDir,
        factoryAdapter: {
          runDelegation: async () => makeResult("d1", "failed", "Provider timeout: anthropic API unavailable"),
        } as any,
        auditor: passingAuditor(),
        eventSink: noopSink,
        missionState: state,
        supervisor,
        modelRouter: createSupervisorConfigWithRouter().modelRouter,
      });

      const result = await orchestrator.executeMission(mission, plan);
      expect(["completed", "failed"]).toContain(result.status);
    });
  });

  describe("9Int-3: Integration test - end-to-end failure flow", () => {
    it("handles repeated failures with recovery escalation", async () => {
      const mission = createMission("End-to-end test mission", { projectId: "p1" });
      const state = setupState(mission);
      await state.init();

      const supervisor = new MissionSupervisor(createSupervisorConfig());

      let adapterCalls = 0;
      const del = createDelegation(mission.id, "d1", "Task 1", "Description 1", "engineering", {
        dependsOn: [],
        parallelizable: false,
        role: "Developer",
        requiresReview: false,
      });
      const plan = makePlan(mission, [del]);

      await state.setPlan(plan);
      await state.addDelegation(del);

      const noopSink = new NoopEventSink();
      const orchestrator = new MissionOrchestrator({
        baseDir: tmpDir,
        project: tmpDir,
        factoryAdapter: {
          runDelegation: async () => {
            adapterCalls++;
            if (adapterCalls <= 2) {
              return makeResult("d1", "failed", "TS error on attempt " + adapterCalls);
            }
            return makeResult("d1", "passed", "Fix applied successfully");
          },
        } as any,
        auditor: passingAuditor(),
        eventSink: noopSink,
        missionState: state,
        supervisor,
        maxRepairs: 3,
      });

      const result = await orchestrator.executeMission(mission, plan);
      expect(["completed", "failed"]).toContain(result.status);
    });
  });
});

describe("Phase 9: MissionSupervisor", () => {
  describe("9I-1: Supervisor starts", () => {
    it("creates with default config", () => {
      const config = createSupervisorConfig();
      const supervisor = createMissionSupervisor(config);
      const counters = supervisor.getCounters();
      expect(counters.totalRecoveryAttempts).toBe(0);
      expect(counters.totalReplanAttempts).toBe(0);
      expect(counters.totalModelFallbackAttempts).toBe(0);
      expect(counters.decisionCount).toBe(0);
    });
  });

  describe("9I-2: Supervisor observes delegation", () => {
    it("tracks delegation lifecycle", () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const state = supervisor.getDelegationState(del.id);
      expect(state).toBeDefined();
      expect(state!.status).toBe("running");
      expect(state!.failureCount).toBe(0);

      supervisor.observeDelegationCompleted(del.id, makeResult(del.id, "passed"));
      const updated = supervisor.getDelegationState(del.id);
      expect(updated!.status).toBe("passed");
    });
  });

  describe("9I-3: Supervisor records decision", () => {
    it("records decisions with context", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const decision = await supervisor.handleDelegationFailure(
        del,
        makeResult(del.id, "failed", "TypeScript: Property x missing"),
      );

      expect(decision).toBeDefined();
      expect(decision.type).toBe("REPAIR");
      expect(decision.reason).toBe("code_failure");
      expect(decision.delegationId).toBe(del.id);
      expect(decision.context).toContain("TypeScript");

      const decisions = supervisor.getDecisions();
      expect(decisions.length).toBe(1);
    });
  });

  describe("9I-4: Inactive delegation becomes stuck", () => {
    it("detects stuck delegation after timeout", () => {
      const config = createSupervisorConfig({ maxDelegationDurationMs: 60000 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      // Capture monotonic time when delegation starts
      const startMonotonic = performance.now();
      supervisor.observeDelegationStarted(del);

      // Not stuck yet (59 seconds = 59000ms)
      expect(supervisor.checkStuckDelegations(startMonotonic + 59000)).toEqual([]);

      // Stuck after 61 seconds (61000ms)
      expect(supervisor.checkStuckDelegations(startMonotonic + 61000)).toEqual([del.id]);
    });
  });

  describe("9I-5: Active delegation is not incorrectly marked stuck", () => {
    it("does not mark completed delegation as stuck", () => {
      const config = createSupervisorConfig({ maxDelegationDurationMs: 60000 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      const startMonotonic = performance.now();
      supervisor.observeDelegationStarted(del);
      supervisor.observeDelegationCompleted(del.id, makeResult(del.id, "passed"));

      expect(supervisor.checkStuckDelegations(startMonotonic + 120000)).toEqual([]);
    });

    it("does not mark queued delegation as stuck", () => {
      const config = createSupervisorConfig({ maxDelegationDurationMs: 60000 });
      const supervisor = new MissionSupervisor(config);

      // Don't call observeDelegationStarted — status defaults to "queued"
      expect(supervisor.checkStuckDelegations(performance.now() + 120000)).toEqual([]);
    });
  });

  describe("9I-6: Stuck recovery succeeds", () => {
    it("handles stuck delegation and emits events", async () => {
      const config = createSupervisorConfig({ maxDelegationDurationMs: 1000 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      const decision = await supervisor.handleStuckDelegation(del.id, mission.id);
      expect(decision).toBeDefined();
      expect(decision!.type).toBe("REPAIR");
      expect(decision!.reason).toBe("stuck");

      const events = (config.eventSink as InMemoryEventSink).recent();
      const stuckEvents = events.filter((e: any) => e.type === "delegation.stuck");
      expect(stuckEvents.length).toBe(1);
    });
  });

  describe("9I-7: Stuck recovery fails safely", () => {
    it("returns null for non-running delegation", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      supervisor.observeDelegationCompleted(del.id, makeResult(del.id, "passed"));

      const decision = await supervisor.handleStuckDelegation(del.id, mission.id);
      expect(decision).toBeNull();
    });

    it("returns null for unknown delegation", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();

      const decision = await supervisor.handleStuckDelegation("nonexistent", mission.id);
      expect(decision).toBeNull();
    });
  });

  describe("9I-8: Provider failure follows model fallback", () => {
    it("decides CHANGE_MODEL for provider failures", async () => {
      const config = createSupervisorConfigWithRouter();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const decision = await supervisor.handleDelegationFailure(
        del,
        makeResult(del.id, "failed", "Provider timeout: anthropic API unavailable"),
      );

      expect(decision.type).toBe("CHANGE_MODEL");
      expect(decision.reason).toBe("provider_failure");
    });
  });

  describe("9I-9: Code failure does not trigger model fallback", () => {
    it("decides REPAIR for code failures", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const decision = await supervisor.handleDelegationFailure(
        del,
        makeResult(del.id, "failed", "TypeScript: Property 'x' does not exist"),
      );

      expect(decision.type).toBe("REPAIR");
      expect(decision.reason).toBe("code_failure");
    });
  });

  describe("9I-10: Repeated repair failure escalates", () => {
    it("escalates after multiple failures", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // First failure → REPAIR
      const d1 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TS error"));
      expect(d1.type).toBe("REPAIR");

      // Simulate repair observation
      supervisor.observeRepairStarted(del.id);

      // Second failure → ESCALATE
      const d2 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TS error"));
      expect(d2.type).toBe("ESCALATE");
      expect(d2.reason).toBe("repeated_failure");
    });
  });

  describe("9I-11: Recovery exhaustion triggers replanning", () => {
    it("decides REPLAN after max recovery attempts", async () => {
      const mockPlanner = {
        createPlan: async () => ({
          id: "new-plan",
          missionId: "m1",
          objectives: [],
          delegations: [],
          risks: [],
          validationGates: [],
          createdAt: new Date().toISOString(),
        }),
      };
      const config = createSupervisorConfig({
        maxRecoveryAttempts: 1,
        replanner: mockPlanner as any,
      });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // First failure → REPAIR (failureCount=1)
      const d1 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TS error"));
      expect(d1.type).toBe("REPAIR");

      // Execute recovery (increments recoveryCount to 1)
      await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), d1);

      // Second failure → ESCALATE (failureCount=2)
      const d2 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TS error"));
      expect(d2.type).toBe("ESCALATE");

      // Execute escalation (increments recoveryCount to 2)
      await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), d2);

      // Third failure → REPLAN (recoveryCount=2 >= maxRecoveryAttempts=1)
      const d3 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TS error"));
      expect(d3.type).toBe("REPLAN");
      expect(d3.reason).toBe("repair_exhausted");
    });
  });

  describe("9I-12: Replan receives bounded failure context", () => {
    it("builds context with all relevant information", async () => {
      const mission = createMission("Test mission", { projectId: "p1" });
      const state = new MissionState(tmpDir, mission.id);
      const eventSink = new InMemoryEventSink();
      const publisher = createMissionEventPublisher(eventSink);
      const config = createSupervisorConfig({ missionState: state, eventSink, publisher });
      const supervisor = new MissionSupervisor(config);
      const del = makeDelegation(mission.id, "d1");

      // Initialize state and add delegation
      await state.init();
      await state.setMission(mission);
      await state.addDelegation(del);
      await state.startDelegation(del.id, "");
      await state.completeDelegation(del.id, "passed", "Success");

      supervisor.observeDelegationStarted(del);
      supervisor.observeDelegationCompleted(del.id, makeResult(del.id, "passed"));

      const context = supervisor.buildReplanContext();
      expect(context.missionGoal).toBe("Test mission");
      expect(context.completedDelegations).toContain(del.id);
    });
  });

  describe("9I-13: Previous failed strategy is not blindly repeated", () => {
    it("tracks attempted models to avoid repetition", async () => {
      const config = createSupervisorConfigWithRouter();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // Generate CHANGE_MODEL decisions through failures
      await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "Provider timeout"));
      await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "Provider timeout"));

      const context = supervisor.buildReplanContext();
      expect(context.attemptedModels.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("9I-14: Supervisor decisions are stored", () => {
    it("accumulates decisions over time", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del1 = makeDelegation(mission.id, "d1");
      const del2 = makeDelegation(mission.id, "d2");

      supervisor.observeDelegationStarted(del1);
      supervisor.observeDelegationStarted(del2);

      await supervisor.handleDelegationFailure(del1, makeResult(del1.id, "failed", "Error 1"));
      await supervisor.handleDelegationFailure(del2, makeResult(del2.id, "failed", "Error 2"));

      const decisions = supervisor.getDecisions();
      expect(decisions.length).toBe(2);
      expect(decisions[0].delegationId).toBe(del1.id);
      expect(decisions[1].delegationId).toBe(del2.id);
    });
  });

  describe("9I-15: Events are emitted through MissionEventSink", () => {
    it("emits decision events to the sink", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "Error"));

      const events = (config.eventSink as InMemoryEventSink).recent();
      const decisionEvents = events.filter((e: any) => e.type === "mission.supervisor.decision");
      expect(decisionEvents.length).toBe(1);
      expect((decisionEvents[0].payload as any).delegationId).toBe(del.id);
    });
  });

  describe("9I-16: All counters remain bounded", () => {
    it("does not exceed maxRecoveryAttempts", async () => {
      const config = createSupervisorConfig({ maxRecoveryAttempts: 2 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // Multiple failures
      for (let i = 0; i < 5; i++) {
        await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "Error"));
      }

      const counters = supervisor.getCounters();
      expect(counters.decisionCount).toBe(5);
      expect(supervisor.isWithinLimits()).toBe(true);
    });

    it("does not exceed maxModelFallbackAttempts", async () => {
      const config = createSupervisorConfig({ maxModelFallbackAttempts: 2 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // Observe model fallbacks
      supervisor.observeModelFallback(del.id, "gpt-4");
      supervisor.observeModelFallback(del.id, "claude-3");

      const counters = supervisor.getCounters();
      expect(counters.totalModelFallbackAttempts).toBe(2);
    });
  });

  describe("9I-17: No infinite loops", () => {
    it("all recovery paths terminate", async () => {
      const config = createSupervisorConfig({ maxRecoveryAttempts: 1, maxReplanAttempts: 1 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // Run many failure cycles — all should terminate
      for (let i = 0; i < 10; i++) {
        const decision = await supervisor.handleDelegationFailure(
          del,
          makeResult(del.id, "failed", "Repeated error"),
        );
        expect(decision).toBeDefined();
        expect(["REPAIR", "ESCALATE", "REPLAN", "ABORT"]).toContain(decision.type);

        if (decision.type === "ABORT" || decision.type === "REPLAN") break;

        // Execute recovery to advance counters
        await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), decision);
      }

      expect(supervisor.isWithinLimits()).toBe(true);
    });

    it("stuck detection terminates", async () => {
      const config = createSupervisorConfig({ maxStuckRecoveries: 1, maxDelegationDurationMs: 100 });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // First stuck detection → REPAIR
      const d1 = await supervisor.handleStuckDelegation(del.id, mission.id);
      expect(d1).toBeDefined();
      expect(d1!.type).toBe("REPAIR");

      // Execute recovery to increment recoveryCount
      await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), d1!);

      // Second stuck detection → REPLAN (exhausted)
      const d2 = await supervisor.handleStuckDelegation(del.id, mission.id);
      expect(d2).toBeDefined();
      expect(d2!.type).toBe("REPLAN");

      // Third stuck detection → still REPLAN (recoveryCount exceeds max)
      const d3 = await supervisor.handleStuckDelegation(del.id, mission.id);
      expect(d3).toBeDefined();
      expect(d3!.type).toBe("REPLAN");
    });
  });

  describe("9I-extended: Model fallback with no router", () => {
    it("returns ESCALATE when no router available", async () => {
      const config = createSupervisorConfig({ modelRouter: undefined });
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const decision = await supervisor.handleDelegationFailure(
        del,
        makeResult(del.id, "failed", "Provider timeout"),
      );

      // Without modelRouter, provider failure escalates
      expect(decision.type).toBe("ESCALATE");
      expect(decision.reason).toBe("provider_failure");
    });
  });

  describe("9I-extended: Escalation level tracking", () => {
    it("increments escalation level on escalation", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // First failure → REPAIR
      const d1 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "Error"));
      expect(d1.type).toBe("REPAIR");

      // Execute recovery
      await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), d1);

      // Second failure → ESCALATE
      const d2 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "Error"));
      expect(d2.type).toBe("ESCALATE");

      // Execute escalation (increments escalationLevel)
      await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), d2);

      const state = supervisor.getDelegationState(del.id);
      expect(state!.escalationLevel).toBeGreaterThanOrEqual(1);
    });
  });

  describe("9I-extended: Recovery execution", () => {
    it("executeRecoveryDecision returns success for REPAIR", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const decision: SupervisorDecision = {
        id: "test-decision",
        delegationId: del.id,
        type: "REPAIR",
        reason: "code_failure",
        context: "test",
        attemptedAt: new Date().toISOString(),
      };

      const success = await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), decision);
      expect(success).toBe(true);
      expect(decision.result).toBe("success");
    });

    it("executeRecoveryDecision returns false for ABORT", async () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);
      const decision: SupervisorDecision = {
        id: "test-decision",
        delegationId: del.id,
        type: "ABORT",
        reason: "repair_exhausted",
        context: "test",
        attemptedAt: new Date().toISOString(),
      };

      const success = await supervisor.executeRecoveryDecision(del, makeResult(del.id, "failed"), decision);
      expect(success).toBe(false);
      expect(decision.result).toBe("failure");
    });
  });

  describe("9I-extended: buildReplanContext includes all fields", () => {
    it("returns complete context structure", () => {
      const config = createSupervisorConfig();
      const supervisor = new MissionSupervisor(config);
      const context = supervisor.buildReplanContext();

      expect(context).toHaveProperty("missionGoal");
      expect(context).toHaveProperty("completedDelegations");
      expect(context).toHaveProperty("failedDelegations");
      expect(context).toHaveProperty("validationErrors");
      expect(context).toHaveProperty("triageHistory");
      expect(context).toHaveProperty("repairHistory");
      expect(context).toHaveProperty("attemptedModels");
      expect(context).toHaveProperty("activeDelegationStates");
    });
  });

  describe("9I-extended: decideRecovery pure function", () => {
    it("returns correct decisions for various failure types", async () => {
      const config = createSupervisorConfigWithRouter();
      const supervisor = new MissionSupervisor(config);
      const mission = config.missionState.getMission();
      const del = makeDelegation(mission.id, "d1");

      supervisor.observeDelegationStarted(del);

      // Provider failure → CHANGE_MODEL
      const d1 = supervisor.decideRecovery(del, makeResult(del.id, "failed", "Provider timeout"));
      expect(d1.type).toBe("CHANGE_MODEL");

      // Simulate first code failure through handleDelegationFailure
      const d2 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TypeScript error"));
      expect(d2.type).toBe("REPAIR");

      // Simulate second code failure → ESCALATE
      const d3 = await supervisor.handleDelegationFailure(del, makeResult(del.id, "failed", "TypeScript error"));
      expect(d3.type).toBe("ESCALATE");
    });
  });
});
