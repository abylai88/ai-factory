import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  createAuditResult,
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
  VisualQaResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { createPlanner } from "../planner.js";
import { CodingMissionAuditor } from "../adapters.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import { normalizeVisualQaEvidence, VisualQaEvidence } from "../visual-qa-evidence.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "visual-qa-evidence-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeMission(goal = "Fix the Traffic Dodge package name"): Mission {
  return createMission(goal, {
    projectId: "traffic-dodge",
    engine: "web",
    stack: "Phaser + TypeScript",
    template: "yagames-phaser-template",
    workspace: path.join(tmpDir, "projects", "traffic-dodge"),
  });
}

// ─── 1. Passed QA normalization ──────────────────────────────────────

describe("normalizeVisualQaEvidence: passed", () => {
  it("normalizes a passing QA result correctly", () => {
    const now = new Date().toISOString();
    const result: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      errors: [],
      artifacts: [
        { id: "art_001", type: "screenshot", label: "1280x720/menu" },
        { id: "art_002", type: "trace", label: "trace-run-1" },
      ],
      runId: "run-pass-001",
      startedAt: now,
      finishedAt: now,
    };

    const evidence = normalizeVisualQaEvidence(result);

    expect(evidence.status).toBe("passed");
    expect(evidence.passed).toBe(true);
    expect(evidence.totalChecks).toBe(11);
    expect(evidence.passedChecks).toBe(11);
    expect(evidence.failedChecks).toBe(0);
    expect(evidence.errorCount).toBe(0);
    expect(evidence.artifactCount).toBe(2);
    expect(evidence.artifacts).toEqual([
      { id: "art_001", type: "screenshot", label: "1280x720/menu" },
      { id: "art_002", type: "trace", label: "trace-run-1" },
    ]);
    expect(evidence.startedAt).toBe(now);
    expect(evidence.finishedAt).toBe(now);
  });
});

// ─── 2. Failed QA normalization ──────────────────────────────────────

describe("normalizeVisualQaEvidence: failed", () => {
  it("normalizes a failing QA result correctly", () => {
    const now = new Date().toISOString();
    const result: VisualQaResult = {
      status: "failed",
      passed: false,
      checks: 11,
      failedChecks: 3,
      errors: ["page: Canvas not found", "console: TypeError"],
      artifacts: [
        { id: "art_fail1", type: "screenshot", label: "1280x720/failure" },
      ],
      runId: "run-fail-001",
      startedAt: now,
      finishedAt: now,
    };

    const evidence = normalizeVisualQaEvidence(result);

    expect(evidence.status).toBe("failed");
    expect(evidence.passed).toBe(false);
    expect(evidence.totalChecks).toBe(11);
    expect(evidence.passedChecks).toBe(8);
    expect(evidence.failedChecks).toBe(3);
    expect(evidence.errorCount).toBe(2);
    expect(evidence.artifactCount).toBe(1);
  });
});

// ─── 3. Skipped QA normalization ─────────────────────────────────────

describe("normalizeVisualQaEvidence: skipped", () => {
  it("normalizes a skipped QA result correctly", () => {
    const now = new Date().toISOString();
    const result: VisualQaResult = {
      status: "skipped",
      passed: false,
      checks: 0,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };

    const evidence = normalizeVisualQaEvidence(result);

    expect(evidence.status).toBe("skipped");
    expect(evidence.passed).toBe(false);
    expect(evidence.totalChecks).toBe(0);
    expect(evidence.passedChecks).toBe(0);
    expect(evidence.failedChecks).toBe(0);
    expect(evidence.errorCount).toBe(0);
    expect(evidence.artifactCount).toBe(0);
    expect(evidence.artifacts).toEqual([]);
  });
});

// ─── 4. QA with runtime errors ───────────────────────────────────────

