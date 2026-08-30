import type { Artifact } from "../../shared/src/index.js";

export type VisualQaRunStatus = "queued" | "running" | "passed" | "failed" | "error";
export type VisualQaCheckStatus = "passed" | "failed" | "skipped";

export interface ViewportSize {
  label: string;
  width: number;
  height: number;
}

export interface VisualQaCheck {
  name: string;
  viewport: string;
  status: VisualQaCheckStatus;
  durationMs: number;
  message?: string;
}

export interface VisualQaErrorRecord {
  type: "console" | "page" | "request" | "launch" | "assertion";
  message: string;
  viewport?: string;
  url?: string;
}

export interface VisualQaRun {
  runId: string;
  projectId: string;
  scenario: string;
  status: VisualQaRunStatus;
  startedAt: string;
  finishedAt?: string;
  viewports: string[];
  checks: VisualQaCheck[];
  artifacts: Artifact[];
  errors: VisualQaErrorRecord[];
  failureSummary?: string;
}

export interface VisualQaRunRequest {
  projectId: string;
  scenario?: string;
  viewports?: string[];
  traceOnFailure?: boolean;
}

export interface VisualQaServiceStatus {
  available: boolean;
  message: string;
  supportedProjects: Array<{ id: string; name: string; scenarios: string[] }>;
  defaultViewports: string[];
  lastRun?: VisualQaRun;
}

export interface ProjectLaunchManifest {
  type: "static" | "npm-dev";
  directory?: string;
  port: number;
  healthCheckPath: string;
  command?: string;
  args?: string[];
}

export interface ProjectManifest {
  id: string;
  name: string;
  factoryRelativePath: string;
  launch: ProjectLaunchManifest;
  defaultScenario: string;
  scenarios: string[];
}
