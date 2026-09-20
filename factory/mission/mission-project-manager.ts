import path from "node:path";
import {
  Mission,
  Delegation,
  AgentResult,
} from "./mission.js";
import { runGoal } from "../pipeline/pipeline-runner.js";
import type { EnsureProjectReadyResult } from "../roblox/project-ready.js";
import { recordProjectReadyEvidence } from "./readiness-evidence.js";
import { MissionState } from "./state.js";
import { ProjectProvisioner, ProjectHandle } from "./project-provisioner.js";
import { ensureProjectDependencies } from "../setup/project-bootstrap.js";
import { isRobloxProjectDir } from "../roblox/platform.js";

/**
 * MissionProjectManager — bridges mission context to project provisioning.
 *
 * Responsibilities:
 *   - Resolve or create the project workspace for a mission
 *   - Store the resolved project identity in mission context
 *   - Never accept arbitrary filesystem paths from external input
 *   - Only use allowlisted templates for new project creation
 */

export interface ProjectManagerConfig {
  baseDir: string;
  provisioner: ProjectProvisioner;
}

export interface ResolvedProject {
  projectId: string;
  projectPath: string;
  templateId?: string;
  isNew: boolean;
}

export class MissionProjectManager {
  private readonly config: ProjectManagerConfig;

  constructor(config: ProjectManagerConfig) {
    this.config = config;
  }

  /**
   * Resolve the project for a mission. If the mission already has a workspace
   * and it exists, use it. Otherwise provision a new project from the template.
   */
  async resolveProject(mission: Mission): Promise<ResolvedProject> {
    const existing = mission.context;
    if (existing?.workspace) {
      const validation = await this.config.provisioner.validateProject(existing.workspace);
      if (validation.valid) {
        return {
          projectId: existing.projectId ?? path.basename(existing.workspace),
          projectPath: existing.workspace,
          templateId: existing.template,
          isNew: false,
        };
      }
    }

    if (existing?.projectId) {
      const projectPath = path.join(this.config.baseDir, "projects", existing.projectId);
      const validation = await this.config.provisioner.validateProject(projectPath);
      if (validation.valid) {
        return {
          projectId: existing.projectId,
          projectPath,
          templateId: existing.template,
          isNew: false,
        };
      }
    }

    const templateId = existing?.template ?? "phaser-generic-web-template";
    const handle = await this.config.provisioner.provision(templateId, existing?.projectId);

    return {
      projectId: handle.projectId,
      projectPath: handle.projectPath,
      templateId: handle.templateId,
      isNew: true,
    };
  }
}

/**
 * MissionAwareFactoryAdapter — wraps the real factory execution with project
 * provisioning and context enrichment.
 *
 * This is the single adapter the Orchestrator uses. It:
 *   1. Resolves/creates the project workspace via MissionProjectManager
 *   2. Delegates actual pipeline execution to the underlying factory
 *   3. Records project identity in the AgentResult for downstream use
 */

export interface MissionAwareAdapterConfig {
  baseDir: string;
  projectManager: MissionProjectManager;
  missionState?: MissionState;
}

import { FactoryExecutionAdapter } from "./orchestrator.js";

export class MissionAwareFactoryAdapter implements FactoryExecutionAdapter {
  private readonly config: MissionAwareAdapterConfig;
  private readonly innerAdapter: InnerFactoryAdapter;

  constructor(config: MissionAwareAdapterConfig, innerAdapter?: InnerFactoryAdapter) {
    this.config = config;
    const ms = (config as MissionAwareAdapterConfig & { missionState?: MissionState }).missionState;
    this.innerAdapter = innerAdapter ?? new DefaultInnerFactoryAdapter(ms);
  }

  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string; model?: string; signal?: AbortSignal }
  ): Promise<AgentResult> {
    const resolved = await this.config.projectManager.resolveProject(mission);
    this._lastResolved = resolved;

    // Deterministic dependency recovery BEFORE delegating to the (expensive)
    // pipeline: if node_modules or required local binaries are missing,
    // reinstall from the project's own package.json/package-lock.json and
    // then proceed. A bootstrap failure is infrastructure — return it
    // directly instead of running agents into a broken workspace.
    // Roblox/Rojo projects have no npm lifecycle and skip this entirely.
    if (!(await isRobloxProjectDir(resolved.projectPath))) {
      const bootstrap = await ensureProjectDependencies(resolved.projectPath, {
        templateId: resolved.templateId,
      });
      if (!bootstrap.ok) {
        return {
          delegationId: delegation.id,
          status: "failed",
          output: "",
          error: bootstrap.error,
          durationMs: 0,
        };
      }
    }

    return this.innerAdapter.runDelegation(delegation, mission, {
      baseDir: config.baseDir,
      project: resolved.projectPath,
      fromStep: config.fromStep,
      model: config.model,
      signal: config.signal,
    });
  }

  getResolvedProject(): ResolvedProject | null {
    return this._lastResolved ?? null;
  }

  private _lastResolved: ResolvedProject | null = null;
}

/**
 * Inner factory adapter — the actual pipeline execution interface.
 * Separated from the provisioning wrapper for testability.
 */
export interface InnerFactoryAdapter {
  runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string; model?: string; signal?: AbortSignal }
  ): Promise<AgentResult>;
}

/**
 * Default inner adapter — calls the real runGoal() pipeline.
 */
export class DefaultInnerFactoryAdapter implements InnerFactoryAdapter {
  private readonly missionState: MissionState | undefined;

  constructor(missionState?: MissionState) {
    this.missionState = missionState;
  }

  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string; model?: string; signal?: AbortSignal }
  ): Promise<AgentResult> {
    const goalResult = await runGoal(
      delegation.description,
      config.baseDir,
      config.project,
      {
        pipelineType: delegation.pipelineType,
        fromStep: config.fromStep,
        engine: mission.context?.engine,
        stack: mission.context?.stack,
        template: mission.context?.template,
        workspace: mission.context?.workspace,
        model: config.model,
        signal: config.signal,
        onReadinessEvidence: this.missionState
          ? async (result: EnsureProjectReadyResult) => {
              if (result.ok) {
                await recordProjectReadyEvidence(this.missionState!, config.project, result);
              }
            }
          : undefined,
      }
    );

    return {
      delegationId: delegation.id,
      status: goalResult.status,
      output: goalResult.output,
      durationMs: 0,
    };
  }
}
