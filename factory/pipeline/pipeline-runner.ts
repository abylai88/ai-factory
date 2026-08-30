import { randomUUID } from "node:crypto";
import { TaskRunner } from "../task-runner/task-runner.js";
import { Task } from "../task-manager/task-manager.js";
import { TaskContext } from "../context/task-context.js";
import {
  Pipeline,
  PipelineStep,
  PipelineType,
  selectPipeline
} from "./pipeline.js";

export const MAX_FIX_ITERATIONS = 5;

/**
 * Any component able to execute a pipeline step (an agent task).
 * The real implementation wraps TaskRunner; a dry-run/mock executor can be
 * injected to exercise orchestration logic without invoking real agents.
 */
export interface StepExecutor {
  execute(task: Task, contextText: string, project: string): Promise<Task>;
}

export interface PipelineRunnerConfig {
  baseDir: string;
  project: string;
  executor?: StepExecutor;
  maxFixIterations?: number;
  engine?: string;
  stack?: string;
  template?: string;
  workspace?: string;
  fromStep?: string;
}

function isTestStep(step: PipelineStep): boolean {
  const probe = `${step.id} ${step.role} ${step.agent}`.toLowerCase();
  return (
    probe.includes("test") ||
    probe.includes("tester") ||
    probe.includes("qa") ||
    probe.includes("validation") ||
    probe.includes("bugfix")
  );
}

/**
 * Detect whether a test-step's output text indicates failure, even when the
 * agent process exited with code 0.  OpenCode agents report their verdict in
 * a structured `STATUS: pass|fail|blocked` block at the end of their output.
 * We also look for explicit failure markers like "FAILURES:" or "BLOCKERS:".
 */
function outputIndicatesFailure(output: string): boolean {
  const lower = output.toLowerCase();
  const statusMatch = lower.match(/status:\s*(fail|blocked)\b/);
  if (statusMatch) return true;
  if (lower.includes("failures:") && lower.includes("confirmed bug")) return true;
  if (lower.includes("blockers:") && lower.includes("— critical")) return true;
  return false;
}

function isInfrastructureFailure(error?: string | null): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.startsWith("timeout:") ||
    lower.startsWith("rate_limit:") ||
    lower.includes("timed out") ||
    lower.includes("rate limit exceeded") ||
    lower.includes("no payment method") ||
    lower.startsWith("payment_error:")
  );
}

export class RealExecutor implements StepExecutor {
  private runner: TaskRunner;

  constructor(baseDir: string, project: string) {
    this.runner = new TaskRunner({ baseDir, project, maxAttempts: 3 });
  }

  async init(): Promise<void> {
    await this.runner.init();
  }

  async execute(
    task: Task,
    _contextText: string,
    _project: string
  ): Promise<Task> {
    return this.runner.executeTask(task);
  }

  createTask(
    title: string,
    description: string,
    role: string,
    model?: string,
    agent?: string
  ): Promise<Task> {
    return this.runner.getManager().createTask(title, description, role, model, agent);
  }
}

export class PipelineRunner {
  private readonly executor: StepExecutor;
  private readonly baseDir: string;
  private readonly project: string;
  private readonly maxFixIterations: number;
  private readonly fromStep?: string;
  private readonly setup: {
    engine?: string;
    stack?: string;
    template?: string;
    workspace?: string;
  };

  constructor(config: PipelineRunnerConfig) {
    this.baseDir = config.baseDir;
    this.project = config.project;
    this.maxFixIterations = config.maxFixIterations ?? MAX_FIX_ITERATIONS;
    this.fromStep = config.fromStep;
    this.executor =
      config.executor ?? new RealExecutor(config.baseDir, config.project);
    this.setup = {
      engine: config.engine,
      stack: config.stack,
      template: config.template,
      workspace: config.workspace
    };
  }

  async init(): Promise<void> {
    if (this.executor instanceof RealExecutor) {
      await (this.executor as RealExecutor).init();
    }
  }

  private isRealExecutor(): boolean {
    return this.executor instanceof RealExecutor;
  }

  private async createStepTask(
    step: PipelineStep,
    index: number,
    total: number,
    contextText: string
  ): Promise<Task> {
    const description = `
PIPELINE GOAL:
${step.description}

CURRENT STEP:
${step.description}

PREVIOUS AGENT RESULTS:
${contextText}

PROJECT:
${this.project}

IMPORTANT:
- Respect the current step role.
- Use previous results as context.
- Verify important claims yourself.
- Do not assume previous agents were correct.
- Do not perform unrelated work.
- At the end provide a concise structured report.
`;

    if (this.isRealExecutor()) {
      return (this.executor as RealExecutor).createTask(
        `[${index + 1}/${total}] ${step.title}`,
        description,
        step.role,
        undefined,
        step.agent
      );
    }

    return {
      id: randomUUID(),
      title: `[${index + 1}/${total}] ${step.title}`,
      description,
      role: step.role,
      agent: step.agent,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0
    };
  }

