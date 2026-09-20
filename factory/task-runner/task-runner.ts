import * as pty from "node-pty";
import path from "node:path";
import { TaskManager, Task } from "../task-manager/task-manager.js";
import {
  chooseModel,
  AgentRole,
  AttemptErrorType,
  AttemptResult,
  classifyError,
  isRetryableError
} from "../model-router/router.js";
import {
  ensureProjectDependencies,
  envWithLocalBin,
} from "../setup/project-bootstrap.js";
import { deployProjectConfig } from "../setup/project-setup.js";
import { isRobloxProjectDir } from "../roblox/platform.js";
import {
  ensureProjectReady,
  type EnsureProjectReadyOptions,
  type EnsureProjectReadyResult,
} from "../roblox/project-ready.js";
export type { EnsureProjectReadyResult };

export interface RunnerConfig {
  baseDir: string;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  /** Explicit timeout used for every Roblox attempt (overrides role map). */
  robloxTimeoutMs?: number;
  project?: string;
  /**
   * Provision the Roblox place artifact + ensure Studio readiness before
   * agent attempts (default true). Set false (or AI_FACTORY_ENSURE_STUDIO=0)
   * for pure source tasks that must not touch Studio.
   */
  ensureStudio?: boolean;
  /** Injectable readiness hook (unit tests stub this; production uses ensureProjectReady). */
  projectReadyFn?: (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>;
  /** Optional callback invoked after ensureProjectReady succeeds, for recording readiness evidence. */
  onReadinessEvidence?: (result: EnsureProjectReadyResult) => void;
}

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 120_000;

/**
 * Roblox attempts routinely exceed the generic browser/npm budgets: a real
 * Playtest cycle (open Studio → play → settle → runtime assertions →
 * screenshot → repair) plus Luau authoring can exceed 10 minutes. These
 * budgets default higher and are overridable per-run via
 * `AI_FACTORY_ROBLOX_TIMEOUT_MS` (or RunnerConfig.robloxTimeoutMs).
 */
export const ROBLOX_ATTEMPT_TIMEOUT_MS = 1_200_000;

/** Roles that can legitimately run a full Roblox Playtest/repair cycle. */
export const ROBLOX_ROLE_TIMEOUTS_MS: Record<string, number> = {
  programmer: 1_200_000,
  builder: 1_200_000,
  qa: 1_200_000,
  tester: 1_200_000,
  gameplay: 1_200_000,
  visual: 1_200_000,
  ui: 1_200_000,
  game: 1_200_000,
  engineering: 1_200_000,
  content: 1_200_000,
  architect: 900_000,
  director: 900_000,
};

export const ROLE_TIMEOUTS_MS: Record<string, number> = {
  research: 180_000,
  designer: 240_000,
  game: 300_000,
  engineering: 300_000,
  programmer: 300_000,
  qa: 300_000,
  reviewer: 240_000,
  market: 180_000,
  competitor: 120_000,
  idea: 180_000,
  director: 300_000,
  gameplay: 240_000,
  content: 240_000,
  monetization: 180_000,
  architect: 300_000
};

/** Platform used to pick the timeout budget for an attempt. */
export type AttemptPlatform = "roblox" | "web";

const GRACEFUL_SHUTDOWN_MS = 5_000;
// Cap output at 10MB to prevent memory exhaustion from runaway agent output
const MAX_OUTPUT_CHARS = 10_000_000;

export class TaskRunner {
  private readonly manager: TaskManager;
  private readonly maxAttempts: number;
  private readonly explicitTimeoutMs: number | undefined;
  private readonly robloxTimeoutMs: number;
  private readonly project: string;
  private readonly baseDir: string;
  private readonly ensureStudio: boolean;
  private readonly projectReadyFn: (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>;
  private readonly onReadinessEvidence?: (result: EnsureProjectReadyResult) => void;

  constructor(config: RunnerConfig) {
    if (!config.project && !process.env.AI_FACTORY_PROJECT) {
      throw new Error(
        "TaskRunner requires a project path. " +
          "Provide config.project or set the AI_FACTORY_PROJECT environment variable."
      );
    }

    this.baseDir = config.baseDir ?? process.cwd();
    this.project =
      config.project ?? process.env.AI_FACTORY_PROJECT!;
    this.manager = new TaskManager(config.baseDir, this.project);
    this.maxAttempts = config.maxAttempts ?? 3;
    this.explicitTimeoutMs = config.attemptTimeoutMs;
    this.ensureStudio =
      config.ensureStudio ?? process.env.AI_FACTORY_ENSURE_STUDIO !== "0";
    this.projectReadyFn = config.projectReadyFn ?? ensureProjectReady;
    this.onReadinessEvidence = config.onReadinessEvidence;
    const envRoblox = Number(process.env.AI_FACTORY_ROBLOX_TIMEOUT_MS);
    this.robloxTimeoutMs =
      config.robloxTimeoutMs ??
      (Number.isFinite(envRoblox) && envRoblox > 0 ? envRoblox : ROBLOX_ATTEMPT_TIMEOUT_MS);
  }

  async init(): Promise<void> {
    await this.manager.init();
  }

  /**
   * Timeout for one attempt. When `platform` is "roblox" the taller Roblox
   * budget is used so a real Playtest cycle is never killed mid-flight.
   */
  getTimeoutForRole(role: string, platform?: AttemptPlatform): number {
    if (this.explicitTimeoutMs !== undefined) {
      return this.explicitTimeoutMs;
    }
    if (platform === "roblox") {
      return ROBLOX_ROLE_TIMEOUTS_MS[role] ?? this.robloxTimeoutMs;
    }
    return ROLE_TIMEOUTS_MS[role] ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  }

  /**
   * Detect the target platform from disk. Presence of a Rojo
   * `default.project.json` is the unambiguous Roblox marker; anything else
   * keeps the historical web/npm budgets. Detection never throws — an
   * unreadable dir falls back to "web".
   */
  async detectPlatform(project: string = this.project): Promise<AttemptPlatform> {
    try {
      if (await isRobloxProjectDir(project)) return "roblox";
    } catch {
      // fall through to web
    }
    return "web";
  }

  /**
   * Roblox readiness gate: validate → Rojo artifact → Studio PLACE_READY.
   * Runs BEFORE any model attempt so infrastructure failures never consume
   * model rotation or enter code-repair loops. Web projects and
   * ensureStudio=false skip entirely (returned as skipped, never a call).
   */
  async ensureRobloxReadiness(
    project: string = this.project
  ): Promise<
    | { ok: true; skipped: true }
    | { ok: true; skipped?: false; result: EnsureProjectReadyResult }
    | { ok: false; error: string; result: EnsureProjectReadyResult }
  > {
    if (!this.ensureStudio) {
      return { ok: true, skipped: true };
    }
    if ((await this.detectPlatform(project)) !== "roblox") {
      return { ok: true, skipped: true };
    }
    const started = Date.now();
    let result: EnsureProjectReadyResult;
    try {
      result = await this.projectReadyFn(project, { projectDir: project });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`\nTASK BLOCKED (infrastructure): Roblox readiness threw: ${message}`);
      return {
        ok: false,
        error: `roblox_toolchain: project readiness threw after ${Date.now() - started}ms: ${message}`,
        result: { ok: false, code: "PROJECT_NOT_READY", reason: message },
      };
    }
    if (result.ok) {
      const state = result.state;
      const artifact = result.artifact;
      console.log(
        `\n[ROBLOX-READY] ${state} in ${Date.now() - started}ms ` +
          `(artifact: ${artifact.artifactPath}, ${artifact.sizeBytes} bytes${artifact.rebuilt ? ", rebuilt" : ", reused"}` +
          `${result.load ? `, load: ${result.load.message}` : ""})`
      );
      if (this.onReadinessEvidence) {
        try { this.onReadinessEvidence(result); } catch { /* evidence recording must not fail the readiness gate */ }
      }
      return { ok: true, result };
    }
    console.log(`\nTASK BLOCKED (infrastructure): ${result.reason}`);
    return { ok: false, error: result.reason, result };
  }

