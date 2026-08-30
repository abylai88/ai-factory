import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  AgentDescriptor,
  DiagnosticRecord,
  FactoryEvent,
  HermesStatus,
  MissionListItem,
  MissionDetail,
  PipelineSnapshot,
  ProjectSnapshot,
  TaskSnapshot,
  VisualQaStatus,
  VisualQaRun,
  VisualQaCheck
} from "@shared";
import { get, post } from "./api.js";
import {
  Badge,
  Empty,
  PageHeader,
  Panel,
  QueryState,
  Shell,
  Stat,
  formatClock,
  formatTime,
  truncate
} from "./components.js";
import { useOffice } from "./store.js";

function Dashboard() {
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => get<{ pipelines: PipelineSnapshot[] }>("/api/pipelines") });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => get<{ projects: ProjectSnapshot[] }>("/api/projects") });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<{ agents: AgentDescriptor[] }>("/api/agents") });
  const visualQa = useQuery({ queryKey: ["visual-qa"], queryFn: () => get<{ visualQa: VisualQaStatus }>("/api/visual-qa/status") });
  const events = useOffice(s => s.events);
  const running = pipelines.data?.pipelines.filter(p => p.status === "running") ?? [];
  const failed = pipelines.data?.pipelines.filter(p => p.status === "failed") ?? [];

  return (
    <Shell>
      <PageHeader eyebrow="Factory observability" title="Control room" badge="read-only" />
      <section className="stats">
        <Stat label="Active pipelines" value={pipelines.isLoading ? "—" : running.length} />
        <Stat label="Failed pipelines" value={pipelines.isLoading ? "—" : failed.length} />
        <Stat label="Projects" value={projects.data?.projects.length ?? "—"} />
        <Stat label="Agents" value={agents.data?.agents.length ?? "—"} />
        <Stat label="Visual QA" value={visualQa.data?.visualQa.available ? "Ready" : "Unavailable"} hint={visualQa.data?.visualQa.lastRun?.status ?? "Playwright smoke"} />
      </section>

      <section className="grid two">
        <Panel title="Pipeline activity" action="View all" to="/pipelines">
          <QueryState loading={pipelines.isLoading} error={pipelines.error} hasData={running.length > 0}>
            <div className="rows">
              {running.map(p => (
                <Link className="row" to={`/pipelines/${p.id}`} key={p.id}>
                  <span>
                    <b>{p.goal || "Unnamed pipeline"}</b>
                    <small>{p.project || "Unknown project"}</small>
                  </span>
                  <span>
                    <Badge value={p.status} />
                    <small>Step: {p.currentStepId ?? "Unknown"}</small>
                  </span>
                </Link>
              ))}
            </div>
          </QueryState>
          {!pipelines.isLoading && !pipelines.error && running.length === 0 && (
            <Empty text="No active pipelines reported by Factory." />
          )}
        </Panel>

        <Panel title="Recent events" action="View all" to="/events">
          {events.length ? (
            <div className="events">
              {events.slice(0, 8).map(e => (
                <div key={e.id}>
                  <span className={`dot ${e.severity}`} />
                  <span className="event-type">{e.type}</span>
                  <small>{formatClock(e.occurredAt)}</small>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Waiting for real Factory file changes." />
          )}
        </Panel>
      </section>

      <section className="grid two">
        <Panel title="Active agents">
          {running.length ? running.map(p => {
            const step = p.steps.find(s => s.id === p.currentStepId);
            return (
              <div className="agent-line" key={p.id}>
                <i>◉</i>
                <span>
                  {step?.agent ?? step?.role ?? "Unknown"}
                  <small>{step?.role ?? "Current role unavailable"}</small>
                </span>
                <Badge value="running" />
              </div>
            );
          }) : <Empty text="No active agents." />}
        </Panel>

        <Panel title="Recent pipelines">
          <QueryState loading={pipelines.isLoading} error={pipelines.error} hasData={(pipelines.data?.pipelines.length ?? 0) > 0}>
            <div className="rows">
              {pipelines.data?.pipelines.slice(0, 6).map(p => (
                <Link className="row" to={`/pipelines/${p.id}`} key={p.id}>
                  <span>
                    <b>{p.goal || "Unnamed pipeline"}</b>
                    <small>{p.type} · {formatTime(p.startedAt)}</small>
                  </span>
                  <Badge value={p.status} />
                </Link>
              ))}
            </div>
          </QueryState>
        </Panel>
      </section>
    </Shell>
  );
}

function ProjectsPage() {
  const q = useQuery({ queryKey: ["projects"], queryFn: () => get<{ projects: ProjectSnapshot[] }>("/api/projects") });
  return (
    <Shell>
      <PageHeader eyebrow="Allowlisted Factory workspaces" title="Projects" />
      <section className="panel table">
        <div className="table-head">
          <span>Project</span><span>Type</span><span>Current step</span><span>Progress</span><span>Status</span>
        </div>
        <QueryState loading={q.isLoading} error={q.error} hasData={(q.data?.projects.length ?? 0) > 0}>
          {q.data?.projects.map(p => (
            <Link to={`/projects/${p.id}`} key={p.id} className="table-row">
              <span><b>{p.name}</b><small>{p.path || "Path not available"}</small></span>
              <span>{p.pipelineType}</span>
              <span>{p.currentStepId ?? "Unknown"}</span>
              <span>{p.progress.complete}/{p.progress.total || "—"}</span>
              <Badge value={p.status} />
            </Link>
          ))}
        </QueryState>
        {!q.isLoading && !q.error && !q.data?.projects.length && (
          <Empty text="No projects have task or pipeline data." />
        )}
      </section>
    </Shell>
  );
}

function ProjectPage() {
  const { id = "" } = useParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => get<{ projects: ProjectSnapshot[] }>("/api/projects") });
  const tasks = useQuery({ queryKey: ["tasks", id], queryFn: () => get<{ tasks: TaskSnapshot[] }>(`/api/projects/${encodeURIComponent(id)}/tasks`) });
  const project = projects.data?.projects.find(p => p.id === id);

  return (
    <Shell>
      <PageHeader
        eyebrow={project?.path || "Path not available"}
        title={project?.name || "Unknown project"}
        badge={project?.status}
      />
      <section className="stats">
        <Stat label="Pipeline" value={project?.pipelineType ?? "Unknown"} />
        <Stat label="Current step" value={project?.currentStepId ?? "Unknown"} />
        <Stat label="Build" value={project?.buildStatus ?? "Unknown"} />
        <Stat label="QA" value={project?.qaStatus === "unknown" ? "Not available" : project?.qaStatus ?? "Unknown"} />
      </section>
      <Panel title="Tasks">
        <QueryState loading={tasks.isLoading} error={tasks.error} hasData={(tasks.data?.tasks.length ?? 0) > 0}>
          <div className="rows">
            {tasks.data?.tasks.map(task => (
              <Link className="row" to={`/projects/${id}/tasks/${task.id}`} key={task.id}>
                <span>
                  <b>{task.title}</b>
                  <small>{task.agent ?? "Unknown agent"} · {task.role}</small>
                </span>
                <span>
                  <Badge value={task.status} />
                  <small>Attempt {task.attempts} · {task.model ?? "Unknown model"}</small>
                </span>
              </Link>
            ))}
          </div>
        </QueryState>
        {!tasks.isLoading && !tasks.error && !tasks.data?.tasks.length && (
          <Empty text="No task snapshot is available for this project." />
        )}
      </Panel>
    </Shell>
  );
}