  private async runBugfixLoop(
    context: TaskContext,
    failingStep: PipelineStep,
    stepIndex: number,
    total: number,
    failureReason: string
  ): Promise<Task> {
    const testContext = context.buildContext();

    for (
      let iteration = 1;
      iteration <= this.maxFixIterations;
      iteration++
    ) {
      console.log(
        `\n🔧 BUGFIX ITERATION ${iteration}/${this.maxFixIterations}`
      );

      const bugfixDescription = `
PIPELINE GOAL: fix the failing validation step "${failingStep.id}".

The previous agent output failed validation. Fix the underlying cause.

FAILING STEP: ${failingStep.title} (${failingStep.role}/${failingStep.agent})

VALIDATION FAILURE OUTPUT:
${failureReason.slice(0, 12000)}

FIX ITERATION: ${iteration}/${this.maxFixIterations}

PROJECT:
${this.project}

CONTEXT:
${testContext.slice(0, 20000)}

IMPORTANT:
- Diagnose the root cause of the failure.
- Apply the minimal safe fix in the project.
- Do not change unrelated code.
- Verify your fix.
- At the end report what you changed and the validation result.
`;

      const fixTask = await this.createFixTask(
        bugfixDescription,
        iteration
      );

      const fixResult = await this.executor.execute(
        fixTask,
        testContext,
        this.project
      );

      await context.recordBugfixIteration();

      if (fixResult.status === "passed") {
        console.log(
          `✅ BUGFIX ${iteration} APPLIED, re-running validation "${failingStep.id}"...`
        );
      } else {
        await context.addError(
          `Bugfix iteration ${iteration} failed: ${
            fixResult.error ?? fixResult.result ?? "no output"
          }`,
          `${failingStep.id}:bugfix`
        );
        console.log(
          `\n❌ BUGFIX ${iteration} FAILED → stopping, aborting loop to avoid blind retries.`
        );
        return fixResult;
      }

      const retest = await this.createStepTask(
        failingStep,
        stepIndex,
        total,
        testContext
      );

      const retestResult = await this.executor.execute(
        retest,
        testContext,
        this.project
      );

      // Same output-based failure detection for retest steps
      const retestEffectiveStatus =
        retestResult.status === "passed" &&
        outputIndicatesFailure(retestResult.result ?? retestResult.error ?? "")
          ? "failed"
          : retestResult.status;

      const retestEffectiveResult =
        retestEffectiveStatus !== retestResult.status
          ? { ...retestResult, status: retestEffectiveStatus as Task["status"] }
          : retestResult;

      await context.add({
        stepId: `${failingStep.id}:retest-${iteration}`,
        title: `Retest ${failingStep.title} (iteration ${iteration})`,
        role: failingStep.role,
        status: retestEffectiveResult.status,
        output: (
          retestEffectiveResult.result ?? retestEffectiveResult.error ?? "No output"
        ).slice(0, 12000)
      });

      if (retestEffectiveResult.status === "passed") {
        console.log(
          `\n✅ VALIDATION PASSED after bugfix iteration ${iteration}`
        );
        return retestEffectiveResult;
      }

      await context.addError(
        `Validation "${failingStep.id}" failed in bugfix iteration ${iteration}: ${
          retestEffectiveResult.error ?? retestEffectiveResult.result ?? "still failing"
        }`,
        `${failingStep.id}:retest-${iteration}`
      );

      failureReason =
        retestEffectiveResult.error ?? retestEffectiveResult.result ?? "still failing";
    }

    await context.addError(
      `Validation "${failingStep.id}" still failing after ${this.maxFixIterations} fix iterations.`
    );

    return {
      id: randomUUID(),
      title: `retest-${failingStep.id}`,
      description: "",
      role: failingStep.role,
      status: "failed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      error: `Exceeded max fix iterations (${this.maxFixIterations}).`
    };
  }

  private async createFixTask(
    description: string,
    iteration: number
  ): Promise<Task> {
    if (this.isRealExecutor()) {
      return (this.executor as RealExecutor).createTask(
        `[BUGFIX ${iteration}] Fix failing validation`,
        description,
        "engineering",
        undefined,
        "builder"
      );
    }

    return {
      id: randomUUID(),
      title: `[BUGFIX ${iteration}] Fix failing validation`,
      description,
      role: "engineering",
      agent: "builder",
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0
    };
  }

