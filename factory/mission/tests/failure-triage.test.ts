import { describe, it, expect } from "vitest";
import { classifyFailure, buildTriagePrompt, type TriageInput } from "../failure-triage.js";
import { createDelegation, createMission } from "../mission.js";

// ── Helpers ──────────────────────────────────────────────────

function makeDelegation(missionId: string) {
  return createDelegation(missionId, "obj-1", "Build Project", "ROLE: builder\nBUILD_COMMAND: npm run build", "engineering", {
    acceptanceCriteria: ["Build succeeds"],
  });
}

function makeInput(overrides: Partial<{
  stdout: string;
  stderr: string;
  exitCode: number;
  attempt: number;
  maxAttempts: number;
  previousErrors: string[];
}> = {}): TriageInput {
  const mission = createMission("Test");
  return {
    delegation: makeDelegation(mission.id),
    validationResult: {
      passed: false,
      command: overrides.exitCode === 0 ? "echo ok" : "npm run build",
      exitCode: overrides.exitCode ?? 1,
      stdout: overrides.stdout ?? "",
      stderr: overrides.stderr ?? "",
      durationMs: 1000,
    },
    attempt: overrides.attempt ?? 1,
    maxAttempts: overrides.maxAttempts ?? 3,
    previousErrors: overrides.previousErrors ?? [],
  };
}

// ── classifyFailure() Tests ─────────────────────────────────

describe("classifyFailure", () => {
  describe("syntax errors", () => {
    it("detects JavaScript SyntaxError", () => {
      const result = classifyFailure(makeInput({
        stderr: "SyntaxError: Unexpected token }",
      }));
      expect(result.category).toBe("syntax_error");
      expect(result.action).toBe("repair");
      expect(result.targetRole).toBe("builder");
      expect(result.priority).toBe("high");
    });

    it("detects JSON parse error", () => {
      const result = classifyFailure(makeInput({
        stderr: "SyntaxError: Unexpected token < in JSON at position 0",
      }));
      expect(result.category).toBe("syntax_error");
      expect(result.action).toBe("repair");
    });

    it("detects Unexpected end of input", () => {
      const result = classifyFailure(makeInput({
        stdout: "Unexpected end of input",
      }));
      expect(result.category).toBe("syntax_error");
      expect(result.action).toBe("repair");
    });
  });

  describe("type errors", () => {
    it("detects TypeScript TS2xxx error", () => {
      const result = classifyFailure(makeInput({
        stderr: "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'",
      }));
      expect(result.category).toBe("type_error");
      expect(result.action).toBe("repair");
      expect(result.targetRole).toBe("builder");
    });

    it("detects TypeScript TS2304 (cannot find name)", () => {
      const result = classifyFailure(makeInput({
        stderr: "error TS2304: Cannot find name 'React'",
      }));
      expect(result.category).toBe("type_error");
      expect(result.action).toBe("repair");
    });

    it("detects runtime TypeError", () => {
      const result = classifyFailure(makeInput({
        stderr: "TypeError: Cannot read properties of undefined",
      }));
      expect(result.category).toBe("type_error");
      expect(result.action).toBe("repair");
    });

    it("detects property does not exist error", () => {
      const result = classifyFailure(makeInput({
        stderr: "Property 'map' does not exist on type 'string'",
      }));
      expect(result.category).toBe("type_error");
      expect(result.action).toBe("repair");
    });
  });

  describe("test failures", () => {
    it("detects test assertion failure", () => {
      const result = classifyFailure(makeInput({
        stdout: "FAIL src/app.test.ts > should render correctly",
        stderr: "AssertionError: expected true to be false",
      }));
      expect(result.category).toBe("test_failure");
      expect(result.action).toBe("qa_analysis");
      expect(result.targetRole).toBe("tester");
      expect(result.priority).toBe("medium");
    });

    it("detects expect() failure", () => {
      const result = classifyFailure(makeInput({
        stdout: "expect(received).toBe(expected)",
      }));
      expect(result.category).toBe("test_failure");
      expect(result.action).toBe("qa_analysis");
    });

    it("detects vitest failure output", () => {
      const result = classifyFailure(makeInput({
        stderr: "Tests 3 failed | 12 passed",
      }));
      expect(result.category).toBe("test_failure");
      expect(result.action).toBe("qa_analysis");
    });
  });

  describe("dependency missing", () => {
    it("detects cannot find module", () => {
      const result = classifyFailure(makeInput({
        stderr: "Cannot find module 'phaser'",
      }));
      expect(result.category).toBe("dependency_missing");
      expect(result.action).toBe("research");
      expect(result.targetRole).toBe("researcher");
    });

    it("detects ERR_MODULE_NOT_FOUND", () => {
      const result = classifyFailure(makeInput({
        stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash'",
      }));
      expect(result.category).toBe("dependency_missing");
      expect(result.action).toBe("research");
    });

    it("detects npm ERESOLVE error", () => {
      const result = classifyFailure(makeInput({
        stderr: "npm ERR! code ERESOLVE\nnpm ERR! peer dep",
      }));
      expect(result.category).toBe("dependency_missing");
      expect(result.action).toBe("research");
    });
  });

  describe("build config", () => {
    it("detects tsconfig error", () => {
      const result = classifyFailure(makeInput({
        stderr: "tsconfig.json error: option 'strict' must be boolean",
      }));
      expect(result.category).toBe("build_config");
      expect(result.action).toBe("architect_review");
      expect(result.targetRole).toBe("architect");
    });

    it("detects webpack config error", () => {
      const result = classifyFailure(makeInput({
        stderr: "Module not found: Error: Can't resolve 'loader'",
      }));
      // This matches dependency_missing first (Module not found)
      expect(result.category).toBe("dependency_missing");
    });
  });

  describe("unknown / fallback", () => {
    it("returns unknown category for unrecognized errors", () => {
      const result = classifyFailure(makeInput({
        stderr: "Some random error message",
        exitCode: 1,
      }));
      expect(result.category).toBe("unknown");
      expect(result.action).toBe("repair");
      expect(result.targetRole).toBe("builder");
    });

    it("limits maxAttempts for unknown failures", () => {
      const result = classifyFailure(makeInput({
        stderr: "Unknown error",
        maxAttempts: 5,
      }));
      expect(result.maxAttempts).toBe(2);
    });
  });

  describe("rule priority", () => {
    it("syntax_error takes priority over type_error", () => {
      const result = classifyFailure(makeInput({
        stderr: "SyntaxError: Unexpected token\nAlso TS2345: type error",
      }));
      expect(result.category).toBe("syntax_error");
    });

    it("test_failure takes priority when only test patterns present", () => {
      const result = classifyFailure(makeInput({
        stderr: "AssertionError: test failed\nExpected: true\nReceived: false",
      }));
      expect(result.category).toBe("test_failure");
    });
  });
});

