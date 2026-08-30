import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FactoryEvent } from "../../shared/src/index.js";
import { ArtifactStore } from "./artifact-store.js";
import { launchProject } from "./project-launcher.js";
import { loadProjectManifest, listSupportedProjects, resolveProjectPath } from "./project-registry.js";
import { runTrafficDodgeSmoke } from "./smoke-runner.js";
import type {
  VisualQaRun,
  VisualQaRunRequest,
  VisualQaServiceStatus
} from "./types.js";
import { DEFAULT_VIEWPORTS, resolveViewports } from "./viewports.js";

export type VisualQaEventPublisher = (event: Omit<FactoryEvent, "id" | "occurredAt">) => void;

export interface PlaywrightVisualQaOptions {
  factoryRoot: string;
  artifactsDir?: string;
  publish?: VisualQaEventPublisher;
}

export class PlaywrightVisualQAService {
  private readonly artifactStore: ArtifactStore;
  private readonly runs = new Map<string, VisualQaRun>();
  private lastRun?: VisualQaRun;
  private readonly options: PlaywrightVisualQaOptions;

  constructor(options: PlaywrightVisualQaOptions) {
    this.options = options;
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    this.artifactStore = new ArtifactStore(options.artifactsDir ?? path.resolve(moduleDir, "../artifacts"));
  }

  async init() {
    await this.artifactStore.init();
  }

  async getStatus(): Promise<VisualQaServiceStatus> {
    const projects = await listSupportedProjects();
    return {
      available: true,
      message: "Playwright Visual QA is available for allowlisted projects.",
      supportedProjects: projects.map(p => ({ id: p.id, name: p.name, scenarios: p.scenarios })),
      defaultViewports: DEFAULT_VIEWPORTS.map(v => v.label),
      lastRun: this.lastRun
    };
  }

  async run(request: VisualQaRunRequest): Promise<VisualQaRun> {
    const manifest = await loadProjectManifest(request.projectId);
    if (!manifest) {
      throw new Error("Project is not allowlisted for Visual QA");
    }
    const scenario = request.scenario ?? manifest.defaultScenario;
    if (!manifest.scenarios.includes(scenario)) {
      throw new Error("Scenario is not supported for this project");
    }

    const runId = `run-${randomUUID()}`;
    const viewports = resolveViewports(request.viewports).map(v => v.label);
    const run: VisualQaRun = {
      runId,
      projectId: request.projectId,
      scenario,
      status: "queued",
      startedAt: new Date().toISOString(),
      viewports,
      checks: [],
      artifacts: [],
      errors: []
    };
    this.runs.set(runId, run);
    void this.executeRun(run, request.traceOnFailure ?? true);
    return run;
  }

  async getResults(runId: string) {
    return this.runs.get(runId) ?? await this.artifactStore.loadRunResult(runId);
  }

  async getScreenshots(runId: string) {
    const run = await this.getResults(runId);
    return run?.artifacts.filter(a => a.type === "screenshot") ?? [];
  }

  async getArtifacts(runId: string) {
    const run = await this.getResults(runId);
    return run?.artifacts ?? this.artifactStore.listForRun(runId);
  }

  getArtifactStore() {
    return this.artifactStore;
  }

  private publish(event: Omit<FactoryEvent, "id" | "occurredAt">) {
    this.options.publish?.(event);
  }

  private async executeRun(run: VisualQaRun, traceOnFailure: boolean) {
    run.status = "running";
    this.publish({
      type: "visual_qa.started",
      severity: "info",
      projectId: run.projectId,
      payload: { runId: run.runId, scenario: run.scenario, viewports: run.viewports }
    });

    const manifest = await loadProjectManifest(run.projectId);
    if (!manifest) {
      run.status = "error";
      run.finishedAt = new Date().toISOString();
      run.failureSummary = "Project manifest missing";
      return;
    }

    const projectPath = resolveProjectPath(this.options.factoryRoot, manifest);
    if (!projectPath) {
      run.status = "error";
      run.finishedAt = new Date().toISOString();
      run.failureSummary = "Project path is outside approved factory roots";
      return;
    }

    let launched;
    try {
      launched = await launchProject({
        projectPath,
        type: manifest.launch.type,
        directory: manifest.launch.directory,
        port: manifest.launch.port,
        healthCheckPath: manifest.launch.healthCheckPath,
        command: manifest.launch.command,
        args: manifest.launch.args
      });
    } catch (error) {
      run.status = "error";
      run.finishedAt = new Date().toISOString();
      run.failureSummary = error instanceof Error ? error.message : "Failed to launch project";
      run.errors.push({ type: "launch", message: run.failureSummary });
      await this.finalizeRun(run);
      return;
    }

    try {
      const viewports = resolveViewports(run.viewports);
      let allPassed = true;
      for (const viewport of viewports) {
        const result = await runTrafficDodgeSmoke({
          baseUrl: launched.baseUrl,
          viewport,
          runId: run.runId,
          artifactStore: this.artifactStore,
          traceOnFailure,
          callbacks: {
            onCheckCompleted: check => {
              run.checks.push(check);
              this.publish({
                type: "visual_qa.check.completed",
                severity: check.status === "failed" ? "error" : "info",
                projectId: run.projectId,
                payload: {
                  runId: run.runId,
                  check: check.name,
                  viewport: check.viewport,
                  status: check.status,
                  durationMs: check.durationMs,
                  message: check.message
                }
              });
            },
            onArtifactCreated: artifact => {
              const full = { ...artifact, createdAt: new Date().toISOString(), available: true };
              run.artifacts.push(full);
              this.publish({
                type: "visual_qa.artifact.created",
                severity: "info",
                projectId: run.projectId,
                payload: { runId: run.runId, artifactId: artifact.id, label: artifact.label, type: artifact.type }
              });
            }
          }
        });
        run.errors.push(...result.errors);
        run.artifacts.push(...result.artifacts.filter(a => !run.artifacts.some(existing => existing.id === a.id)));
        if (!result.passed) allPassed = false;
      }
      run.status = allPassed ? "passed" : "failed";
      if (!allPassed) {
        const failedChecks = run.checks.filter(c => c.status === "failed");
        run.failureSummary = failedChecks[0]?.message ?? run.errors[0]?.message ?? "Visual QA checks failed";
      }
    } catch (error) {
      run.status = "error";
      run.failureSummary = error instanceof Error ? error.message : "Visual QA run failed";
      run.errors.push({ type: "assertion", message: run.failureSummary });
    } finally {
      await launched.stop();
      run.finishedAt = new Date().toISOString();
      await this.finalizeRun(run);
    }
  }

  private async finalizeRun(run: VisualQaRun) {
    this.runs.set(run.runId, run);
    this.lastRun = run;
    await this.artifactStore.saveRunResult(run);
    this.publish({
      type: "visual_qa.completed",
      severity: run.status === "passed" ? "info" : "error",
      projectId: run.projectId,
      payload: {
        runId: run.runId,
        status: run.status,
        failureSummary: run.failureSummary,
        checksPassed: run.checks.filter(c => c.status === "passed").length,
        checksFailed: run.checks.filter(c => c.status === "failed").length
      }
    });
  }
}

// Backward-compatible exports
export { PlaywrightVisualQAService as VisualQAServiceImpl };
export type { VisualQaRunRequest };
