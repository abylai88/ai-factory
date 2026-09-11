import type { PlanningModel } from "./mission-planner.js";
import { runOpenCode, type OpenCodeRunConfig } from "./opencode-runner.js";

export interface OpenCodePlannerConfig {
  agent?: string;
  model?: string;
  timeoutMs?: number;
  opencodeBin?: string;
  projectDir?: string;
}

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * OpenCode-backed PlanningModel that sends planning prompts to the OpenCode CLI
 * and returns the structured JSON response for MissionPlanner to parse.
 */
export class OpenCodePlannerModel implements PlanningModel {
  private readonly config: OpenCodePlannerConfig;

  constructor(config: OpenCodePlannerConfig = {}) {
    this.config = config;
  }

  async generatePlan(prompt: string): Promise<string> {
    const runConfig: OpenCodeRunConfig = {
      model: this.config.model,
      agent: this.config.agent ?? "orchestrator",
      project: this.config.projectDir ?? process.cwd(),
      timeoutMs: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      opencodeBin: this.config.opencodeBin,
    };

    const result = await runOpenCode(prompt, runConfig);

    if (result.timedOut) {
      throw new Error(
        `OpenCode planner timed out after ${runConfig.timeoutMs}ms`,
      );
    }

    if (result.code !== 0) {
      throw new Error(
        `OpenCode planner exited with code ${result.code}: ${result.output.slice(-500)}`,
      );
    }

    if (!result.output || result.output.trim().length === 0) {
      throw new Error("OpenCode planner returned empty output");
    }

    return result.output;
  }
}

export function createOpenCodePlannerModel(
  config?: OpenCodePlannerConfig,
): OpenCodePlannerModel {
  return new OpenCodePlannerModel(config);
}
