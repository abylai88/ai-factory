import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation } from "../mission.js";
import { MissionState } from "../state.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import { MissionMemory, createMissionMemory } from "../mission-memory.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Helpers ──────────────────────────────────────────────────

async function setupMemory(delegations?: Array<{ title: string; status: string; result?: string; error?: string }>) {
  const mission = createMission("Build a Phaser game", {
    projectId: "test-game",
    engine: "web",
    stack: "phaser",
  });

  const stateDir = path.join(tmpDir, "state");
  await fs.mkdir(stateDir, { recursive: true });
  const state = new MissionState(stateDir, mission.id);
  await state.init();
  await state.setMission(mission);

  const eventSink = new InMemoryEventSink();

  if (delegations) {
    for (const del of delegations) {
      const d = createDelegation(mission.id, "obj-1", del.title, "ROLE: builder\nBUILD_COMMAND: echo ok", "engineering", {
        acceptanceCriteria: ["Build succeeds"],
      });
      await state.addDelegation(d);
      await state.completeDelegation(d.id, del.status as any, del.result, del.error);
    }
  }

  const memory = createMissionMemory(state, eventSink);
  return { memory, state, eventSink, mission };
}

// ── Tests ────────────────────────────────────────────────────

describe("MissionMemory", () => {
  describe("buildContextBlock()", () => {
    it("includes mission goal and context", async () => {
      const { memory } = await setupMemory();
      const block = memory.buildContextBlock();

      expect(block).toContain("MISSION CONTEXT");
      expect(block).toContain("Build a Phaser game");
      expect(block).toContain("Engine: web");
      expect(block).toContain("Stack: phaser");
    });

    it("includes completed delegations", async () => {
      const { memory } = await setupMemory([
        { title: "Build Project", status: "passed", result: "Build succeeded" },
      ]);
      const block = memory.buildContextBlock();

      expect(block).toContain("EXECUTION HISTORY");
      expect(block).toContain("Build Project");
      expect(block).toContain("PASSED");
    });

    it("includes failed delegations", async () => {
      const { memory } = await setupMemory([
        { title: "Fix Tests", status: "failed", error: "Test suite failed" },
      ]);
      const block = memory.buildContextBlock();

      expect(block).toContain("FAILED");
      expect(block).toContain("Fix Tests");
      expect(block).toContain("Test suite failed");
    });

    it("shows failed before completed", async () => {
      const { memory } = await setupMemory([
        { title: "Build Project", status: "passed", result: "OK" },
        { title: "Fix Tests", status: "failed", error: "Failed" },
      ]);
      const block = memory.buildContextBlock();
      const failedIdx = block.indexOf("FAILED");
      const passedIdx = block.indexOf("PASSED");

      expect(failedIdx).toBeLessThan(passedIdx);
    });

    it("includes validation errors from events", async () => {
      const { memory, eventSink, mission } = await setupMemory();
      eventSink.publish({
        missionId: mission.id,
        type: MissionEventTypes.DELEGATION_VALIDATION_FAILED,
        payload: { command: "npm run build", exitCode: 1, stderr: "TS2345: error" },
      });

      const block = memory.buildContextBlock();
      expect(block).toContain("VALIDATION ERRORS");
      expect(block).toContain("npm run build");
      expect(block).toContain("TS2345");
    });

    it("includes triage history from events", async () => {
      const { memory, eventSink, mission } = await setupMemory();
      eventSink.publish({
        missionId: mission.id,
        type: MissionEventTypes.DELEGATION_TRIAGE,
        payload: {
          category: "syntax_error",
          action: "repair",
          targetRole: "builder",
          reason: "Matched rule",
        },
      });

      const block = memory.buildContextBlock();
      expect(block).toContain("TRIAGE HISTORY");
      expect(block).toContain("syntax_error");
      expect(block).toContain("repair");
    });

    it("excludes specified delegation", async () => {
      const { memory, state } = await setupMemory([
        { title: "Build Project", status: "passed", result: "OK" },
      ]);

      // Get the delegation ID
      const delegations = state.getDelegations();
      const delId = delegations[0].id;

      const block = memory.buildContextBlock(delId);
      expect(block).not.toContain("Build Project");
    });

    it("respects maxContextChars limit", async () => {
      const { memory } = await setupMemory(
        Array.from({ length: 20 }, (_, i) => ({
          title: `Task ${i} with a very long title that goes on and on`,
          status: "passed",
          result: "A".repeat(500),
        }))
      );

      const block = memory.buildContextBlock();
      expect(block.length).toBeLessThanOrEqual(4500); // Allow some overhead
    });

    it("truncates long delegation results", async () => {
      const { memory } = await setupMemory([
        { title: "Build", status: "passed", result: "A".repeat(5000) },
      ]);

      const block = memory.buildContextBlock();
      expect(block).toContain("Build");
      // Should not contain the full 5000 char result
      expect(block).not.toContain("A".repeat(5000));
    });

    it("truncates long errors", async () => {
      const { memory } = await setupMemory([
        { title: "Fix", status: "failed", error: "E".repeat(500) },
      ]);

      const block = memory.buildContextBlock();
      // Error should be truncated to 200 chars
      expect(block).not.toContain("E".repeat(500));
    });
  });

  describe("createMissionMemory()", () => {
    it("creates a MissionMemory instance", async () => {
      const { memory } = await setupMemory();
      expect(memory).toBeInstanceOf(MissionMemory);
    });
  });
});
