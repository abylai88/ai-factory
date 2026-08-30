import { randomUUID } from "node:crypto";
import { Task } from "../task-manager/task-manager.js";
import { StepExecutor } from "./pipeline-runner.js";
import { PipelineStep } from "./pipeline.js";

/**
 * Dry-run executor that exercises the orchestration logic (pipeline loop,
 * context handoff, TEST->BUGFIX->TEST retry, state persistence) WITHOUT
 * invoking real agents or modifying any project.
 *
 * It simulates agent completion based on the step's role/id. A `failTest`
 * flag makes the test/qa step fail the first `failUntilAttempt` times, which
 * is what exercises the bugfix loop.
 */
export interface DryRunExecutorConfig {
  /** Fail the test-like step this many times before it passes. 0 = always pass. */
  failTest?: number;
  /** Always fail all steps (to observe STOP/error behaviour). */
  failAll?: boolean;
  log?: boolean;
}

function isTestLike(step: PipelineStep): boolean {
  const role = (step.role ?? "").toLowerCase();
  return (
    role === "qa" ||
    role === "tester" ||
    role === "test" ||
    role === "validation"
  );
}

export class DryRunExecutor implements StepExecutor {
  private testFailuresRemaining: number;
  private readonly failAll: boolean;
  private readonly log: boolean;
  private readonly executions: string[] = [];

  constructor(config: DryRunExecutorConfig = {}) {
    this.testFailuresRemaining = config.failTest ?? 0;
    this.failAll = config.failAll ?? false;
    this.log = config.log ?? true;
  }

  async execute(
    task: Task,
    _contextText: string,
    _project: string
  ): Promise<Task> {
    const role = task.role;
    this.executions.push(`${task.title} :: ${role}`);

    let willPass = true;

    if (this.failAll) {
      willPass = false;
    } else if (isTestLike({ id: task.title, title: task.title, role: task.role, agent: task.agent ?? "" } as PipelineStep)) {
      if (this.testFailuresRemaining > 0) {
        this.testFailuresRemaining -= 1;
        willPass = false;
      }
    }

    if (this.log) {
      const marker = willPass ? "✅" : "❌";
      console.log(
        `   [DRY] ${marker} ${task.title} (agent=${task.agent ?? "?"}, role=${role})`
      );
    }

    return {
      ...task,
      status: willPass ? "passed" : "failed",
      result: willPass ? `DRY-RUN OUTPUT: ${task.title} completed successfully` : undefined,
      error: willPass ? undefined : `DRY-RUN simulated failure for: ${task.title}`,
      updatedAt: new Date().toISOString()
    };
  }
}
