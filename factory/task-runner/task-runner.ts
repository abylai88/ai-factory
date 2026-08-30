import * as pty from "node-pty";
import { TaskManager, Task } from "../task-manager/task-manager.js";
import {
  chooseModel,
  AgentRole,
  AttemptErrorType,
  AttemptResult,
  classifyError,
  isRetryableError
} from "../model-router/router.js";

export interface RunnerConfig {
  baseDir: string;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  project?: string;
}

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 120_000;

export const ROLE_TIMEOUTS_MS: Record<string, number> = {
  research: 180_000,
  designer: 240_000,
  game: 300_000,
  engineering: 300_000,
  programmer: 300_000,
  qa: 300_000,
  reviewer: 240_000,
  market: 180_000,
  competitor: 180_000,
  idea: 180_000,
  director: 300_000,
  gameplay: 240_000,
  content: 240_000,
  monetization: 180_000,
  architect: 300_000
};

const GRACEFUL_SHUTDOWN_MS = 5_000;

export class TaskRunner {
  private readonly manager: TaskManager;
  private readonly maxAttempts: number;
  private readonly explicitTimeoutMs: number | undefined;
  private readonly project: string;

  constructor(config: RunnerConfig) {
    if (!config.project && !process.env.AI_FACTORY_PROJECT) {
      throw new Error(
        "TaskRunner requires a project path. " +
          "Provide config.project or set the AI_FACTORY_PROJECT environment variable."
      );
    }

    this.project =
      config.project ??
      process.env.AI_FACTORY_PROJECT!;
    this.manager = new TaskManager(config.baseDir, this.project);
    this.maxAttempts = config.maxAttempts ?? 3;
    this.explicitTimeoutMs = config.attemptTimeoutMs;
  }

  async init(): Promise<void> {
    await this.manager.init();
  }

  getTimeoutForRole(role: string): number {
    if (this.explicitTimeoutMs !== undefined) {
      return this.explicitTimeoutMs;
    }
    return ROLE_TIMEOUTS_MS[role] ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  }