  async run(pipeline: Pipeline): Promise<void> {
    // Validate fromStep if provided
    let startIndex = 0;
    if (this.fromStep) {
      const foundIndex = pipeline.steps.findIndex(s => s.id === this.fromStep);
      if (foundIndex === -1) {
        const validIds = pipeline.steps.map(s => s.id).join(", ");
        throw new Error(
          `Invalid --from-step "${this.fromStep}". Valid step IDs: ${validIds}`
        );
      }
      startIndex = foundIndex;
    }

    const context = new TaskContext(
      this.baseDir,
      pipeline.id,
      {
        goal: pipeline.goal,
        project: this.project,
        maxFixIterations: this.maxFixIterations,
        engine: this.setup.engine,
        stack: this.setup.stack,
        template: this.setup.template,
        workspace: this.setup.workspace
      }
    );

    await context.init();

    console.log(`
╔══════════════════════════════════════╗
║       🔗 PIPELINE RUNNER             ║
╚══════════════════════════════════════╝
`);

    console.log("🎯 GOAL:", pipeline.goal);
    console.log("📋 PIPELINE:", pipeline.name, `(${pipeline.type})`);
    console.log("📁 PROJECT:", this.project);
    console.log("📋 STEPS:", pipeline.steps.length);
    console.log(`🔧 MAX FIX ITERATIONS: ${this.maxFixIterations}`);

    if (this.fromStep) {
      console.log(`⏭️  RESUME FROM STEP: ${this.fromStep} (skipping ${startIndex} earlier steps)`);
    }

    const total = pipeline.steps.length;

    for (
      let index = startIndex;
      index < total;
      index++
    ) {
      const step = pipeline.steps[index];

      await context.updateState({
        currentStepId: step.id,
        status: "running",
        finishedAt: undefined
      });

      const contextText = context.buildContext();

      const stepTask = await this.createStepTask(
        step,
        index,
        total,
        contextText
      );

      console.log(
        `\n▶ STEP ${index + 1}/${total}: ${step.title}`
      );
      console.log(`🤖 AGENT: ${step.agent}`);

      const result = await this.executor.execute(
        stepTask,
        contextText,
        this.project
      );

      // For test-like steps, detect failure from agent output text even when
      // the agent process exited with code 0 (the agent "successfully" reported
      // a failure).
      const effectiveStatus =
        result.status === "passed" &&
        isTestStep(step) &&
        outputIndicatesFailure(result.result ?? result.error ?? "")
          ? "failed"
          : result.status;

      const effectiveResult =
        effectiveStatus !== result.status
          ? { ...result, status: effectiveStatus as Task["status"] }
          : result;

      await context.add({
        stepId: step.id,
        title: step.title,
        role: step.role,
        status: effectiveResult.status,
        output: (
          effectiveResult.result ?? effectiveResult.error ?? "No output"
        ).slice(0, 12000)
      });

      if (effectiveResult.status === "passed") {
        console.log(`\n✅ STEP COMPLETE: ${step.id}`);
        continue;
      }

      const failureReason =
        effectiveResult.error ?? effectiveResult.result ?? `Step "${step.id}" failed with no output.`;

      if (isInfrastructureFailure(effectiveResult.error)) {
        console.log(
          `\n⚠️  STEP "${step.id}" FAILED (infrastructure: ${effectiveResult.error?.split(":")[0]}) — not a project bug.`
        );
        await context.addError(
          `Infrastructure failure at step "${step.id}": ${failureReason}`,
          step.id
        );
        console.log(`\n🛑 PIPELINE BLOCKED AT: ${step.id} (infrastructure failure)`);
        console.log(`STATUS: blocked`);
        return;
      }

      if (isTestStep(step)) {
        console.log(
          `\n⚠️  VALIDATION STEP "${step.id}" FAILED → entering TEST→BUGFIX→TEST loop.`
        );
        await context.addError(
          `Validation step "${step.id}" failed: ${failureReason}`,
          step.id
        );
        const retest = await this.runBugfixLoop(
          context,
          step,
          index,
          total,
          failureReason
        );

        if (retest.status === "passed") {
          await context.setSuccess();
          console.log(`\n✅ STEP ${step.id} PASSED after bugfix cycle.`);
          continue;
        }

        await context.addError(
          `Step "${step.id}" failed after bugfix loop: ${retest.error ?? "no output"}`,
          step.id
        );
        console.log(`\n🛑 PIPELINE FAILED AT: ${step.id} (after bugfix loop)`);
        return;
      }

      await context.addError(
        `Step "${step.id}" failed irrecoverably: ${failureReason}`,
        step.id
      );
      console.log(`\n🛑 PIPELINE STOPPED AT: ${step.id}`);
      console.log(`STATUS: failed`);
      return;
    }

    await context.setSuccess();

    console.log(`
╔══════════════════════════════════════╗
║        ✅ PIPELINE COMPLETE          ║
╚══════════════════════════════════════╝
`);
  }
}

export async function runGoal(
  goal: string,
  baseDir: string,
  project: string,
  opts?: {
    maxFixIterations?: number;
    executor?: StepExecutor;
    engine?: string;
    stack?: string;
    template?: string;
    workspace?: string;
    pipelineType?: PipelineType;
    fromStep?: string;
  }
): Promise<void> {
  const pipelineId = randomUUID().slice(0, 8);

  const pipeline = selectPipeline(goal, opts?.pipelineType);
  pipeline.id = `${pipeline.type}-${pipelineId}`;

  const runner = new PipelineRunner({
    baseDir,
    project,
    executor: opts?.executor,
    maxFixIterations: opts?.maxFixIterations ?? MAX_FIX_ITERATIONS,
    engine: opts?.engine,
    stack: opts?.stack,
    template: opts?.template,
    workspace: opts?.workspace,
    fromStep: opts?.fromStep
  });

  await runner.init();

  await runner.run(pipeline);
}