describe("normalizeVisualQaEvidence: runtime errors", () => {
  it("counts errors from the QA result", () => {
    const now = new Date().toISOString();
    const result: VisualQaResult = {
      status: "failed",
      passed: false,
      checks: 5,
      failedChecks: 1,
      errors: [
        "page: Uncaught TypeError",
        "console: ReferenceError",
        "request: Network error",
      ],
      artifacts: [],
      runId: "run-err-001",
      startedAt: now,
      finishedAt: now,
    };

    const evidence = normalizeVisualQaEvidence(result);

    expect(evidence.errorCount).toBe(3);
    expect(evidence.failedChecks).toBe(1);
    expect(evidence.status).toBe("failed");
  });
});

// ─── 5. QA artifact metadata preservation ────────────────────────────

describe("normalizeVisualQaEvidence: artifact metadata", () => {
  it("preserves artifact id, type, and label without binary data", () => {
    const now = new Date().toISOString();
    const result: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 4,
      failedChecks: 0,
      errors: [],
      artifacts: [
        { id: "art_screen1", type: "screenshot", label: "1280x720/menu" },
        { id: "art_trace1", type: "trace", label: "trace-full" },
        { id: "art_report1", type: "report", label: "summary-report" },
      ],
      startedAt: now,
      finishedAt: now,
    };

    const evidence = normalizeVisualQaEvidence(result);

    expect(evidence.artifacts).toHaveLength(3);
    expect(evidence.artifacts[0]).toEqual({ id: "art_screen1", type: "screenshot", label: "1280x720/menu" });
    expect(evidence.artifacts[1]).toEqual({ id: "art_trace1", type: "trace", label: "trace-full" });
    expect(evidence.artifacts[2]).toEqual({ id: "art_report1", type: "report", label: "summary-report" });
    for (const art of evidence.artifacts) {
      expect(art).not.toHaveProperty("data");
      expect(art).not.toHaveProperty("buffer");
      expect(art).not.toHaveProperty("content");
    }
  });
});

// ─── 6. No binary screenshot data in state ───────────────────────────

