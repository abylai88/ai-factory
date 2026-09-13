import * as pty from "node-pty";

export interface OpenCodeRunResult {
  code: number;
  output: string;
  timedOut: boolean;
  truncated?: boolean;
}

export interface OpenCodeRunConfig {
  model?: string;
  agent?: string;
  project: string;
  timeoutMs?: number;
  opencodeBin?: string;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_AGENT = "orchestrator";
const GRACEFUL_SHUTDOWN_MS = 5_000;
// Cap output at 10MB to prevent memory exhaustion from runaway agent output
const MAX_OUTPUT_CHARS = 10_000_000;

function resolveOpencodeBin(): string {
  return process.env.OPENCODE_BIN ?? "/home/asila/.opencode/bin/opencode";
}

export function runOpenCode(
  prompt: string,
  config: OpenCodeRunConfig,
  signal?: AbortSignal,
): Promise<OpenCodeRunResult> {
  const {
    model,
    agent = DEFAULT_AGENT,
    project,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    opencodeBin = resolveOpencodeBin(),
  } = config;

  const args = ["run", "--agent", agent];
  if (model) {
    args.push("-m", model);
  }
  args.push(prompt);

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

    const child = pty.spawn(opencodeBin, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      cwd: project,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? "/home/asila",
        PATH: `${process.env.OPENCODE_BIN_DIR ?? ""}${process.env.OPENCODE_BIN_DIR ? ":" : ""}${process.env.PATH ?? ""}`,
      },
    });

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
    });

    // Abort signal: terminate the PTY process
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
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
      killProcess();
      resolve({
        code: -1,
        output: output + "\n[Terminated: timeout exceeded]",
        timedOut: true,
        truncated,
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
        truncated,
      });
    });
  });
}
