import { promises as fs } from "node:fs";
import path from "node:path";

export type PipelineRunStatus =
  | "running"
  | "passed"
  | "failed";

export interface StateError {
  stepId?: string;
  message: string;
  iteration?: number;
  timestamp: string;
}

export interface PipelineState {
  pipelineId: string;
  goal: string;
  project: string;
  status: PipelineRunStatus;
  engine?: string;
  stack?: string;
  template?: string;
  workspace?: string;
  currentStepId?: string;
  startedAt: string;
  finishedAt?: string;
  bugfixIterations: number;
  maxFixIterations: number;
  errors: StateError[];
}

export interface ContextEntry {
  stepId: string;
  title: string;
  role: string;
  status: string;
  output: string;
  timestamp: string;
}

interface PersistedFile {
  state: PipelineState;
  entries: ContextEntry[];
}

export class TaskContext {
  private readonly filePath: string;
  private entries: ContextEntry[] = [];
  private state: PipelineState;

  constructor(
    baseDir: string,
    pipelineId: string,
    opts?: {
      goal?: string;
      project?: string;
      maxFixIterations?: number;
      engine?: string;
      stack?: string;
      template?: string;
      workspace?: string;
    }
  ) {
    this.filePath = path.join(
      baseDir,
      "outputs",
      "pipelines",
      `${pipelineId}.json`
    );

    this.state = {
      pipelineId,
      goal: opts?.goal ?? "",
      project: opts?.project ?? "",
      engine: opts?.engine,
      stack: opts?.stack,
      template: opts?.template,
      workspace: opts?.workspace,
      status: "running",
      startedAt: new Date().toISOString(),
      bugfixIterations: 0,
      maxFixIterations: opts?.maxFixIterations ?? 5,
      errors: []
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), {
      recursive: true
    });

    try {
      const data = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        this.entries = parsed as ContextEntry[];
      } else {
        const file = parsed as PersistedFile;
        this.entries = file.entries ?? [];
        if (file.state) {
          this.state = { ...this.state, ...file.state };
        }
      }
    } catch {
      this.entries = [];
      await this.save();
    }
  }

  private async save(): Promise<void> {
    const file: PersistedFile = {
      state: this.state,
      entries: this.entries
    };

    await fs.writeFile(
      this.filePath,
      JSON.stringify(file, null, 2),
      "utf8"
    );
  }

  async add(entry: Omit<ContextEntry, "timestamp">): Promise<void> {
    this.entries.push({
      ...entry,
      timestamp: new Date().toISOString()
    });

    await this.save();
  }

  async updateState(patch: Partial<PipelineState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    await this.save();
  }

  async setSuccess(): Promise<void> {
    await this.updateState({
      status: "passed",
      finishedAt: new Date().toISOString()
    });
  }

  async setFailed(error?: string): Promise<void> {
    await this.updateState({
      status: "failed",
      finishedAt: new Date().toISOString(),
      ...(error ? { errors: this.state.errors } : {})
    });
  }

  async addError(message: string, stepId?: string): Promise<void> {
    this.state.errors.push({
      stepId,
      message,
      ...(this.state.bugfixIterations > 0
        ? { iteration: this.state.bugfixIterations }
        : {}),
      timestamp: new Date().toISOString()
    });

    this.state.status = "failed";
    await this.save();
  }

  async recordBugfixIteration(): Promise<void> {
    this.state.bugfixIterations += 1;
    await this.save();
  }

  getState(): PipelineState {
    return this.state;
  }

  buildContext(maxChars = 30000): string {
    if (this.entries.length === 0) {
      return "No previous pipeline results.";
    }

    let text = "PREVIOUS PIPELINE RESULTS:\n\n";

    for (const entry of this.entries) {
      const section = [
        `STEP: ${entry.stepId}`,
        `TITLE: ${entry.title}`,
        `ROLE: ${entry.role}`,
        `STATUS: ${entry.status}`,
        "OUTPUT:",
        entry.output,
        ""
      ].join("\n");

      if (text.length + section.length > maxChars) {
        text += "[Earlier context truncated.]\n";
        break;
      }

      text += section;
    }

    return text;
  }
}
