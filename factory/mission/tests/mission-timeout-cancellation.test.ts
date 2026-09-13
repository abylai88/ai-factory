import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { MissionOrchestrator, type FactoryExecutionAdapter, type Auditor } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes, createMissionEventPublisher } from "../events.js";
import { createMissionSupervisor } from "../mission-supervisor.js";
import type { Delegation, Mission, AgentResult, AuditResult, ExecutionPlan } from "../mission.js";

let tmpDir: string;
let projectPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-timeout-cancellation-"));
  projectPath = path.join(tmpDir, "projects", "test-game");
  await fs.mkdir(path.join(projectPath, "src"), { recursive: true });
  await fs.writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ name: "test-game", scripts: { build: "echo ok" } }, null, 2)
  );
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Mocks ──────────────────────────────────────────────────

function createSlowAdapter(delayMs: number, callLog: string[]): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission, config: any): Promise<AgentResult> {
      callLog.push(`${del.id}:start`);
      // Simulate long-running work
      await new Promise(resolve => setTimeout(resolve, delayMs));
      callLog.push(`${del.id}:end`);
      return {
        delegationId: del.id,
        status: "passed",
        output: "Work completed",
        durationMs: delayMs,
      };
    },
  };
}

function createAbortableAdapter(callLog: string[]): FactoryExecutionAdapter {
  return {
    async runDelegation(del: Delegation, mission: Mission, config: any): Promise<AgentResult> {
      callLog.push(`${del.id}:start`);
      const signal = config.signal as AbortSignal | undefined;
      
      if (signal) {
        // If already aborted, fail immediately
        if (signal.aborted) {
          callLog.push(`${del.id}:aborted-before-start`);
          return {
            delegationId: del.id,
            status: "failed",
            output: "",
            error: "Execution aborted: mission timeout",
            durationMs: 0,
          };
        }

        // Wait for either completion or abort
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            callLog.push(`${del.id}:completed`);
            resolve();
          }, 5000); // Long delay to allow abort to happen

          if (signal.aborted) {
            clearTimeout(timeout);
            callLog.push(`${del.id}:aborted-during-wait`);
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }

          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            callLog.push(`${del.id}:aborted-during-wait`);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      } else {
        // No signal - just complete
        await new Promise(resolve => setTimeout(resolve, 100));
        callLog.push(`${del.id}:completed`);
      }

      return {
        delegationId: del.id,
        status: "passed",
        output: "Work completed",
        durationMs: 100,
      };
    },
  };
}

function createPassingAuditor(): Auditor {
  return {
    async audit(delegation: Delegation): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: "PASS",
        summary: "All checks passed",
        findings: [],
        acceptanceCriteriaResults: (delegation.acceptanceCriteria ?? []).map((c) => ({
          criterion: c,
          passed: true,
          evidence: "Verified",
        })),
      };
    },
  };
}

async function setupOrchestrator(config: {
  factoryAdapter: FactoryExecutionAdapter;
  maxMissionDurationMs?: number;
}) {
  const mission = createMission(
    "Build the game",
    {
      projectId: "test-game",
      engine: "web",
      stack: "phaser",
      workspace: projectPath,
    }
  );

  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const state = new MissionState(stateDir, mission.id);
  await state.init();
  await state.setMission(mission);

  const buildDel = createDelegation(
    mission.id,
    "obj-build",
    "Build Project",
    "ROLE: builder\nBUILD_COMMAND: echo ok",
    "engineering",
    {
      stepIds: ["build"],
      dependsOn: [],
      acceptanceCriteria: ["Build succeeds"],
    }
  );

  const plan: ExecutionPlan = {
    id: "plan-1",
    missionId: mission.id,
    objectives: [{ id: "obj-build", title: "Build", description: "Build the project", delegations: [buildDel.id] }],
    delegations: [buildDel],
    risks: [],
    validationGates: [],
    createdAt: new Date().toISOString(),
  };

  await state.setPlan(plan);
  await state.addDelegation(buildDel);

  const eventSink = new InMemoryEventSink();
  const publisher = createMissionEventPublisher(eventSink);
  const supervisor = createMissionSupervisor({
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
  });

  const orchestrator = new MissionOrchestrator({
    maxRepairs: 3,
    baseDir: tmpDir,
    project: projectPath,
    factoryAdapter: config.factoryAdapter,
    auditor: createPassingAuditor(),
    eventSink,
    missionState: state,
    supervisor,
    maxMissionDurationMs: config.maxMissionDurationMs,
  });

  return { orchestrator, mission, eventSink, state, buildDel, plan };
}

function getEvents(eventSink: InMemoryEventSink, type: string) {
  return eventSink.recent().filter((e) => e.type === type);
}

// ── Tests ──────────────────────────────────────────────────

describe("Mission timeout cancellation", () => {
  it("cancels in-flight delegation when mission timeout fires", async () => {
    const callLog: string[] = [];
    
    // Use a very short timeout (50ms) and a slow adapter (100ms)
    // The timeout should fire before the delegation completes
    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: createSlowAdapter(100, callLog),
      maxMissionDurationMs: 50,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should fail due to timeout
    expect(result.status).toBe("failed");

    // Timeout event should be emitted
    const timeoutEvents = getEvents(eventSink, "mission.timeout" as any);
    expect(timeoutEvents.length).toBe(1);

    // Delegation should have started but been cancelled
    // (exact timing depends on event loop, but at minimum it should have started)
    expect(callLog.some(log => log.includes("start"))).toBe(true);
  });

  it("handles abort signal in factory adapter", async () => {
    const callLog: string[] = [];
    
    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: createAbortableAdapter(callLog),
      maxMissionDurationMs: 50,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should fail due to timeout
    expect(result.status).toBe("failed");

    // Adapter should have received abort signal and handled it
    // The delegation should have started
    expect(callLog.some(log => log.includes("start"))).toBe(true);
    
    // The abort should have been triggered
    expect(callLog.some(log => log.includes("aborted"))).toBe(true);
  });

  it("does not change mission status back to success after timeout", async () => {
    const callLog: string[] = [];
    
    // Short timeout, delegation would complete if not cancelled
    const { orchestrator, mission, eventSink, state, plan } = await setupOrchestrator({
      factoryAdapter: createAbortableAdapter(callLog),
      maxMissionDurationMs: 50,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should be failed
    expect(result.status).toBe("failed");

    // State should reflect failed
    const finalMission = state.getMission();
    expect(finalMission.status).toBe("failed");

    // No subsequent event should change it back to completed
    const completedEvents = getEvents(eventSink, MissionEventTypes.MISSION_COMPLETED);
    expect(completedEvents.length).toBe(0);
  });

  it("completes normally when timeout is not reached", async () => {
    const callLog: string[] = [];
    
    // Long timeout (10 seconds), delegation completes quickly (100ms)
    const { orchestrator, mission, eventSink, plan } = await setupOrchestrator({
      factoryAdapter: createSlowAdapter(100, callLog),
      maxMissionDurationMs: 10000,
    });

    const result = await orchestrator.executeMission(mission, plan);

    // Mission should complete successfully
    expect(result.status).toBe("completed");

    // No timeout event
    const timeoutEvents = getEvents(eventSink, "mission.timeout" as any);
    expect(timeoutEvents.length).toBe(0);

    // Delegation should complete fully (check for any delegation start/end)
    expect(callLog.some(log => log.includes(":start"))).toBe(true);
    expect(callLog.some(log => log.includes(":end"))).toBe(true);
  });
});