  private runOpenCode(
    model: string,
    taskAgent: string,
    prompt: string,
    project: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ code: number; output: string; timedOut: boolean; truncated?: boolean }> {
    // Reject immediately if already aborted
    if (signal?.aborted) {
      return Promise.resolve({
        code: -1,
        output: "",
        timedOut: false,
        truncated: false,
      });
    }

    return new Promise((resolve) => {
      let output = "";
      let truncated = false;
      let settled = false;

      console.log("\n========================================");
      console.log("AGENT START");
      console.log("MODEL:", model);
      console.log("PROJECT:", project);
      console.log("TIMEOUT:", timeoutMs, "ms");
      console.log("========================================\n");

      const openCodeConfig = project + "/opencode.json";

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
            // Enable the project's opencode.json config so the child process
            // discovers the robloxstudio MCP server definition (which references
            // {file:~/.robloxstudio-mcp/auth-token} — resolved at runtime from
            // the user's home directory, never hardcoded or emitted as a secret).
            OPENCODE_CONFIG: openCodeConfig,
            // Resolve build tools (webpack, tsc) from the PROJECT's own
            // node_modules first — never silently rely on global installs.
            PATH: `/home/asila/.opencode/bin:${envWithLocalBin(project).PATH ?? process.env.PATH ?? ""}`,
          }
        }
      );

      // Helper: kill process group or single process
      const killProcess = () => {
        const pid = child.pid;
        if (pid && pid > 0) {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            // Process group may already be gone
          }
        } else {
          try {
            child.kill("SIGTERM");
          } catch {
            // Process may already be gone
          }
        }
        setTimeout(() => {
          if (pid && pid > 0) {
            try {
              process.kill(-pid, "SIGKILL");
            } catch {
              // Process group may already be gone
            }
          } else {
            try {
              child.kill("SIGKILL");
            } catch {
              // Process may already be gone
            }
          }
        }, GRACEFUL_SHUTDOWN_MS);
      };