function TaskPage() {
  const { id = "", taskId = "" } = useParams();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => get<{ projects: ProjectSnapshot[] }>("/api/projects") });
  const task = useQuery({
    queryKey: ["task", id, taskId],
    queryFn: () => get<{ task: TaskSnapshot }>(`/api/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`)
  });
  const project = projects.data?.projects.find(p => p.id === id);
  const t = task.data?.task;

  return (
    <Shell>
      <PageHeader
        eyebrow={`${project?.name ?? "Unknown project"} · ${t?.role ?? "Unknown role"}`}
        title={t?.title ?? "Task not available"}
        badge={t?.status}
      />
      <QueryState loading={task.isLoading} error={task.error} hasData={Boolean(t)}>
        {t && (
          <>
            <section className="stats">
              <Stat label="Agent" value={t.agent ?? "Unknown"} />
              <Stat label="Model" value={t.model ?? "Unknown"} />
              <Stat label="Attempts" value={t.attempts} />
              <Stat label="Updated" value={formatTime(t.updatedAt)} />
            </section>
            {t.error && (
              <Panel title="Error">
                <pre className="code-block error-text">{t.error}</pre>
              </Panel>
            )}
            {t.attemptHistory && t.attemptHistory.length > 0 && (
              <Panel title="Attempt history">
                <div className="rows">
                  {t.attemptHistory.map((attempt, index) => (
                    <div className="row" key={`${attempt.attempt}-${index}`}>
                      <span>
                        <b>Attempt {attempt.attempt}</b>
                        <small>{attempt.model} · {attempt.errorType}</small>
                      </span>
                      <Badge value={attempt.status} />
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            <Panel title="Description">
              <pre className="code-block">{truncate(t.description, 2000)}</pre>
            </Panel>
            {t.result && (
              <Panel title="Agent output">
                <pre className="code-block">{truncate(t.result, 4000)}</pre>
              </Panel>
            )}
          </>
        )}
      </QueryState>
    </Shell>
  );
}

function PipelinesPage() {
  const q = useQuery({ queryKey: ["pipelines"], queryFn: () => get<{ pipelines: PipelineSnapshot[] }>("/api/pipelines") });
  return (
    <Shell>
      <PageHeader eyebrow="Pipeline snapshots" title="Pipelines" />
      <section className="panel table">
        <div className="table-head pipelines">
          <span>Pipeline</span><span>Type</span><span>Project</span><span>Started</span><span>Status</span>
        </div>
        <QueryState loading={q.isLoading} error={q.error} hasData={(q.data?.pipelines.length ?? 0) > 0}>
          {q.data?.pipelines.map(p => (
            <Link to={`/pipelines/${p.id}`} key={p.id} className="table-row pipelines">
              <span><b>{p.goal || p.id}</b><small>{p.id}</small></span>
              <span>{p.type}</span>
              <span><small>{p.project || "Unknown"}</small></span>
              <span>{formatTime(p.startedAt)}</span>
              <Badge value={p.status} />
            </Link>
          ))}
        </QueryState>
        {!q.isLoading && !q.error && !q.data?.pipelines.length && (
          <Empty text="No pipeline snapshots found in outputs/pipelines." />
        )}
      </section>
    </Shell>
  );
}

function PipelinePage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["pipeline", id],
    queryFn: () => get<{ pipeline: PipelineSnapshot }>(`/api/pipelines/${encodeURIComponent(id)}`)
  });
  const p = q.data?.pipeline;

  return (
    <Shell>
      <PageHeader
        eyebrow={`${p?.type ?? "Unknown"} pipeline · ${p?.project || "Unknown project"}`}
        title={p?.goal || "Pipeline not available"}
        badge={p?.status}
      />
      <QueryState loading={q.isLoading} error={q.error} hasData={Boolean(p)}>
        {p && (
          <>
            <section className="stats">
              <Stat label="Engine" value={p.engine ?? "Unknown"} />
              <Stat label="Stack" value={p.stack ?? "Unknown"} />
              <Stat label="Current step" value={p.currentStepId ?? "Unknown"} />
              <Stat label="Finished" value={formatTime(p.finishedAt)} />
            </section>

            {p.errors.length > 0 && (
              <Panel title="Errors & diagnostics">
                <div className="rows">
                  {p.errors.map((error, index) => (
                    <div className="row" key={`${error.timestamp}-${index}`}>
                      <span>
                        <b>{error.stepId ?? "Pipeline"}</b>
                        <small>{error.message}</small>
                      </span>
                      <small>{formatClock(error.timestamp)}</small>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title="Pipeline steps">
              <div className="timeline">
                {p.steps.map(step => (
                  <div className={`step ${step.id === p.currentStepId ? "current" : ""}`} key={step.id}>
                    <span className={`step-dot ${step.status}`} />
                    <div>
                      <b>{step.title ?? step.id}</b>
                      <small>{step.id} · {step.role ?? "Unknown role"} · {step.agent ?? "Unknown agent"}</small>
                    </div>
                    <div>
                      <Badge value={step.status} />
                      <small>Attempt {step.attempt ?? "—"} · {step.model ?? "Unknown model"}</small>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {p.entries.length > 0 && (
              <Panel title="Step outputs">
                <div className="rows">
                  {p.entries.map(entry => (
                    <div className="row stack" key={`${entry.stepId}-${entry.timestamp}`}>
                      <span>
                        <b>{entry.title}</b>
                        <small>{entry.stepId} · {entry.role} · {formatClock(entry.timestamp)}</small>
                        <pre className="code-block compact">{truncate(entry.output, 600)}</pre>
                      </span>
                      <Badge value={entry.status} />
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </QueryState>
    </Shell>
  );
}

function AgentsPage() {
  const q = useQuery({ queryKey: ["agents"], queryFn: () => get<{ agents: AgentDescriptor[] }>("/api/agents") });
  return (
    <Shell>
      <PageHeader eyebrow="Factory OpenCode definitions" title="Agents" />
      <QueryState loading={q.isLoading} error={q.error} hasData={(q.data?.agents.length ?? 0) > 0}>
        <section className="agent-grid">
          {q.data?.agents.map(agent => (
            <article key={agent.name}>
              <i>◇</i>
              <h2>{agent.name}</h2>
              <p>{agent.description ?? "Description not available."}</p>
              <dl>
                <dt>Role</dt><dd>{agent.role}</dd>
                <dt>Runtime</dt><dd>Unknown</dd>
                <dt>Model</dt><dd>Unknown</dd>
                <dt>Permissions</dt>
                <dd>{agent.canEdit === undefined ? "Unknown" : agent.canEdit ? "Can edit" : "Read-only"}</dd>
              </dl>
            </article>
          ))}
        </section>
      </QueryState>
      {!q.isLoading && !q.error && !q.data?.agents.length && (
        <Empty text="No agent definitions found in agents/opencode." />
      )}
    </Shell>
  );
}

function EventsPage() {
  const events = useOffice(s => s.events);
  return (
    <Shell>
      <PageHeader eyebrow="Server-sent events" title="Recent events" />
      <Panel title="Live event stream">
        {events.length ? (
          <div className="event-table">
            {events.map(e => (
              <div className="event-row" key={e.id}>
                <span className={`dot ${e.severity}`} />
                <span className="event-type">{e.type}</span>
                <span className="event-meta">
                  {[e.pipelineId, e.projectId, e.taskId].filter(Boolean).join(" · ") || "—"}
                </span>
                <small>{formatTime(e.occurredAt)}</small>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No events yet. Changes to pipelines or tasks will appear here." />
        )}
      </Panel>
    </Shell>
  );
}

function DiagnosticsPage() {
  const diagnostics = useQuery({ queryKey: ["diagnostics"], queryFn: () => get<{ diagnostics: DiagnosticRecord[] }>("/api/diagnostics") });
  const hermes = useQuery({ queryKey: ["hermes"], queryFn: () => get<{ hermes: HermesStatus }>("/api/hermes/status") });

  return (
    <Shell>
      <PageHeader eyebrow="Adapter warnings & Hermes" title="Diagnostics" />
      <section className="stats">
        <Stat label="Hermes" value={hermes.data?.hermes.available ? "Connected" : "Inactive"} hint={hermes.data?.hermes.summary} />
        <Stat label="Warnings" value={diagnostics.data?.diagnostics.length ?? "—"} />
      </section>
      <Panel title="Factory diagnostics">
        <QueryState loading={diagnostics.isLoading} error={diagnostics.error} hasData={(diagnostics.data?.diagnostics.length ?? 0) > 0}>
          <div className="rows">
            {diagnostics.data?.diagnostics.map((d, index) => (
              <div className="row stack" key={`${d.source}-${index}`}>
                <span>
                  <b>{d.source}</b>
                  <small>{d.message}</small>
                </span>
                <small>{formatTime(d.occurredAt)}</small>
              </div>
            ))}
          </div>
        </QueryState>
        {!diagnostics.isLoading && !diagnostics.error && !diagnostics.data?.diagnostics.length && (
          <Empty text="No diagnostics reported. Malformed JSON and parse issues will appear here." />
        )}
      </Panel>
    </Shell>
  );
}

function VisualQaPage() {
  const statusQuery = useQuery({ queryKey: ["visual-qa"], queryFn: () => get<{ visualQa: VisualQaStatus }>("/api/visual-qa/status"), refetchInterval: 3_000 });
  const [activeRunId, setActiveRunId] = useState<string | undefined>(statusQuery.data?.visualQa.lastRun?.runId);
  const [projectId, setProjectId] = useState("traffic-dodge");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const runQuery = useQuery({
    queryKey: ["visual-qa-run", activeRunId],
    queryFn: () => get<{ run: VisualQaRun }>(`/api/visual-qa/runs/${encodeURIComponent(activeRunId!)}`),
    enabled: Boolean(activeRunId),
    refetchInterval: query => {
      const status = query.state.data?.run.status;
      return status === "queued" || status === "running" ? 2_000 : false;
    }
  });

  const status = statusQuery.data?.visualQa;
  const run = runQuery.data?.run ?? status?.lastRun;
  const viewports = status?.defaultViewports ?? ["1280x720", "1366x768", "1920x1080"];

  const startRun = async () => {
    setRunError(null);
    setRunning(true);
    try {
      const { run: created } = await post<{ run: VisualQaRun }>("/api/visual-qa/runs", { projectId, scenario: "smoke" });
      setActiveRunId(created.runId);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Failed to start Visual QA");
    } finally {
      setRunning(false);
    }
  };

  const checksByViewport = new Map<string, VisualQaCheck[]>();
  for (const viewport of viewports) checksByViewport.set(viewport, []);
  for (const check of run?.checks ?? []) {
    checksByViewport.get(check.viewport)?.push(check);
  }

  const viewportPassed = (viewport: string) => {
    const checks = checksByViewport.get(viewport) ?? [];
    if (!checks.length) return run?.status === "running" || run?.status === "queued" ? "running" : "unknown";
    return checks.some(c => c.status === "failed") ? "failed" : checks.every(c => c.status === "passed") ? "passed" : "running";
  };

  return (
    <Shell>
      <PageHeader eyebrow="Playwright browser QA" title="Visual QA" badge={status?.available ? "ready" : "unavailable"} />
      <QueryState loading={statusQuery.isLoading} error={statusQuery.error} hasData={Boolean(status)}>
        {status && (
          <>
            <section className="stats">
              <Stat label="Service" value={status.available ? "Ready" : "Unavailable"} />
              <Stat label="Last run" value={run?.status ?? "None"} />
              <Stat label="Project" value={projectId} />
              <Stat label="Checks" value={run ? `${run.checks.filter(c => c.status === "passed").length}/${run.checks.length || "—"}` : "—"} />
            </section>

            <Panel title="Run Visual QA">
              <div className="qa-controls">
                <label>
                  Project
                  <select value={projectId} onChange={e => setProjectId(e.target.value)}>
                    {status.supportedProjects.map(project => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                </label>
                <button className="primary-btn" onClick={() => void startRun()} disabled={running || run?.status === "running" || run?.status === "queued"}>
                  {running ? "Starting…" : "Run Visual QA"}
                </button>
              </div>
              {runError && <div className="state error">{runError}</div>}
              <p className="prose">{status.message}</p>
            </Panel>

            <Panel title="Viewport matrix">
              <div className="viewport-grid">
                {viewports.map(viewport => {
                  const result = viewportPassed(viewport);
                  const screenshot = run?.artifacts.find(a => a.type === "screenshot" && a.label.startsWith(`${viewport}/`));
                  return (
                    <article key={viewport} className="viewport-card">
                      <div className="viewport-card-head">
                        <strong>{viewport}</strong>
                        <Badge value={result} />
                      </div>
                      {screenshot && (
                        <a href={`/api/artifacts/${screenshot.id}`} target="_blank" rel="noreferrer">
                          <img className="qa-shot" src={`/api/artifacts/${screenshot.id}`} alt={`${viewport} screenshot`} />
                        </a>
                      )}
                      <div className="check-list">
                        {(checksByViewport.get(viewport) ?? []).map(check => (
                          <div key={`${viewport}-${check.name}`} className="check-row">
                            <span className={`dot ${check.status === "passed" ? "info" : "error"}`} />
                            <span>{check.name}</span>
                            <small>{check.message}</small>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </Panel>

            {run && (
              <>
                {run.failureSummary && (
                  <Panel title="Failure summary">
                    <div className="state error">{run.failureSummary}</div>
                  </Panel>
                )}

                {run.errors.length > 0 && (
                  <Panel title="Errors">
                    <div className="rows">
                      {run.errors.map((error, index) => (
                        <div className="row stack" key={`${error.type}-${index}`}>
                          <span><b>{error.type}</b><small>{error.viewport ? `${error.viewport} · ` : ""}{error.message}</small></span>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}

                <Panel title="Artifacts">
                  {run.artifacts.length ? (
                    <div className="rows">
                      {run.artifacts.map(artifact => (
                        <a className="row" href={`/api/artifacts/${artifact.id}`} target="_blank" rel="noreferrer" key={artifact.id}>
                          <span><b>{artifact.label}</b><small>{artifact.type} · {artifact.id}</small></span>
                          <Badge value={artifact.available ? "available" : "unknown"} />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <Empty text="Artifacts will appear when the run completes." />
                  )}
                </Panel>
              </>
            )}
          </>
        )}
      </QueryState>
    </Shell>
  );
}

function MissionsPage() {
  const q = useQuery({ queryKey: ["missions"], queryFn: () => get<{ missions: MissionListItem[] }>("/api/missions") });
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const createMission = async () => {
    setCreateError(null);
    setCreating(true);
    try {
      const body: { goal: string; projectId?: string } = { goal: goal.trim() };
      if (projectId.trim()) body.projectId = projectId.trim();
      const { mission } = await post<{ mission: { id: string } }>("/api/missions", body);
      setGoal("");
      setProjectId("");
      void q.refetch();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create mission");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Shell>
      <PageHeader eyebrow="Mission control" title="Missions" />
      <section className="stats">
        <Stat label="Total missions" value={q.data?.missions.length ?? "—"} />
        <Stat label="Running" value={q.data?.missions.filter(m => m.status === "running").length ?? 0} />
        <Stat label="Completed" value={q.data?.missions.filter(m => m.status === "completed").length ?? 0} />
        <Stat label="Failed" value={q.data?.missions.filter(m => m.status === "failed").length ?? 0} />
      </section>

      <Panel title="Create mission">
        <div className="qa-controls">
          <label>
            Goal
            <input
              type="text"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="Build a platformer game"
              className="mission-input"
            />
          </label>
          <label>
            Project (optional)
            <select value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">None</option>
              <option value="traffic-dodge">Traffic Dodge</option>
            </select>
          </label>
          <button className="primary-btn" onClick={() => void createMission()} disabled={creating || !goal.trim()}>
            {creating ? "Creating…" : "Create Mission"}
          </button>
        </div>
        {createError && <div className="state error">{createError}</div>}
      </Panel>

      <section className="panel table">
        <div className="table-head">
          <span>Mission</span><span>Status</span><span>Delegations</span><span>Repairs</span><span>Created</span>
        </div>
        <QueryState loading={q.isLoading} error={q.error} hasData={(q.data?.missions.length ?? 0) > 0}>
          {q.data?.missions.map(m => (
            <Link to={`/missions/${m.id}`} key={m.id} className="table-row">
              <span><b>{m.goal}</b><small>{m.id}</small></span>
              <Badge value={m.status} />
              <span>{m.delegationCount}</span>
              <span>{m.repairCount}</span>
              <span>{formatTime(m.createdAt)}</span>
            </Link>
          ))}
        </QueryState>
        {!q.isLoading && !q.error && !q.data?.missions.length && (
          <Empty text="No missions created yet. Use the form above to create one." />
        )}
      </section>
    </Shell>
  );
}

function MissionDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["mission", id],
    queryFn: () => get<{ mission: MissionDetail }>(`/api/missions/${encodeURIComponent(id)}`),
    refetchInterval: query => {
      const status = query.state.data?.mission.mission.status;
      return status === "running" || status === "auditing" || status === "repairing" ? 3_000 : false;
    }
  });
  const detail = q.data?.mission;
  const mission = detail?.mission;
  const plan = detail?.plan;
  const delegations = detail?.delegations ?? [];
  const auditResults = detail?.auditResults ?? {};
  const repairPlans = detail?.repairPlans ?? {};
  const recentEvents = detail?.recentEvents ?? [];
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const startMission = async () => {
    setStartError(null);
    setStarting(true);
    try {
      await post<{ mission: MissionDetail }>(`/api/missions/${encodeURIComponent(id)}/start`, {});
      void q.refetch();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Failed to start mission");
    } finally {
      setStarting(false);
    }
  };

  const progress = delegations.length > 0
    ? { completed: delegations.filter(d => d.status === "passed").length, total: delegations.length }
    : null;

  return (
    <Shell>
      <PageHeader
        eyebrow={mission ? `Mission · ${mission.id}` : "Mission"}
        title={mission?.goal || "Mission detail"}
        badge={mission?.status}
      />
      <QueryState loading={q.isLoading} error={q.error} hasData={Boolean(mission)}>
        {mission && (
          <>
            <section className="stats">
              <Stat label="Status" value={mission.status} />
              <Stat label="Delegations" value={`${progress?.completed ?? 0}/${progress?.total ?? 0}`} />
              <Stat label="Repairs" value={Object.keys(repairPlans).length} />
              <Stat label="Created" value={formatTime(mission.createdAt)} />
              <Stat label="Project" value={mission.context?.projectId ?? "None"} />
            </section>

            {(mission.status === "draft" || mission.status === "planned") && (
              <Panel title="Actions">
                <div className="qa-controls">
                  <button className="primary-btn" onClick={() => void startMission()} disabled={starting}>
                    {starting ? "Starting…" : "Start Mission"}
                  </button>
                </div>
                {startError && <div className="state error">{startError}</div>}
              </Panel>
            )}

            {plan && (
              <Panel title="Execution plan">
                <div className="rows">
                  {plan.objectives.map(obj => (
                    <div className="row stack" key={obj.id}>
                      <span>
                        <b>{obj.title}</b>
                        <small>{obj.description}</small>
                      </span>
                      <small>{obj.delegations.length} delegation(s)</small>
                    </div>
                  ))}
                </div>
                {plan.risks.length > 0 && (
                  <>
                    <h3 style={{ margin: "14px 0 8px", fontSize: "13px", color: "#8290a6" }}>Risks</h3>
                    <div className="rows">
                      {plan.risks.map(risk => (
                        <div className="row" key={risk.id}>
                          <span>
                            <b>[{risk.severity}] {risk.description}</b>
                            {risk.mitigation && <small>Mitigation: {risk.mitigation}</small>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Panel>
            )}

            <Panel title="Delegations">
              {delegations.length > 0 ? (
                <div className="timeline">
                  {delegations.map((del, index) => {
                    const audit = auditResults[del.id];
                    return (
                      <div className={`step ${del.status === "running" ? "current" : ""}`} key={del.id}>
                        <span className={`step-dot ${del.status}`} />
                        <div>
                          <b>{del.title}</b>
                          <small>{del.description}</small>
                          {audit && (
                            <small className={audit.status === "PASS" ? "audit-pass" : "audit-fail"}>
                              Audit: {audit.status} — {audit.summary}
                            </small>
                          )}
                        </div>
                        <div>
                          <Badge value={del.status} />
                          <small>{del.pipelineType} · {formatTime(del.startedAt)}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty text="No delegations yet. Start the mission to generate a plan." />
              )}
            </Panel>

            {Object.keys(auditResults).length > 0 && (
              <Panel title="Audit results">
                <div className="rows">
                  {Object.entries(auditResults).map(([delId, audit]) => (
                    <div className="row stack" key={delId}>
                      <span>
                        <b>{audit.status} — {delId}</b>
                        <small>{audit.summary}</small>
                        {audit.findings.length > 0 && (
                          <small>Findings: {audit.findings.join("; ")}</small>
                        )}
                      </span>
                      <Badge value={audit.status === "PASS" ? "passed" : "failed"} />
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {recentEvents.length > 0 && (
              <Panel title="Recent mission events">
                <div className="event-table">
                  {recentEvents.slice(0, 20).map(event => (
                    <div className="event-row" key={event.id}>
                      <span className={`dot ${event.type.includes("failed") ? "error" : "info"}`} />
                      <span className="event-type">{event.type}</span>
                      <span className="event-meta">{event.missionId}</span>
                      <small>{formatClock(event.occurredAt)}</small>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}
      </QueryState>
    </Shell>
  );
}

export {
  Dashboard,
  MissionsPage,
  MissionDetailPage,
  ProjectsPage,
  ProjectPage,
  TaskPage,
  PipelinesPage,
  PipelinePage,
  AgentsPage,
  EventsPage,
  DiagnosticsPage,
  VisualQaPage
};