describe("no binary screenshot data in state", () => {
  it("evidence contains only references, no binary data", () => {
    const now = new Date().toISOString();
    const result: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 2,
      failedChecks: 0,
      errors: [],
      artifacts: [
        { id: "art_b64", type: "screenshot", label: "screen" },
      ],
      startedAt: now,
      finishedAt: now,
    };

    const evidence = normalizeVisualQaEvidence(result);
    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toContain("base64");
    expect(serialized).not.toContain("buffer");
    expect(evidence.artifacts[0]).not.toHaveProperty("data");
  });

  it("persists evidence without binary data in mission state", async () => {
    const mission = makeMission();
    mission.context!.requiresVisualQa = true;

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 5,
      failedChecks: 0,
      errors: [],
      artifacts: [
        { id: "art_xyz", type: "screenshot", label: "1280x720/menu" },
      ],
      runId: "run-bin-test",
      startedAt: now,
      finishedAt: now,
    };

    await state.recordVisualQaResult(qaResult);

    const snapshotPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.state.json`);
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));

    expect(snapshot.mission.visualQaEvidence).toBeDefined();
    const ev = snapshot.mission.visualQaEvidence;
    expect(ev.artifacts).toHaveLength(1);
    expect(ev.artifacts[0]).toEqual({ id: "art_xyz", type: "screenshot", label: "1280x720/menu" });
    expect(ev.artifacts[0]).not.toHaveProperty("data");
    expect(ev.artifacts[0]).not.toHaveProperty("buffer");
    expect(ev.artifacts[0]).not.toHaveProperty("content");
  });
});

// ─── 7. Auditor PASS with valid QA evidence ──────────────────────────

describe("Auditor PASS with valid QA evidence", () => {
  it("passes when visualQaEvidence shows passed with 0 failures and 0 errors", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    mission.visualQaEvidence = normalizeVisualQaEvidence(mission.visualQa);

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("PASS");
    const qaFinding = audit.acceptanceCriteriaResults.find((r) => r.criterion === "Visual QA passed");
    expect(qaFinding).toBeDefined();
    expect(qaFinding!.passed).toBe(true);
    expect(qaFinding!.evidence).toBe("Visual QA passed with 0 failed checks");
  });
});

// ─── 8. Auditor FAIL when QA checks fail ─────────────────────────────

describe("Auditor FAIL when QA checks fail", () => {
  it("fails when visualQaEvidence shows failed checks", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "failed",
      passed: false,
      checks: 11,
      failedChecks: 3,
      errors: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    mission.visualQaEvidence = normalizeVisualQaEvidence(mission.visualQa);

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
    const qaFinding = audit.acceptanceCriteriaResults.find((r) => r.criterion === "Visual QA passed");
    expect(qaFinding).toBeDefined();
    expect(qaFinding!.passed).toBe(false);
    expect(qaFinding!.evidence).toContain("3 checks failed");
  });
});

// ─── 9. Auditor FAIL when QA has runtime errors ──────────────────────

describe("Auditor FAIL when QA has runtime errors", () => {
  it("fails when QA passed but has runtime errors", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      errors: ["page: Uncaught TypeError", "console: ReferenceError"],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    mission.visualQaEvidence = normalizeVisualQaEvidence(mission.visualQa);

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
    const qaFinding = audit.acceptanceCriteriaResults.find((r) => r.criterion === "Visual QA passed");
    expect(qaFinding).toBeDefined();
    expect(qaFinding!.passed).toBe(false);
    expect(qaFinding!.evidence).toContain("runtime errors");
  });
});

// ─── 10. Auditor FAIL when QA is skipped ─────────────────────────────

describe("Auditor FAIL when QA is skipped", () => {
  it("fails when visualQaEvidence shows skipped status", async () => {
    const auditor = new CodingMissionAuditor();
    const delegation = createDelegation("m1", "obj1", "Build Project", "desc", "engineering", {
      acceptanceCriteria: ["Build succeeded", "Visual QA passed"],
    });
    const result: AgentResult = {
      delegationId: delegation.id,
      status: "passed",
      output: JSON.stringify({ status: "success", exitCode: 0 }),
      durationMs: 100,
    };

    const mission = makeMission();
    mission.context!.requiresVisualQa = true;
    mission.visualQa = {
      status: "skipped",
      passed: false,
      checks: 0,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    mission.visualQaEvidence = normalizeVisualQaEvidence(mission.visualQa);

    const planner = createPlanner();
    const plan = planner.decompose(mission);

    const audit = await auditor.audit(delegation, result, mission, plan);
    expect(audit.status).toBe("FAIL");
    const qaFinding = audit.acceptanceCriteriaResults.find((r) => r.criterion === "Visual QA passed");
    expect(qaFinding).toBeDefined();
    expect(qaFinding!.passed).toBe(false);
    expect(qaFinding!.evidence).toContain("skipped");
  });
});

// ─── 11. Old Mission state without visualQa still loads ──────────────

describe("old Mission state without visualQa still loads", () => {
  it("loads mission state that has no visualQa or visualQaEvidence", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const loaded = state2.getMission();
    expect(loaded).toBeDefined();
    expect(loaded.id).toBe(mission.id);
    expect(loaded.visualQa).toBeUndefined();
    expect(loaded.visualQaEvidence).toBeUndefined();
    expect(state2.getVisualQaResult()).toBeUndefined();
    expect(state2.getVisualQaEvidence()).toBeUndefined();
  });

  it("loads mission state with visualQa but no visualQaEvidence", async () => {
    const mission = makeMission();

    const state1 = new MissionState(tmpDir, mission.id);
    await state1.init();
    await state1.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 5,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };
    await state1.recordVisualQaResult(qaResult);

    // Simulate old state without visualQaEvidence by manually writing snapshot
    const snapshotPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.state.json`);
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    delete snapshot.mission.visualQaEvidence;
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

    const state2 = new MissionState(tmpDir, mission.id);
    await state2.init();

    const loaded = state2.getMission();
    expect(loaded.visualQa).toBeDefined();
    expect(loaded.visualQaEvidence).toBeUndefined();
    expect(state2.getVisualQaResult()).toBeDefined();
    expect(state2.getVisualQaEvidence()).toBeUndefined();
  });
});

