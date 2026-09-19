/**
 * Shared production entry for Roblox project readiness.
 *
 * ONE reusable path used by TaskRunner (and any other orchestrator):
 *
 *   validate project
 *   → ensure Rojo / .rbxlx artifact
 *   → ensure Studio project ready (project loader owns ALL load state)
 *   → return bridge + evidence
 *
 * The loader remains the sole authority for Studio readiness (process
 * state, plugin connection, place detection, bounded polling, diagnostics,
 * timeout classification). This module only sequences provisioning before
 * it and maps outcomes onto explicit failure codes.
 */

import {
  ensureRobloxPlaceArtifact,
  type PlaceArtifactOptions,
  type PlaceArtifactResult,
  type RobloxProvisionCode,
} from "./place-artifact.js";
import {
  loadProject,
  createProjectLoaderOps,
  type ProjectLoadConfig,
  type ProjectLoadResult,
  type ProjectLoadEvidence,
  type StudioProjectLoaderOps,
} from "../studio/project-loader.js";
import { createStudioBridge, type StudioBridgeLike } from "../studio/mcp-bridge.js";
import type { FailureCategory } from "../mission/failure-triage.js";

/** Terminal failure codes for project readiness (never generic timeout). */
export type RobloxReadyCode =
  | RobloxProvisionCode
  | "STUDIO_UNAVAILABLE"
  | "MCP_UNAVAILABLE"
  | "PROJECT_LOAD_TIMEOUT"
  | "PROJECT_NOT_READY";

export interface EnsureProjectReadyOptions {
  /** Explicit artifact path (default: deterministic per-project path). */
  artifactPath?: string;
  artifactName?: string;
  forceRebuild?: boolean;
  buildTimeoutMs?: number;
  /** Pre-resolved Rojo binary (skips discovery). */
  rojoBin?: string;
  /** Skip the Studio/load phase (artifact + validation only). */
  skipStudio?: boolean;
  /** Project-loader budgets (launch ack, startup, plugin, place, max-total). */
  loadConfig?: Partial<ProjectLoadConfig>;
  /** Injectable bridge (tests / callers that already hold one). */
  bridge?: StudioBridgeLike;
  /** Injectable loader ops (unit tests use fakes; no Studio needed). */
  loaderOps?: StudioProjectLoaderOps;
  env?: NodeJS.ProcessEnv;
  role?: string;
  projectDir?: string;
  artifactOptions?: Omit<PlaceArtifactOptions, "artifactPath" | "artifactName" | "forceRebuild" | "buildTimeoutMs" | "bin" | "env">;
}

export interface EnsureProjectReadySuccess {
  ok: true;
  /** "ARTIFACT_READY" when skipStudio is set (no Studio phase ran). */
  state: "PLACE_READY" | "ARTIFACT_READY";
  bridge?: StudioBridgeLike;
  artifact: Extract<PlaceArtifactResult, { ok: true }>;
  load?: ProjectLoadResult;
}

export interface EnsureProjectReadyFailure {
  ok: false;
  code: RobloxReadyCode;
  reason: string;
  artifact?: PlaceArtifactResult;
  load?: ProjectLoadResult;
}

export type EnsureProjectReadyResult = EnsureProjectReadySuccess | EnsureProjectReadyFailure;

/** Map readiness codes onto the existing failure-triage categories. */
export function readyCodeToFailureCategory(code: RobloxReadyCode): FailureCategory {
  switch (code) {
    case "ROJO_UNAVAILABLE":
    case "STUDIO_UNAVAILABLE":
    case "MCP_UNAVAILABLE":
    case "PROJECT_LOAD_TIMEOUT":
    case "PROJECT_NOT_READY":
      return "tool_unavailable";
    case "ROJO_BUILD_FAILED":
      return "build_config";
    case "ROBLOX_ARTIFACT_MISSING":
      return "roblox_structure";
  }
}

/**
 * Ensure a Roblox source project is provisioned and (unless skipped) loaded
 * into Studio and verified ready. Never throws for expected failures.
 */
export async function ensureProjectReady(
  projectDir: string,
  opts: EnsureProjectReadyOptions = {}
): Promise<EnsureProjectReadyResult> {
  const artifact = await ensureRobloxPlaceArtifact(projectDir, {
    artifactPath: opts.artifactPath,
    artifactName: opts.artifactName,
    forceRebuild: opts.forceRebuild,
    buildTimeoutMs: opts.buildTimeoutMs,
    bin: opts.rojoBin,
    env: opts.env,
    ...(opts.artifactOptions ?? {}),
  });
  if (!artifact.ok) {
    return { ok: false, code: artifact.code, reason: artifact.reason, artifact };
  }

  if (opts.skipStudio === true) {
    return { ok: true, state: "ARTIFACT_READY", artifact };
  }

  const bridge = opts.bridge ?? createStudioBridge(undefined, opts.env);
  const loaderOps = opts.loaderOps ?? createProjectLoaderOps(bridge);
  const load = await loadProject(loaderOps, artifact.artifactPath, opts.loadConfig);
  if (load.ok) {
    return { ok: true, state: "PLACE_READY", bridge: load.bridge ?? bridge, artifact, load };
  }
  return { ok: false, code: mapLoadState(load), reason: load.message, artifact, load };
}

function mapLoadState(load: ProjectLoadResult): RobloxReadyCode {
  switch (load.state) {
    case "LOAD_TIMEOUT":
      return "PROJECT_LOAD_TIMEOUT";
    case "DISCONNECTED":
      return load.evidence.diagnostics.processAlive ? "MCP_UNAVAILABLE" : "STUDIO_UNAVAILABLE";
    case "FAILED":
      return load.evidence.diagnostics.processAlive ? "PROJECT_NOT_READY" : "STUDIO_UNAVAILABLE";
    default:
      return "PROJECT_NOT_READY";
  }
}

/** Type guard for narrowing results without importing internals. */
export function isProjectReady(
  r: EnsureProjectReadyResult
): r is EnsureProjectReadySuccess {
  return r.ok;
}

export type { ProjectLoadEvidence };
