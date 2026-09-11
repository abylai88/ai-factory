import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Delegation, Mission } from "./mission.js";
import { extractMetadata } from "./adapters.js";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────

export interface ValidationResult {
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ValidationConfig {
  /** Build command to run (e.g., "npm run build"). Extracted from delegation metadata if not set. */
  buildCommand?: string;
  /** Test command to run (e.g., "npm test"). Extracted from delegation metadata if not set. */
  testCommand?: string;
  /** Timeout per command in ms (default: 120_000) */
  timeoutMs?: number;
  /** Max repair attempts before giving up (default: 3) */
  maxRepairAttempts?: number;
  /** Max stdout/stderr to capture in chars (default: 4000) */
  maxOutputLength?: number;
}

export interface ValidationContext {
  delegationId: string;
  missionId: string;
  attempt: number;
  maxAttempts: number;
  previousErrors?: string[];
}

// ── ValidationGate ───────────────────────────────────────────

/**
 * Runs independent build/test validation after an agent completes a delegation.
 *
 * If validation fails, returns structured failure context that can be fed
 * into a repair delegation. The gate is model-agnostic — it runs shell commands
 * directly, not via AI agents.
 */
export class ValidationGate {
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputLength: number;

  constructor(config?: { timeoutMs?: number; maxOutputLength?: number }) {
    this.defaultTimeoutMs = config?.timeoutMs ?? 120_000;
    this.maxOutputLength = config?.maxOutputLength ?? 4000;
  }

  /**
   * Run validation for a delegation. Extracts build/test commands from
   * delegation metadata or uses provided config overrides.
   */
  async validate(
    delegation: Delegation,
    mission: Mission,
    project: string,
    config?: ValidationConfig,
  ): Promise<ValidationResult> {
    const metadata = extractMetadata(delegation);
    const buildCmd = config?.buildCommand ?? metadata.buildCommand;
    const testCmd = config?.testCommand;

    // Run build first if a build command exists
    if (buildCmd) {
      const buildResult = await this.runCommand(buildCmd, project, config?.timeoutMs);
      if (!buildResult.passed) {
        return buildResult;
      }
      // If no test command, the build passed — return success
      if (!testCmd) {
        return buildResult;
      }
    }

    // Run tests if a test command exists
    if (testCmd) {
      const testResult = await this.runCommand(testCmd, project, config?.timeoutMs);
      return testResult;
    }

    // No build or test command — validation passes by default
    // (agent's own verification is the only check)
    return {
      passed: true,
      command: "(no external validation command configured)",
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 0,
    };
  }

  /**
   * Build a repair prompt from a failed validation result.
   * This is the context that gets fed into the repair delegation.
   */
  buildRepairContext(
    delegation: Delegation,
    validation: ValidationResult,
    attempt: number,
    maxAttempts: number,
    previousErrors?: string[],
  ): string {
    const parts = [
      `You are a repair agent. The previous delegation failed validation.`,
      ``,
      `ORIGINAL TASK:`,
      delegation.title,
      ``,
      `VALIDATION FAILURE:`,
      `Command: ${validation.command}`,
      `Exit code: ${validation.exitCode}`,
      ``,
      `STDOUT (last ${this.maxOutputLength} chars):`,
      validation.stdout.slice(-this.maxOutputLength),
      ``,
      `STDERR (last ${this.maxOutputLength} chars):`,
      validation.stderr.slice(-this.maxOutputLength),
    ];

    if (previousErrors && previousErrors.length > 0) {
      parts.push(``);
      parts.push(`PREVIOUS FAILED ATTEMPTS (${previousErrors.length}):`);
      for (const err of previousErrors) {
        parts.push(`- ${err.slice(0, 200)}`);
      }
    }

    parts.push(``);
    parts.push(`ATTEMPT: ${attempt}/${maxAttempts}`);
    parts.push(``);
    parts.push(`INSTRUCTIONS:`);
    parts.push(`1. Read the error output above carefully.`);
    parts.push(`2. Identify the root cause of the failure.`);
    parts.push(`3. Fix the code to resolve the error.`);
    parts.push(`4. Run the failing command yourself to verify the fix.`);
    parts.push(`5. Report what you changed.`);

    return parts.join("\n");
  }

  /**
   * Run a shell command and return a ValidationResult.
   */
  private async runCommand(
    command: string,
    cwd: string,
    timeoutMs?: number,
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const timeout = timeoutMs ?? this.defaultTimeoutMs;

    try {
      const parts = command.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      const result = await execFileAsync(cmd, args, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      });

      return {
        passed: true,
        command,
        exitCode: 0,
        stdout: (result.stdout ?? "").slice(0, this.maxOutputLength),
        stderr: (result.stderr ?? "").slice(0, this.maxOutputLength),
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const execError = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      return {
        passed: false,
        command,
        exitCode: execError.code ?? 1,
        stdout: (execError.stdout ?? "").slice(0, this.maxOutputLength),
        stderr: (execError.stderr ?? execError.message ?? "").slice(0, this.maxOutputLength),
        durationMs: Date.now() - startTime,
      };
    }
  }
}
