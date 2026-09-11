import * as pty from "node-pty";

export interface OpenCodeRunResult {
  code: number;
  output: string;
  timedOut: boolean;
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

function resolveOpencodeBin(): string {
  return process.env.OPENCODE_BIN ?? "/home/asila/.opencode/bin/opencode";
}

export function runOpenCode(
  prompt: string,
  config: OpenCodeRunConfig,
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

  return new Promise((resolve) => {
    let output = "";
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

    child.onData((data: string) => {
      output += data;
    });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be gone
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already be gone
        }
      }, GRACEFUL_SHUTDOWN_MS);
      resolve({
        code: -1,
        output: output + "\n[Terminated: timeout exceeded]",
        timedOut: true,
      });
    }, timeoutMs);

    child.onExit(({ exitCode }: { exitCode: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        code: exitCode ?? 1,
        output,
        timedOut: false,
      });
    });
  });
}
