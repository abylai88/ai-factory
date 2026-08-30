import { describe, it, expect } from "vitest";
import {
  PipelineRunner,
  PipelineRunnerConfig,
  StepExecutor,
  MAX_FIX_ITERATIONS
} from "../pipeline/pipeline-runner.js";
import { Pipeline, PipelineStep } from "../pipeline/pipeline.js";
import { Task } from "../task-manager/task-manager.js";

class MockExecutor implements StepExecutor {
  public executedSteps: string[] = [];

  async execute(task: Task, _contextText: string, _project: string): Promise<Task> {
    this.executedSteps.push(task.title);
    return {
      ...task,
      status: "passed",
      result: `Mock output for ${task.title}`,
      updatedAt: new Date().toISOString()
    };
  }
}

function makePipeline(steps?: Partial<PipelineStep>[]): Pipeline {
  const defaultSteps: PipelineStep[] = [
    { id: "market", title: "Market analysis", role: "research", agent: "market", description: "desc" },
    { id: "competitor", title: "Competitor analysis", role: "research", agent: "competitor", description: "desc" },
    { id: "idea", title: "Game concept", role: "game", agent: "idea", description: "desc" },
    { id: "director", title: "Game design document", role: "game", agent: "director", description: "desc" },
    { id: "implementation", title: "Implement game", role: "engineering", agent: "programmer", description: "desc" },
    { id: "test", title: "Test implementation", role: "qa", agent: "tester", description: "desc" }
  ];

  const merged = steps
    ? defaultSteps.map((d, i) => ({ ...d, ...(steps[i] ?? {}) }))
    : defaultSteps;

  return {
    id: "test-pipeline",
    name: "Test Pipeline",
    goal: "test goal",
    type: "game",
    steps: merged
  };
}

function makeConfig(overrides?: Partial<PipelineRunnerConfig>): PipelineRunnerConfig {
  return {
    baseDir: "/tmp/test-base",
    project: "/tmp/test-project",
    ...overrides
  };
}

describe("PipelineRunner --from-step", () => {
  it("from-step implementation: skips market, competitor, idea, director", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(
      makeConfig({ executor, fromStep: "implementation" })
    );

    const pipeline = makePipeline();
    await runner.run(pipeline);

    expect(executor.executedSteps).toEqual([
      "[5/6] Implement game",
      "[6/6] Test implementation"
    ]);
  });

  it("from-step director: skips market, competitor, idea", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(
      makeConfig({ executor, fromStep: "director" })
    );

    const pipeline = makePipeline();
    await runner.run(pipeline);

    expect(executor.executedSteps).toEqual([
      "[4/6] Game design document",
      "[5/6] Implement game",
      "[6/6] Test implementation"
    ]);
  });

  it("from-step market: runs all steps (first step)", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(
      makeConfig({ executor, fromStep: "market" })
    );

    const pipeline = makePipeline();
    await runner.run(pipeline);

    expect(executor.executedSteps).toEqual([
      "[1/6] Market analysis",
      "[2/6] Competitor analysis",
      "[3/6] Game concept",
      "[4/6] Game design document",
      "[5/6] Implement game",
      "[6/6] Test implementation"
    ]);
  });

  it("invalid from-step throws error with valid IDs", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(
      makeConfig({ executor, fromStep: "nonexistent" })
    );

    const pipeline = makePipeline();

    await expect(runner.run(pipeline)).rejects.toThrow(
      /Invalid --from-step "nonexistent"/
    );
    await expect(runner.run(pipeline)).rejects.toThrow(
      /Valid step IDs: market, competitor, idea, director, implementation, test/
    );
  });

  it("no from-step runs all steps from the beginning", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(makeConfig({ executor }));

    const pipeline = makePipeline();
    await runner.run(pipeline);

    expect(executor.executedSteps).toEqual([
      "[1/6] Market analysis",
      "[2/6] Competitor analysis",
      "[3/6] Game concept",
      "[4/6] Game design document",
      "[5/6] Implement game",
      "[6/6] Test implementation"
    ]);
  });

  it("from-step on last step runs only that step", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(
      makeConfig({ executor, fromStep: "test" })
    );

    const pipeline = makePipeline();
    await runner.run(pipeline);

    expect(executor.executedSteps).toEqual([
      "[6/6] Test implementation"
    ]);
  });

  it("from-step is case-sensitive", async () => {
    const executor = new MockExecutor();
    const runner = new PipelineRunner(
      makeConfig({ executor, fromStep: "Implementation" })
    );

    const pipeline = makePipeline();

    await expect(runner.run(pipeline)).rejects.toThrow(
      /Invalid --from-step "Implementation"/
    );
  });
});
