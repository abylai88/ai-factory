import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  MissionOrchestrator,
  type FactoryExecutionAdapter,
  type Auditor,
} from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";
import { MissionState } from "../state.js";
import { PeerReviewSystem, defaultReviewExecutor, type ReviewRequest, type ReviewResult } from "../peer-review.js";
import { AgentRegistry } from "../agent-registry.js";
import { ArtifactStore } from "../artifact-store.js";
import { createMission, createDelegation } from "../mission.js";
import type { Mission, Delegation, AgentResult, AuditResult } from "../mission.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "team-exec-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────

function passingAuditor(): Auditor {
  return {
    async audit(delegation: Delegation, result: AgentResult): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: result.status === "passed" ? "PASS" : "FAIL",
        summary: result.status === "passed" ? "All checks passed" : "Failed",
        findings: [],
        acceptanceCriteriaResults: [],
      };
    },
  };
}

function alwaysPassAuditor(): Auditor {
  return {
    async audit(delegation: Delegation): Promise<AuditResult> {
      return {
        delegationId: delegation.id,
        status: "PASS",
        summary: "Always pass",
        findings: [],
        acceptanceCriteriaResults: [],
      };
    },
  };
}

function makeReviewResult(req: ReviewRequest, passed: boolean, issues: Array<{ severity: "critical" | "high" | "medium" | "low"; description: string }> = []): ReviewResult {
  return {
    id: "rev-res",
    requestId: req.id,
    delegationId: req.delegationId,
    passed,
    issues,
    reviewerRole: req.reviewerRole,
    summary: passed ? "OK" : "Needs work",
    createdAt: new Date().toISOString(),
  };
}

function setupState(mission: Mission) {
  const state = new MissionState(tmpDir, mission.id);
  return state;
}

// ── Test 1: Developer succeeds → validation → QA review → complete
describe("Team execution E2E: developer succeeds", () => {
  it("completes after QA review", async () => {
    const mission = createMission("Build a feature", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build player", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: true,
      reviewerRole: "QA",
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    let adapterCalls = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        adapterCalls++;
        return { delegationId: del.id, status: "passed", output: "Built.", durationMs: 10 };
      },
    };

    const reviewCalls: string[] = [];
    const reviewExecutor = async (req: ReviewRequest) => {
      reviewCalls.push(req.reviewerRole);
      return makeReviewResult(req, true);
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
      peerReview: new PeerReviewSystem(),
      reviewExecutor,
    });

    const result = await orchestrator.executeMission(mission, plan);

    expect(result.status).toBe("completed");
    expect(adapterCalls).toBe(1);
    expect(reviewCalls).toContain("QA"); // QA reviewer ran
  });
});

// ── Test 2: QA rejects → Repair agent → QA rechecks → complete
describe("Team execution E2E: review repair loop", () => {
  it("routes review rejection to repair and re-reviews", async () => {
    const mission = createMission("Build a feature with review", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Implement X", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: true,
      reviewerRole: "QA",
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Implement", description: "Implement", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    let reviewAttempts = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(d) {
        // Repair delegation always succeeds
        return { delegationId: d.id, status: "passed", output: "Done.", durationMs: 10 };
      },
    };

    const reviewExecutor = async (req: ReviewRequest) => {
      reviewAttempts++;
      if (reviewAttempts === 1) {
        return makeReviewResult(req, false, [{ severity: "high", description: "Missing tests" }]);
      }
      return makeReviewResult(req, true);
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
      peerReview: new PeerReviewSystem(),
      reviewExecutor,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
    expect(reviewAttempts).toBe(2); // 1st fails, 2nd passes
  });
});