// ── buildTriagePrompt() Tests ───────────────────────────────

describe("buildTriagePrompt", () => {
  const mission = createMission("Test");
  const delegation = makeDelegation(mission.id);

  it("includes role header for repair action", () => {
    const prompt = buildTriagePrompt(
      delegation,
      { passed: false, command: "npm run build", exitCode: 2, stdout: "", stderr: "SyntaxError", durationMs: 100 },
      { action: "repair", targetRole: "builder", category: "syntax_error", reason: "test", priority: "high", maxAttempts: 3 },
      1,
      3,
    );
    expect(prompt).toContain("builder agent");
    expect(prompt).toContain("repair task");
    expect(prompt).toContain("SyntaxError");
  });

  it("includes role header for research action", () => {
    const prompt = buildTriagePrompt(
      delegation,
      { passed: false, command: "npm run build", exitCode: 1, stdout: "", stderr: "Cannot find module", durationMs: 100 },
      { action: "research", targetRole: "researcher", category: "dependency_missing", reason: "test", priority: "high", maxAttempts: 3 },
      1,
      3,
    );
    expect(prompt).toContain("researcher agent");
    expect(prompt).toContain("research task");
    expect(prompt).toContain("missing dependency");
  });

  it("includes previous errors when provided", () => {
    const prompt = buildTriagePrompt(
      delegation,
      { passed: false, command: "npm test", exitCode: 1, stdout: "", stderr: "FAIL", durationMs: 100 },
      { action: "qa_analysis", targetRole: "tester", category: "test_failure", reason: "test", priority: "medium", maxAttempts: 3 },
      2,
      3,
      ["First attempt failed", "Second attempt failed"],
    );
    expect(prompt).toContain("PREVIOUS FAILED ATTEMPTS");
    expect(prompt).toContain("First attempt failed");
  });

  it("truncates long output", () => {
    const prompt = buildTriagePrompt(
      delegation,
      { passed: false, command: "build", exitCode: 1, stdout: "A".repeat(5000), stderr: "B".repeat(5000), durationMs: 100 },
      { action: "repair", targetRole: "builder", category: "unknown", reason: "test", priority: "low", maxAttempts: 2 },
      1,
      2,
    );
    expect(prompt.length).toBeLessThan(8000);
  });
});