// ─── 12. mission.visual_qa events contain normalized summary ──────────

describe("mission.visual_qa events contain normalized summary", () => {
  it("completed event includes normalized evidence fields", async () => {
    const mission = makeMission();
    mission.context!.requiresVisualQa = true;

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "passed",
      passed: true,
      checks: 11,
      failedChecks: 0,
      errors: [],
      artifacts: [{ id: "art_evt", type: "screenshot", label: "screen" }],
      runId: "run-evt-001",
      startedAt: now,
      finishedAt: now,
    };

    await state.recordVisualQaResult(qaResult);

    const eventSink = new InMemoryEventSink();
    const events = eventSink.recent();

    // The event was appended via state.appendEvent, check the JSONL
    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const qaEvent = lines
      .map((l) => JSON.parse(l))
      .find((e: any) => e.type === "mission.visual_qa.completed");

    expect(qaEvent).toBeDefined();
    expect(qaEvent.payload.visualQaEvidence).toBeDefined();
    const ev = qaEvent.payload.visualQaEvidence;
    expect(ev.status).toBe("passed");
    expect(ev.passed).toBe(true);
    expect(ev.totalChecks).toBe(11);
    expect(ev.passedChecks).toBe(11);
    expect(ev.failedChecks).toBe(0);
    expect(ev.errorCount).toBe(0);
    expect(ev.artifactCount).toBe(1);
    expect(ev.startedAt).toBe(now);
    expect(ev.finishedAt).toBe(now);
  });

  it("failed event includes normalized evidence fields", async () => {
    const mission = makeMission();
    mission.context!.requiresVisualQa = true;

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "failed",
      passed: false,
      checks: 11,
      failedChecks: 3,
      errors: ["page: error"],
      artifacts: [],
      runId: "run-evt-fail",
      startedAt: now,
      finishedAt: now,
    };

    await state.recordVisualQaResult(qaResult);

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const qaEvent = lines
      .map((l) => JSON.parse(l))
      .find((e: any) => e.type === "mission.visual_qa.failed");

    expect(qaEvent).toBeDefined();
    const ev = qaEvent.payload.visualQaEvidence;
    expect(ev.status).toBe("failed");
    expect(ev.totalChecks).toBe(11);
    expect(ev.failedChecks).toBe(3);
    expect(ev.errorCount).toBe(1);
  });

  it("skipped event includes normalized evidence fields", async () => {
    const mission = makeMission();
    mission.context!.requiresVisualQa = true;

    const state = new MissionState(tmpDir, mission.id);
    await state.init();
    await state.setMission(mission);

    const now = new Date().toISOString();
    const qaResult: VisualQaResult = {
      status: "skipped",
      passed: false,
      checks: 0,
      failedChecks: 0,
      errors: [],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };

    await state.recordVisualQaResult(qaResult);

    const jsonlPath = path.join(tmpDir, "outputs", "missions", `${mission.id}.jsonl`);
    const content = await fs.readFile(jsonlPath, "utf8");
    const lines = content.trim().split("\n");
    const qaEvent = lines
      .map((l) => JSON.parse(l))
      .find((e: any) => e.type === "mission.visual_qa.skipped");

    expect(qaEvent).toBeDefined();
    const ev = qaEvent.payload.visualQaEvidence;
    expect(ev.status).toBe("skipped");
    expect(ev.totalChecks).toBe(0);
    expect(ev.failedChecks).toBe(0);
    expect(ev.errorCount).toBe(0);
    expect(ev.artifactCount).toBe(0);
  });
});