  private runOpenCode(
    model: string,
    taskAgent: string,
    prompt: string,
    project: string,
    timeoutMs: number
  ): Promise<{ code: number; output: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;

      console.log("\n========================================");
      console.log("AGENT START");
      console.log("MODEL:", model);
      console.log("PROJECT:", project);
      console.log("TIMEOUT:", timeoutMs, "ms");
      console.log("========================================\n");

      const child = pty.spawn(
        "/home/asila/.opencode/bin/opencode",
        [
          "run",
          "-m",
          model,
          "--agent",
          taskAgent,
          prompt
        ],
        {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd: project,
          env: {
            ...process.env,
            HOME: "/home/asila",
            PATH: `/home/asila/.opencode/bin:${process.env.PATH ?? ""}`
          }
        }
      );

      child.onData((data: string) => {
        output += data;
        process.stdout.write(data);
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.log(`\n[TIMEOUT] Agent exceeded ${timeoutMs}ms. Sending SIGTERM...`);

        try {
          child.kill("SIGTERM");
        } catch {
          // Process may already be gone
        }

        setTimeout(() => {
          if (!settled) return;
          // If still alive after grace period, SIGKILL
          try {
            child.kill("SIGKILL");
          } catch {
            // Process may already be gone
          }
        }, GRACEFUL_SHUTDOWN_MS);

        resolve({
          code: -1,
          output: output + "\n[Terminated: attempt timeout exceeded]",
          timedOut: true
        });
      }, timeoutMs);

      child.onExit(({ exitCode }: { exitCode: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          code: exitCode ?? 1,
          output,
          timedOut: false
        });
      });
    });
  }

  private agentForRole(role: string): string {
    const agents: Record<string, string> = {
      research: "researcher",
      designer: "designer",
      game: "designer",
      engineering: "builder",
      programmer: "programmer",
      qa: "tester",
      reviewer: "reviewer",
      market: "market",
      competitor: "competitor",
      idea: "idea",
      director: "director",
      gameplay: "gameplay",
      content: "content",
      monetization: "monetization",
      architect: "architect"
    };

    return agents[role] ?? "builder";
  }

  private classifyAttempt(
    result: { code: number; output: string; timedOut: boolean },
    model: string,
    attempt: number,
    timeoutMs: number
  ): AttemptResult {
    if (result.timedOut) {
      return {
        status: "failed",
        errorType: "timeout",
        errorMessage: `Agent timed out after ${timeoutMs}ms`,
        model,
        attempt,
        timedOut: true,
        retryable: true
      };
    }

    if (result.code === 0) {
      return {
        status: "success",
        errorType: "success",
        errorMessage: "",
        model,
        attempt,
        timedOut: false,
        retryable: false
      };
    }

    const errorType = classifyError(result.output, result.code);
    const retryable = isRetryableError(errorType);

    const errorMessage = result.output.slice(-500) || `Process exited with code ${result.code}`;

    return {
      status: "failed",
      errorType,
      errorMessage,
      model,
      attempt,
      timedOut: false,
      retryable
    };
  }

  async executeTask(task: Task): Promise<Task> {
    const project = this.project;

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║          TASK RUNNER                 ║");
    console.log("╚══════════════════════════════════════╝");

    console.log("\nTASK:", task.title);
    console.log("ROLE:", task.role);
    console.log("PROJECT:", project);

    const timeoutMs = this.getTimeoutForRole(task.role);
    console.log("TIMEOUT:", timeoutMs, "ms");

    await this.manager.updateTask(task.id, {
      status: "running",
      attempts: task.attempts + 1,
      error: undefined
    });

    const failedModels: string[] = [];
    const attemptHistory: AttemptResult[] = [];
    let lastAttemptResult: AttemptResult | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      console.log(`\nATTEMPT ${attempt}/${this.maxAttempts}`);

      const choice = chooseModel(
        task.role as AgentRole,
        failedModels
      );

      const prompt = `
You are an autonomous AI Factory agent.

ROLE:
${task.role}

TASK:
${task.title}

DESCRIPTION:
${task.description}

PROJECT:
${project}

RULES:
1. Inspect the project first.
2. Work only on this task.
3. Do not make unrelated changes.
4. If changes are required, implement them.
5. Verify your work.
6. Report exactly what you changed.
7. Report tests/build status.
`;

      const taskAgent = task.agent ?? this.agentForRole(task.role);

      const result = await this.runOpenCode(
        choice.model,
        taskAgent,
        prompt,
        project,
        timeoutMs
      );

      const attemptResult = this.classifyAttempt(result, choice.model, attempt, timeoutMs);
      attemptHistory.push(attemptResult);
      lastAttemptResult = attemptResult;

      console.log(`\nATTEMPT RESULT: ${attemptResult.errorType} (retryable: ${attemptResult.retryable})`);

      if (attemptResult.status === "success") {
        await this.manager.updateTask(task.id, {
          status: "passed",
          model: choice.model,
          result: result.output,
          attemptHistory: JSON.stringify(attemptHistory)
        });

        console.log("\nTASK PASSED");

        return this.manager.getTask(task.id)!;
      }

      failedModels.push(choice.model);

      if (attempt < this.maxAttempts && attemptResult.retryable) {
        console.log(`\nRetrying with next model (${failedModels.length} failed so far)...`);
      } else if (attempt < this.maxAttempts && !attemptResult.retryable) {
        console.log(`\nNon-retryable error (${attemptResult.errorType}). Stopping.`);
        break;
      }
    }

    const finalError = lastAttemptResult
      ? `${lastAttemptResult.errorType}: ${lastAttemptResult.errorMessage}`
      : "All model attempts failed.";

    await this.manager.updateTask(task.id, {
      status: "failed",
      error: finalError,
      attemptHistory: JSON.stringify(attemptHistory)
    });

    console.log(`\nTASK FAILED: ${finalError}`);

    return this.manager.getTask(task.id)!;
  }

  async runQueue(): Promise<Task[]> {
    const queued = this.manager.getQueuedTasks();

    console.log("\nQUEUED TASKS:", queued.length);

    const results: Task[] = [];

    for (const task of queued) {
      results.push(await this.executeTask(task));
    }

    return results;
  }

  getManager(): TaskManager {
    return this.manager;
  }
}