// ── Test 3: Developer fails → triage → Architect repair → success
describe("Team execution E2E: failure triage with peer review", () => {
  it("triages and routes through repair to completion", async () => {
    const mission = createMission("Complex build", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    let attempt = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation(d) {
        attempt++;
        if (attempt === 1) {
          await state.completeDelegation(d.id, "failed", "err", "First attempt failed");
          return { delegationId: d.id, status: "failed", output: "err", error: "Failed", durationMs: 10 };
        }
        return { delegationId: d.id, status: "passed", output: "Built.", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 3,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
    expect(attempt).toBeGreaterThan(1);
  });
});

// ── Test 4: Independent agents run in parallel; one fails; others continue
describe("Team execution E2E: parallel isolation", () => {
  it("one parallel delegation failing does not block unrelated parallel work", async () => {
    const mission = createMission("Parallel work", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const d1 = createDelegation(mission.id, "obj-1", "A", "desc", "engineering", {
      dependsOn: [],
      parallelizable: true,
    });
    const d2 = createDelegation(mission.id, "obj-1", "B", "desc", "engineering", {
      dependsOn: [],
      parallelizable: true,
    });
    const d3 = createDelegation(mission.id, "obj-1", "C", "desc", "engineering", {
      dependsOn: [],
      parallelizable: true,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Work", description: "Work", delegations: [d1.id, d2.id, d3.id] }],
      delegations: [d1, d2, d3],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(d1);
    await state.addDelegation(d2);
    await state.addDelegation(d3);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(d) {
        if (d.id === d2.id) {
          await state.completeDelegation(d.id, "failed", "err", "B failed");
          return { delegationId: d.id, status: "failed", output: "err", error: "Failed", durationMs: 10 };
        }
        return { delegationId: d.id, status: "passed", output: "Done.", durationMs: 10 };
      },
    };

    // Always-passing auditor (so failed d2 stays failed, no repair)
    const alwaysPassAuditor: Auditor = {
      async audit(delegation: Delegation): Promise<AuditResult> {
        return {
          delegationId: delegation.id,
          status: "PASS",
          summary: "ok",
          findings: [],
          acceptanceCriteriaResults: [],
        };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: alwaysPassAuditor,
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    // Mission fails because d2 failed (graph has failed delegation)
    expect(result.status).toBe("failed");
    // But d1 and d3 should still have completed in the event stream
    const events = eventSink.recent();
    const completedIds = events
      .filter((e) => e.type === "delegation.completed")
      .map((e: any) => e.payload?.delegationId);
    // At least one of d1/d3 should have completed independently of d2
    expect(completedIds.length).toBeGreaterThan(0);
  });
});

// ── Test 5: Dynamic specialist spawned → completes → mission continues
describe("Team execution E2E: dynamic delegation", () => {
  it("supports dynamic agent spawning", async () => {
    const mission = createMission("Mission with dynamic agent", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const initialDel = createDelegation(mission.id, "obj-1", "Initial", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Work", description: "Work", delegations: [initialDel.id] }],
      delegations: [initialDel],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(initialDel);

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: {
        async runDelegation() {
          return { delegationId: "x", status: "passed", output: "Done.", durationMs: 10 };
        },
      },
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
    });

    // Manually add a dynamic delegation
    const specialist = createDelegation(mission.id, "obj-1", "Specialist", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Architect",
    });

    const added = orchestrator.addDelegation(specialist);
    expect(added).toBe(true);

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
  });
});

// ── Test 6: ArtifactStore is integrated via context building
describe("Team execution E2E: artifact handoff", () => {
  it("ArtifactStore builds context for handoff", () => {
    const mission = createMission("Test", { projectId: "p1" });
    const store = new ArtifactStore(mission.id);

    store.registerArtifact({
      delegationId: "d1", type: "research", title: "Market analysis", summary: "TAM = 10B",
      createdByRole: "Researcher",
    });
    store.registerArtifact({
      delegationId: "d2", type: "code", title: "Player controller", summary: "Movement logic",
      createdByRole: "Developer", path: "src/player.ts",
    });

    const context = store.buildArtifactContext();
    expect(context).toContain("Market analysis");
    expect(context).toContain("Player controller");
    expect(context).toContain("src/player.ts");
    expect(context).toContain("[Researcher]");
    expect(context).toContain("[Developer]");
  });
});

// ── Test 7: AgentRegistry is integrated for routing
describe("Team execution E2E: registry routing", () => {
  it("routes reviewers correctly via AgentRegistry", () => {
    const registry = new AgentRegistry();
    expect(registry.findReviewerRole("Developer").primary).toBe("QA");
    expect(registry.findReviewerRole("Architect").primary).toBe("Developer");
    expect(registry.findReviewerRole("Repair").primary).toBe("QA");
  });
});

// ── Test 8: Review executor omission = default behavior
describe("Team execution E2E: no review executor", () => {
  it("uses default executor when no executor is configured", async () => {
    const mission = createMission("Mission", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Work", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: true,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Work", description: "Work", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        return { delegationId: del.id, status: "passed", output: "Done.", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
      peerReview: new PeerReviewSystem(),
      // No reviewExecutor provided - should default to defaultReviewExecutor
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
  });
});

// ── Test 9: Peer review rejection → fail (without repair path)
describe("Team execution E2E: review failure without repair", () => {
  it("fails when review exhausts attempts", async () => {
    const mission = createMission("Failing review", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Bad work", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: true,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Work", description: "Work", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation(d) {
        return { delegationId: d.id, status: "passed", output: "Done.", durationMs: 10 };
      },
    };

    let callCount = 0;
    const reviewExecutor = async (req: ReviewRequest) => {
      callCount++;
      return makeReviewResult(req, false, [{ severity: "critical", description: "Always bad" }]);
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 1,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
      peerReview: new PeerReviewSystem({ maxReviewAttempts: 1 }),
      reviewExecutor,
    });

    const result = await orchestrator.executeMission(mission, plan);
    // After review failure, the second review attempt is also failing
    // but our orchestrator does exactly 2 review attempts (initial + after-repair)
    // and the test's maxReviewAttempts=1 means after 1 attempt, give up
    // The mission should fail because review rejection -> failed
    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("failed");
  });
});

// ══════════════════════════════════════════════════════════════════
// Gap 2: Automatic Artifact Registration Tests
// ══════════════════════════════════════════════════════════════════

describe("Gap 2: automatic artifact registration", () => {
  it("registers code artifact from successful Developer delegation", async () => {
    const mission = createMission("Build feature", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Implement game logic", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        return {
          delegationId: del.id,
          status: "passed",
          output: "Created src/game/engine.ts and src/utils/helpers.ts",
          durationMs: 10,
        };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");

    const events = eventSink.recent();
    const artifactEvents = events.filter((e: any) => e.type === "delegation.artifact.created");
    expect(artifactEvents.length).toBeGreaterThanOrEqual(2);

    const paths = artifactEvents.map((e: any) => e.payload.path);
    expect(paths).toContain("src/game/engine.ts");
    expect(paths).toContain("src/utils/helpers.ts");
  });

  it("registers test/report artifact from QA delegation", async () => {
    const mission = createMission("Run tests", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Run test suite", "Run all tests", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "QA",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Test", description: "Test", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        return { delegationId: del.id, status: "passed", output: "All 42 tests passed", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");

    const events = eventSink.recent();
    const artifactEvents = events.filter((e: any) => e.type === "delegation.artifact.created");
    // No file paths → register as report
    expect(artifactEvents.length).toBe(1);
    expect(artifactEvents[0].payload.type).toBe("report");
  });

  it("does NOT register artifacts from failed delegations", async () => {
    const mission = createMission("Broken build", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        return { delegationId: del.id, status: "failed", output: "Compilation error", error: "TypeScript error", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: alwaysPassAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("failed");

    const events = eventSink.recent();
    const artifactEvents = events.filter((e: any) => e.type === "delegation.artifact.created");
    expect(artifactEvents.length).toBe(0);
  });

  it("does NOT store raw file contents in artifact metadata", async () => {
    const mission = createMission("Build", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        return { delegationId: del.id, status: "passed", output: "Created src/app.ts", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: passingAuditor(),
      eventSink,
      missionState: state,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");

    const events = eventSink.recent();
    const artifactEvents = events.filter((e: any) => e.type === "delegation.artifact.created");
    expect(artifactEvents.length).toBe(1);

    // Metadata should not contain raw source
    const meta = artifactEvents[0].payload;
    expect(meta).toBeDefined();
    expect(JSON.stringify(meta).length).toBeLessThan(500);
  });
});

// ══════════════════════════════════════════════════════════════════
// Gap 3: Real Model Fallback Tests
// ══════════════════════════════════════════════════════════════════

describe("Gap 3: model fallback integration", () => {
  it("emits delegation.model_fallback on model/provider failure and retries", async () => {
    const mission = createMission("Build with fallback", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    let callCount = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        callCount++;
        if (callCount === 1) {
          throw new Error("Provider timeout: anthropic API unavailable");
        }
        return { delegationId: del.id, status: "passed", output: "Done on fallback", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: alwaysPassAuditor(),
      eventSink,
      missionState: state,
      modelRouter: { chooseModel: () => "gpt-4", buildFallbackChain: () => ({ primary: "gpt-4", fallbacks: ["claude-3"], reason: "test" }), nextFallback: () => "claude-3" } as any,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("completed");
    expect(callCount).toBe(2);

    const events = eventSink.recent();
    const fallbackEvents = events.filter((e: any) => e.type === "delegation.model_fallback");
    expect(fallbackEvents.length).toBe(1);
    expect(fallbackEvents[0].payload.previousModel).toBeDefined();
    expect(fallbackEvents[0].payload.nextModel).toBe("claude-3");
  });

  it("does NOT trigger model fallback on code/test failures", async () => {
    const mission = createMission("Code failure", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        return { delegationId: del.id, status: "failed", output: "", error: "TypeScript: Property 'x' does not exist", durationMs: 10 };
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: alwaysPassAuditor(),
      eventSink,
      missionState: state,
      modelRouter: { chooseModel: () => "gpt-4", buildFallbackChain: () => ({ primary: "gpt-4", fallbacks: ["claude-3"], reason: "test" }), nextFallback: () => "claude-3" } as any,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("failed");

    const events = eventSink.recent();
    const fallbackEvents = events.filter((e: any) => e.type === "delegation.model_fallback");
    expect(fallbackEvents.length).toBe(0);
  });

  it("fails normally when all models in fallback chain are exhausted", async () => {
    const mission = createMission("All fail", { projectId: "p1" });
    const state = setupState(mission);
    await state.init();
    await state.setMission(mission);

    const del = createDelegation(mission.id, "obj-1", "Build", "desc", "engineering", {
      dependsOn: [],
      parallelizable: false,
      role: "Developer",
      requiresReview: false,
    });

    const plan = {
      id: "plan-1",
      missionId: mission.id,
      objectives: [{ id: "obj-1", title: "Build", description: "Build", delegations: [del.id] }],
      delegations: [del],
      risks: [],
      validationGates: [],
      createdAt: new Date().toISOString(),
    };

    await state.setPlan(plan);
    await state.addDelegation(del);

    let callCount = 0;
    const adapter: FactoryExecutionAdapter = {
      async runDelegation() {
        callCount++;
        throw new Error("Provider unavailable");
      },
    };

    const eventSink = new InMemoryEventSink();
    const orchestrator = new MissionOrchestrator({
      maxRepairs: 0,
      baseDir: tmpDir,
      project: path.join(tmpDir, "project"),
      factoryAdapter: adapter,
      auditor: alwaysPassAuditor(),
      eventSink,
      missionState: state,
      modelRouter: {
        chooseModel: () => "gpt-4",
        buildFallbackChain: () => ({ primary: "gpt-4", fallbacks: ["claude-3", "gemini"], reason: "test" }),
        nextFallback: (current: string) => {
          if (current === "gpt-4") return "claude-3";
          if (current === "claude-3") return "gemini";
          return null;
        },
      } as any,
    });

    const result = await orchestrator.executeMission(mission, plan);
    expect(result.status).toBe("failed");
    expect(callCount).toBeGreaterThanOrEqual(2);

    const events = eventSink.recent();
    const fallbackEvents = events.filter((e: any) => e.type === "delegation.model_fallback");
    expect(fallbackEvents.length).toBeGreaterThanOrEqual(1);
  });
});
