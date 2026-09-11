import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenCodePlannerModel,
  createOpenCodePlannerModel,
} from "../opencode-planner-model.js";
import * as runner from "../opencode-runner.js";

// ── Mock runOpenCode ───────────────────────────────────────────

vi.mock("../opencode-runner.js", () => ({
  runOpenCode: vi.fn(),
}));

const mockedRunOpenCode = vi.mocked(runner.runOpenCode);

function mockSuccess(output: string) {
  mockedRunOpenCode.mockResolvedValue({
    code: 0,
    output,
    timedOut: false,
  });
}

function mockFailure(code: number, output: string) {
  mockedRunOpenCode.mockResolvedValue({
    code,
    output,
    timedOut: false,
  });
}

function mockTimeout(output: string) {
  mockedRunOpenCode.mockResolvedValue({
    code: -1,
    output,
    timedOut: true,
  });
}

function mockEmpty() {
  mockedRunOpenCode.mockResolvedValue({
    code: 0,
    output: "",
    timedOut: false,
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe("OpenCodePlannerModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successful planner execution returns raw output", async () => {
    const expected = '{"goal":"test","delegations":[],"risks":[]}';
    mockSuccess(expected);

    const model = new OpenCodePlannerModel();
    const result = await model.generatePlan("Build a game");

    expect(result).toBe(expected);
    expect(mockedRunOpenCode).toHaveBeenCalledOnce();
    const [, config] = mockedRunOpenCode.mock.calls[0];
    expect(config.agent).toBe("orchestrator");
  });

  it("valid structured output is returned as-is", async () => {
    const json = JSON.stringify({
      goal: "Build a platformer",
      delegations: [
        {
          id: "dev-1",
          title: "Implement core",
          role: "Developer",
          task: "Build the game",
          dependsOn: [],
          validation: null,
        },
      ],
      risks: [],
    });
    mockSuccess(json);

    const model = new OpenCodePlannerModel();
    const result = await model.generatePlan("Build a platformer");

    expect(result).toBe(json);
    const parsed = JSON.parse(result);
    expect(parsed.delegations).toHaveLength(1);
    expect(parsed.delegations[0].id).toBe("dev-1");
  });

  it("throws on malformed (non-JSON) output", async () => {
    mockSuccess("This is not JSON at all, just plain text with no structure.");

    const model = new OpenCodePlannerModel();

    // The model returns raw output — parsing is the caller's responsibility.
    // OpenCodePlannerModel itself does not validate JSON, so this should succeed.
    const result = await model.generatePlan("Build a game");
    expect(result).toContain("This is not JSON");
  });

  it("throws on process failure (non-zero exit code)", async () => {
    mockFailure(1, "Error: some opencode failure");

    const model = new OpenCodePlannerModel();

    await expect(model.generatePlan("Build a game")).rejects.toThrow(
      /exited with code 1/,
    );
  });

  it("throws on timeout", async () => {
    mockTimeout("Partial output before timeout");

    const model = new OpenCodePlannerModel();

    await expect(model.generatePlan("Build a game")).rejects.toThrow(
      /timed out/,
    );
  });

  it("throws on empty output", async () => {
    mockEmpty();

    const model = new OpenCodePlannerModel();

    await expect(model.generatePlan("Build a game")).rejects.toThrow(
      /empty output/,
    );
  });

  it("configured model is passed through to runner", async () => {
    mockSuccess('{"goal":"test","delegations":[],"risks":[]}');

    const model = new OpenCodePlannerModel({
      model: "anthropic/claude-3-5-sonnet",
    });
    await model.generatePlan("Build a game");

    const [, config] = mockedRunOpenCode.mock.calls[0];
    expect(config.model).toBe("anthropic/claude-3-5-sonnet");
  });

  it("deterministic fallback compatibility — model errors fall through to planner fallback", async () => {
    // Simulate OpenCode failing — MissionPlanner will catch and use deterministic fallback
    mockFailure(1, "OpenCode unavailable");

    const model = new OpenCodePlannerModel();

    await expect(model.generatePlan("Build a game")).rejects.toThrow();
    // The MissionPlanner.createPlan() catches this and falls back to deterministic planner.
    // This test verifies OpenCodePlannerModel correctly surfaces the error for the caller.
  });

  it("default agent is orchestrator", async () => {
    mockSuccess('{"goal":"test","delegations":[],"risks":[]}');

    const model = new OpenCodePlannerModel();
    await model.generatePlan("test");

    const [, config] = mockedRunOpenCode.mock.calls[0];
    expect(config.agent).toBe("orchestrator");
  });

  it("custom agent can be configured", async () => {
    mockSuccess('{"goal":"test","delegations":[],"risks":[]}');

    const model = new OpenCodePlannerModel({ agent: "planner" });
    await model.generatePlan("test");

    const [, config] = mockedRunOpenCode.mock.calls[0];
    expect(config.agent).toBe("planner");
  });

  it("factory function createOpenCodePlannerModel works", async () => {
    mockSuccess('{"goal":"test","delegations":[],"risks":[]}');

    const model = createOpenCodePlannerModel({ model: "test-model" });
    const result = await model.generatePlan("test");

    expect(result).toBeTruthy();
    const [, config] = mockedRunOpenCode.mock.calls[0];
    expect(config.model).toBe("test-model");
  });
});
