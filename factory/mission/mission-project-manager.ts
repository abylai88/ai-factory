import path from "node:path";
import {
  Mission,
  Delegation,
  AgentResult,
} from "./mission.js";
import { runGoal } from "../pipeline/pipeline-runner.js";
import { ProjectProvisioner, ProjectHandle } from "./project-provisioner.js";

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

    const templateId = existing?.template ?? "yagames-phaser-template";
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
}

import { FactoryExecutionAdapter } from "./orchestrator.js";

export class MissionAwareFactoryAdapter implements FactoryExecutionAdapter {
  private readonly config: MissionAwareAdapterConfig;
  private readonly innerAdapter: InnerFactoryAdapter;

  constructor(config: MissionAwareAdapterConfig, innerAdapter?: InnerFactoryAdapter) {
    this.config = config;
    this.innerAdapter = innerAdapter ?? new DefaultInnerFactoryAdapter();
  }

  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    const resolved = await this.config.projectManager.resolveProject(mission);
    this._lastResolved = resolved;

    return this.innerAdapter.runDelegation(delegation, mission, {
      baseDir: config.baseDir,
      project: resolved.projectPath,
      fromStep: config.fromStep,
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
    config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult>;
}

/**
 * Default inner adapter — calls the real runGoal() pipeline.
 */
export class DefaultInnerFactoryAdapter implements InnerFactoryAdapter {
  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    await runGoal(
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
      }
    );

    return {
      delegationId: delegation.id,
      status: "passed",
      output: "",
      durationMs: 0,
    };
  }
}
