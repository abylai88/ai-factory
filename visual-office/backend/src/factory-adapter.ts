import { promises as fs } from "node:fs";
import path from "node:path";
import { PipelineStateFileSchema, TaskFileSchema, PipelineSnapshotSchema, TaskSnapshotSchema, AgentDescriptorSchema, ProjectSnapshotSchema, type AgentDescriptor, type PipelineSnapshot, type ProjectSnapshot, type TaskSnapshot } from "../../shared/src/index.js";

export interface FactoryAdapterConfig { factoryRoot: string; }
export interface AdapterDiagnostic { source: string; message: string; }
const redact = (value?: string) => value?.replace(/(sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|token|secret)\s*[:=]\s*)\S+/gi, "$1[REDACTED]");
const typeFor = (id: string): "game" | "engineering" | "unknown" => id.startsWith("game-") ? "game" : id.startsWith("engineering-") ? "engineering" : "unknown";
const normalizedStatus = (status: string): "running" | "passed" | "failed" | "unknown" => status === "running" || status === "passed" || status === "failed" ? status : "unknown";
const projectIdForFolder = (folder: string) => folder.replace(/^project-/, "");

export class FactoryAdapter {
  readonly diagnostics: AdapterDiagnostic[] = [];
  constructor(readonly config: FactoryAdapterConfig) {}
  private get pipelinesDir() { return path.join(this.config.factoryRoot, "outputs", "pipelines"); }
  private get tasksDir() { return path.join(this.config.factoryRoot, "tasks"); }
  private get agentsDir() { return path.join(this.config.factoryRoot, "agents", "opencode"); }
  private diagnostic(source: string, message: string) { this.diagnostics.push({ source, message }); }
  consumeDiagnostics() { const result = [...this.diagnostics]; this.diagnostics.length = 0; return result; }
  private async json(file: string): Promise<unknown | undefined> {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { this.diagnostic(file, `JSON unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return undefined; }
  }
  private async files(dir: string, suffix: string): Promise<string[]> {
    try { return (await fs.readdir(dir, { withFileTypes: true })).filter(d => d.isFile() && d.name.endsWith(suffix)).map(d => path.join(dir, d.name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.diagnostic(dir, "Directory unavailable"); return []; }
  }
  async listPipelines(): Promise<PipelineSnapshot[]> { return (await Promise.all((await this.files(this.pipelinesDir, ".json")).map(file => this.pipelineFromFile(file)))).filter((x): x is PipelineSnapshot => Boolean(x)).sort((a,b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")); }
  async getPipeline(id: string): Promise<PipelineSnapshot | undefined> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return undefined;
    return this.pipelineFromFile(path.join(this.pipelinesDir, `${id}.json`));
  }
  private async pipelineFromFile(file: string): Promise<PipelineSnapshot | undefined> {
    const raw = await this.json(file); if (raw === undefined) return undefined;
    const parsed = PipelineStateFileSchema.safeParse(raw);
    if (!parsed.success) { this.diagnostic(file, "Pipeline JSON does not match the supported factory format"); return undefined; }
    const { state, entries = [] } = parsed.data; const type = typeFor(state.pipelineId);
    const steps: Array<{ id: string; title?: string; role?: string; agent?: string; status: "queued" | "running" | "passed" | "failed" | "skipped" | "unknown" }> = entries.map(entry => ({ id: entry.stepId, title: entry.title, role: entry.role, status: entry.status === "passed" ? "passed" : entry.status === "failed" ? "failed" : "unknown" }));
    if (state.currentStepId && !steps.some(s => s.id === state.currentStepId)) steps.push({ id: state.currentStepId, status: state.status === "running" ? "running" : "unknown" });
    const snapshot = { id: state.pipelineId, goal: state.goal ?? "", project: state.project ?? "", type, status: normalizedStatus(state.status), currentStepId: state.currentStepId, startedAt: state.startedAt, finishedAt: state.finishedAt, entries: entries.map(e => ({ ...e, output: redact(e.output) ?? "" })), steps, errors: (state.errors ?? []).map(e => ({ stepId: e.stepId, message: redact(e.message) ?? "", timestamp: e.timestamp })), engine: state.engine, stack: state.stack };
    return PipelineSnapshotSchema.parse(snapshot);
  }
  async listProjects(): Promise<ProjectSnapshot[]> {
    const pipelines = await this.listPipelines(); const pipelineByProject = new Map<string, PipelineSnapshot>();
    for (const pipeline of pipelines) if (pipeline.project && !pipelineByProject.has(pipeline.project)) pipelineByProject.set(pipeline.project, pipeline);
    let dirs: string[] = []; try { dirs = (await fs.readdir(this.tasksDir, { withFileTypes: true })).filter(d => d.isDirectory() && d.name.startsWith("project-")).map(d => d.name); } catch { /* absent is valid */ }
    const projects = dirs.map(folder => {
      const id = projectIdForFolder(folder); const pipe = [...pipelineByProject.values()].find(p => p.project.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0,64) === id) ?? [...pipelineByProject.values()].find(p => p.project.includes(id));
      const total = pipe?.steps.length ?? 0; const complete = pipe?.steps.filter(s => s.status === "passed" || s.status === "failed").length ?? 0;
      return ProjectSnapshotSchema.parse({ id, name: pipe?.project ? path.basename(pipe.project) : id, path: pipe?.project ?? "", pipelineType: pipe?.type ?? "unknown", status: pipe?.status ?? "unknown", currentStepId: pipe?.currentStepId, progress: { complete, total }, lastRunAt: pipe?.startedAt, buildStatus: "unknown", qaStatus: "unknown" });
    });
    for (const pipe of pipelineByProject.values()) if (!projects.some(p => p.path === pipe.project)) projects.push(ProjectSnapshotSchema.parse({ id: `pipeline-${pipe.id}`, name: path.basename(pipe.project) || "Unknown", path: pipe.project, pipelineType: pipe.type, status: pipe.status, currentStepId: pipe.currentStepId, progress: { complete: pipe.steps.filter(s => s.status === "passed" || s.status === "failed").length, total: pipe.steps.length }, lastRunAt: pipe.startedAt, buildStatus: "unknown", qaStatus: "unknown" }));
    return projects;
  }
  async getTasks(projectId: string): Promise<TaskSnapshot[] | undefined> {
    if (!/^[A-Za-z0-9._-]+$/.test(projectId)) return undefined;
    const file = path.join(this.tasksDir, `project-${projectId}`, "tasks.json"); const raw = await this.json(file); if (raw === undefined) return undefined;
    const parsed = TaskFileSchema.safeParse(raw); if (!parsed.success) { this.diagnostic(file, "Task JSON does not match the supported factory format"); return undefined; }
    return parsed.data.map(task => TaskSnapshotSchema.parse({ ...task, description: task.description ?? "", attempts: task.attempts ?? 0, result: redact(task.result), error: redact(task.error), attemptHistory: parseAttempts(task.attemptHistory) }));
  }
  async listAgents(): Promise<AgentDescriptor[]> { return (await Promise.all((await this.files(this.agentsDir, ".md")).map(file => this.agentFromFile(file)))).filter((x): x is AgentDescriptor => Boolean(x)).sort((a,b) => a.name.localeCompare(b.name)); }
  async getAgent(name: string): Promise<AgentDescriptor | undefined> { if (!/^[a-z0-9_-]+$/i.test(name)) return undefined; return this.agentFromFile(path.join(this.agentsDir, `${name}.md`)); }
  private async agentFromFile(file: string): Promise<AgentDescriptor | undefined> {
    let text: string; try { text = await fs.readFile(file, "utf8"); } catch { return undefined; }
    const name = path.basename(file, ".md"); const description = text.match(/^description:\s*(.+)$/m)?.[1]?.trim(); const canEdit = /^\s*edit:\s*allow\s*$/m.test(text) ? true : /^\s*edit:\s*deny\s*$/m.test(text) ? false : undefined;
    return AgentDescriptorSchema.parse({ name, role: name, description, canEdit, source: "agents/opencode" });
  }
}
function parseAttempts(value?: string) { if (!value) return undefined; try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(isAttempt) : undefined; } catch { return undefined; } }
function isAttempt(value: unknown): value is { status: string; errorType: string; errorMessage: string; model: string; attempt: number; timedOut: boolean; retryable: boolean } { return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).model === "string" && typeof (value as Record<string, unknown>).attempt === "number"; }