      child.onData((data: string) => {
        if (output.length + data.length > MAX_OUTPUT_CHARS) {
          if (!truncated) {
            output += "\n[Output truncated: exceeded " + MAX_OUTPUT_CHARS + " characters]";
            truncated = true;
          }
          // Stop accumulating but let process continue
          return;
        }
        output += data;
        process.stdout.write(data);
      });

      // Abort signal: terminate the PTY process
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        console.log("\n[ABORT] Mission abort signal received. Terminating agent...");
        killProcess();
        resolve({
          code: -1,
          output: output + "\n[Terminated: aborted]",
          timedOut: false,
          truncated,
        });
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener("abort", onAbort);
        console.log(`\n[TIMEOUT] Agent exceeded ${timeoutMs}ms. Sending SIGTERM...`);
        killProcess();
        resolve({
          code: -1,
          output: output + "\n[Terminated: attempt timeout exceeded]",
          timedOut: true,
          truncated
        });
      }, timeoutMs);

      child.onExit(({ exitCode }: { exitCode: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve({
          code: exitCode ?? 1,
          output,
          timedOut: false,
          truncated
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
      qa: "qa",
      tester: "tester",
      visual: "visual",
      ui: "ui",
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

  async executeTask(task: Task, signal?: AbortSignal): Promise<Task> {
    const project = this.project;

    console.log("\n╔══════════════════════════════════════╗");
    console.log("║          TASK RUNNER                 ║");
    console.log("╚══════════════════════════════════════╝");

    console.log("\nTASK:", task.title);
    console.log("ROLE:", task.role);
    console.log("PROJECT:", project);

    const platform = await this.detectPlatform(project);
    const timeoutMs = this.getTimeoutForRole(task.role, platform);
    console.log("PLATFORM:", platform);
    console.log("TIMEOUT:", timeoutMs, "ms");

    await this.manager.updateTask(task.id, {
      status: "running",
      attempts: task.attempts + 1,
      error: undefined
    });

    // Lightweight dependency preflight BEFORE any agent attempt: verify the
    // project has node_modules + required local binaries, recovering
    // deterministically (npm ci / npm install) when needed. A bootstrap
    // failure is infrastructure — report it directly WITHOUT consuming model
    // rotation attempts or sending it into agent repair loops.
    const bootstrap = await ensureProjectDependencies(project);
    if (!bootstrap.ok) {
      await this.manager.updateTask(task.id, {
        status: "failed",
        error: bootstrap.error,
      });
      console.log(`\nTASK BLOCKED (infrastructure): ${bootstrap.error}`);
      return this.manager.getTask(task.id)!;
    }
    if (bootstrap.installed) {
      console.log(
        `\n[BOOTSTRAP] Recovered project dependencies (${bootstrap.strategy}), retrying task normally.`
      );
    }

    // Synchronize the Factory root robloxstudio MCP into the project's
    // opencode.json so that child OpenCode processes launched via TaskRunner
    // can connect to the robloxstudio MCP bridge. This runs for both new
    // (scaffolded) and existing workspaces, non-destructively preserving
    // project-specific settings like small_model and disabled_providers.
    await deployProjectConfig(project, path.join(this.baseDir, "opencode.json"));

    // Roblox readiness gate: provision the .rbxlx artifact and ensure Studio
    // is loaded and ready BEFORE any model attempt. Infrastructure failures
    // are reported directly WITHOUT consuming model rotation attempts.
    // Web projects and ensureStudio=false skip inside ensureRobloxReadiness.
    {
      const readiness = await this.ensureRobloxReadiness(project);
      if (!readiness.ok) {
        await this.manager.updateTask(task.id, {
          status: "failed",
          error: readiness.error,
        });
        return this.manager.getTask(task.id)!;
      }
    }

    const failedModels: string[] = [];
    const attemptHistory: AttemptResult[] = [];
    let lastAttemptResult: AttemptResult | null = null;

    // If a model is pre-selected, seed failedModels so chooseModel picks the next one on retry
    if (task.model) {
      failedModels.push(task.model);
    }

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

INSTRUCTIONS:
1. Work in the PROJECT directory: ${project}
2. Read existing project files before making changes.
3. Follow the step-by-step workflow for your role.
4. Produce a concrete artifact or code changes.
5. Verify your work (build, typecheck, or file existence).
6. Stop after producing the artifact. Do not loop endlessly.
7. Report exactly what you did and the result.
`;

      const taskAgent = task.agent ?? this.agentForRole(task.role);

      const result = await this.runOpenCode(
        choice.model,
        taskAgent,
        prompt,
        project,
        timeoutMs,
        signal,
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
