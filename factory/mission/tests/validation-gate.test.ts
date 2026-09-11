import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ValidationGate, type ValidationConfig } from "../validation-gate.js";
import { createDelegation, createMission } from "../mission.js";

// ── Helpers ──────────────────────────────────────────────────

function makeMission() {
  return createMission("Test Mission");
}

function makeDelegation(missionId: string, overrides?: Partial<{ buildCommand: string; testCommand: string }>) {
  const desc = [
    "ROLE: builder",
    overrides?.buildCommand ? `BUILD_COMMAND: ${overrides.buildCommand}` : "",
    overrides?.testCommand ? `TEST_COMMAND: ${overrides.testCommand}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return createDelegation(missionId, "obj-1", "Build Project", desc, "engineering", {
    acceptanceCriteria: ["Build passes"],
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("ValidationGate", () => {
  let gate: ValidationGate;

  beforeEach(() => {
    gate = new ValidationGate({ timeoutMs: 5000 });
  });

  describe("validate()", () => {
    it("passes when no build or test command is configured", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id);

      const result = await gate.validate(delegation, mission, "/tmp");

      expect(result.passed).toBe(true);
      expect(result.command).toContain("no external validation");
    });

    it("passes when build command succeeds", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, { buildCommand: "echo ok" });

      const result = await gate.validate(delegation, mission, "/tmp");

      expect(result.passed).toBe(true);
      expect(result.command).toBe("echo ok");
      expect(result.exitCode).toBe(0);
    });

    it("fails when build command fails", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, { buildCommand: "false" });

      const result = await gate.validate(delegation, mission, "/tmp");

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("fails on build before running test", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, {
        buildCommand: "false",
        testCommand: "echo should-not-run",
      });

      const result = await gate.validate(delegation, mission, "/tmp");

      expect(result.passed).toBe(false);
      expect(result.command).toBe("false");
    });

    it("runs test when build passes", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, { buildCommand: "echo ok" });

      const result = await gate.validate(delegation, mission, "/tmp", {
        testCommand: "echo tests-passed",
      });

      expect(result.passed).toBe(true);
      expect(result.command).toBe("echo tests-passed");
    });

    it("fails when test command fails", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, { buildCommand: "echo ok" });

      const result = await gate.validate(delegation, mission, "/tmp", {
        testCommand: "false",
      });

      expect(result.passed).toBe(false);
      expect(result.command).toBe("false");
      expect(result.exitCode).toBe(1);
    });

    it("captures stdout and stderr from failed commands", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, {
        buildCommand: "node -e \"process.stdout.write('out'); process.stderr.write('err'); process.exit(1)\"",
      });

      const result = await gate.validate(delegation, mission, "/tmp");

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("uses config overrides for commands", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id);

      const result = await gate.validate(delegation, mission, "/tmp", {
        buildCommand: "echo overridden",
      });

      expect(result.passed).toBe(true);
      expect(result.command).toBe("echo overridden");
    });

    it("records duration", async () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, { buildCommand: "echo ok" });

      const result = await gate.validate(delegation, mission, "/tmp");

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("truncates output to maxOutputLength", async () => {
      const smallGate = new ValidationGate({ maxOutputLength: 10 });
      const mission = makeMission();
      const delegation = makeDelegation(mission.id, {
        buildCommand: 'echo "12345678901234567890"',
      });

      const result = await smallGate.validate(delegation, mission, "/tmp");

      expect(result.stdout.length).toBeLessThanOrEqual(10);
    });
  });

  describe("buildRepairContext()", () => {
    it("includes original task and validation failure", () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id);

      const context = gate.buildRepairContext(
        delegation,
        {
          passed: false,
          command: "npm run build",
          exitCode: 1,
          stdout: "",
          stderr: "Syntax error",
          durationMs: 1000,
        },
        1,
        3,
      );

      expect(context).toContain("repair agent");
      expect(context).toContain(delegation.title);
      expect(context).toContain("npm run build");
      expect(context).toContain("Syntax error");
      expect(context).toContain("1/3");
    });

    it("includes previous errors when provided", () => {
      const mission = makeMission();
      const delegation = makeDelegation(mission.id);

      const context = gate.buildRepairContext(
        delegation,
        {
          passed: false,
          command: "npm test",
          exitCode: 1,
          stdout: "",
          stderr: "Test failed",
          durationMs: 1000,
        },
        2,
        3,
        ["First attempt failed", "Second attempt failed"],
      );

      expect(context).toContain("PREVIOUS FAILED ATTEMPTS");
      expect(context).toContain("First attempt failed");
      expect(context).toContain("Second attempt failed");
      expect(context).toContain("2/3");
    });

    it("truncates long output in context", () => {
      const smallGate = new ValidationGate({ maxOutputLength: 20 });
      const mission = makeMission();
      const delegation = makeDelegation(mission.id);

      const context = smallGate.buildRepairContext(
        delegation,
        {
          passed: false,
          command: "npm run build",
          exitCode: 1,
          stdout: "A".repeat(100),
          stderr: "B".repeat(100),
          durationMs: 1000,
        },
        1,
        3,
      );

      expect(context.length).toBeLessThan(500);
    });
  });
});
