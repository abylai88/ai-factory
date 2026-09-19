/**
 * Roblox Studio Project Loader — explicit state machine for project loading.
 *
 * The Studio plugin / MCP server's `manage_instance` with `local_file` source
 * is fire-and-forget: the call returns before the place is actually open
 * and responsive. A large .rbxlx can take minutes to load. This module
 * models the loading lifecycle explicitly and guarantees:
 *
 *   1. SINGLE INSTANCE — reuses existing Studio if healthy and correct place.
 *   2. EXPLICIT STATES — NOT_RUNNING → STUDIO_STARTING → STUDIO_PROCESS_ALIVE
 *      → PLUGIN_CONNECTING → PLUGIN_CONNECTED → PLACE_DETECTED → PLACE_OPENING
 *      → PLACE_LOADING → PLACE_READY (or LOAD_TIMEOUT/DISCONNECTED/FAILED).
 *      LOAD_SLOW is a legacy alias of PLACE_LOADING (still accepted in
 *      evidence and event handling).
 *   3. DECOUPLED LIFETIMES — the launch request is a quick acknowledgement
 *      (wait_for_connection=false, short launch-ack budget). All long waiting
 *      happens in bounded status/instance polling, never in one held request.
 *   4. BOUNDED READINESS — polls with distinct timeout classes per phase.
 *   5. DIAGNOSTICS — structured evidence explaining slow/stuck loads.
 *   6. SAFE RECOVERY — bounded retry, then BLOCKED/NEEDS_HUMAN (never kill/reopen loop).
 *
 * This module is transport-agnostic: it uses the MCP `manage_instance`,
 * `get_connected_instances`, and `get_project_structure` tools via a
 * `StudioBridgeLike` surface so it can be tested with a fake MCP.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { StudioCallResult, StudioInstanceRef } from "./bridge.js";
import { createStudioBridge, type StudioBridgeLike } from "./mcp-bridge.js";
import { emitToolEvent } from "../tools/observability.js";

export type ProjectLoadState =
  | "NOT_RUNNING"        // no Studio process detected
  | "STUDIO_STARTING"    // manage_instance launch requested, no process evidence yet
  | "STUDIO_PROCESS_ALIVE" // managed Studio process alive, MCP not reachable or no instances yet
  | "PLUGIN_CONNECTING"  // MCP reachable, no connected instances yet
  | "PLUGIN_CONNECTED"   // instances exist, but not the target place
  | "PLACE_DETECTED"     // target place first sighted, first readiness probe pending
  | "PLACE_OPENING"      // target place visible, probing, within normal budgets
  | "PLACE_LOADING"      // target place visible, probing, past slow threshold, still healthy
  | "PLACE_READY"        // target place open, edit peer available, queries succeed
  | "LOAD_SLOW"          // legacy alias of PLACE_LOADING (kept for existing evidence)
  | "LOAD_TIMEOUT"       // exceeded maximum budget
  | "DISCONNECTED"       // Studio/MCP became unreachable
  | "FAILED"             // explicit error from MCP
  | "UNKNOWN";           // cannot classify

export interface ProjectLoadConfig {
  /** Budget for the launch-ack request itself (NOT the whole load). */
  launchAckTimeoutMs: number;
  /** Budget for Studio process to start and MCP to become reachable. */
  studioStartupTimeoutMs: number;
  /** Budget for plugin to connect after Studio process is up. */
  pluginConnectTimeoutMs: number;
  /** Budget for place to open and become responsive. */
  placeLoadTimeoutMs: number;
  /** Additional budget for large projects (slow but healthy). */
  slowLoadThresholdMs: number;
  /** Maximum total time to wait for PLACE_READY. */
  maxTotalTimeoutMs: number;
  /** Poll interval for state checks. */
  pollIntervalMs: number;
  /** Expected place name (from .rbxlx filename). */
  expectedPlaceName?: string;
  /** Launch source. Default "local_file". "baseplate" launches a lightweight
   *  empty place (used by the opt-in live harness; never game content). */
  source?: "local_file" | "baseplate";
  /** When true, a place matches when either normalized name starts with the
   *  other (needed for generated names like "Baseplate-1104-….rbxl"). */
  placeNamePrefixMatch?: boolean;
}

export const DEFAULT_PROJECT_LOAD_CONFIG: ProjectLoadConfig = {
  launchAckTimeoutMs: 30_000,         // 30s: launch-ack request only; load continues via polling
  studioStartupTimeoutMs: 120_000,    // 2 min: Studio process + MCP handshake
  pluginConnectTimeoutMs: 60_000,     // 1 min: plugin registers with MCP
  placeLoadTimeoutMs: 180_000,        // 3 min: place file load + initial render
  slowLoadThresholdMs: 60_000,        // 1 min: warn if still loading
  maxTotalTimeoutMs: 600_000,         // 10 min: hard ceiling
  pollIntervalMs: 5_000,              // 5 sec
};

export interface ProjectLoadEvidence {
  requestedPlacePath: string;
  expectedPlaceName?: string;
  actualPlaceName?: string;
  instanceId?: string;
  launchId?: string;
  multiplayerGroupId?: string;
  state: ProjectLoadState;
  transitions: ProjectLoadTransition[];
  /** Structured diagnostics for slow/stuck loads. */
  diagnostics: LoadDiagnostics;
  /** Non-fatal warnings. */
  advisoryMessages: string[];
  /** Whether the project eventually reached PLACE_READY. */
  ready: boolean;
  /** Whether a recovery was attempted. */
  recoveryAttempted: boolean;
  recoveryError?: string;
  /** True when the launch-ack request was inconclusive (timeout/transport) and
   *  readiness was verified purely through follow-up status polling. */
  launchAckInconclusive?: boolean;
  /** Internal tracking: target place has been sighted at least once. */
  seenTarget?: boolean;
}

export interface ProjectLoadTransition {
  from: ProjectLoadState;
  to: ProjectLoadState;
  reason: string;
  timestampMs: number;
}

export interface LoadDiagnostics {
  projectFileSizeBytes?: number;
  studioProcessDetected: boolean;
  studioPid?: number;
  launchId?: string;
  /** True when a managed Studio process is observed alive (via status). */
  processAlive: boolean;
  mcpReachable: boolean;
  pluginConnected: boolean;
  connectedInstances: StudioInstanceRef[];
  /** Number of Studio launches this loader attempted (single-instance guard). */
  launchesAttempted: number;
  /** Most recent non-terminal load state observed. */
  lastState?: ProjectLoadState;
  /** Which budget (if any) produced the terminal timeout. */
  timeoutCategory?: "studio-startup" | "plugin-connect" | "place-load" | "max-total" | "mcp-unreachable";
  elapsedMs: number;
  lastProbeMs: number;
  probeCount: number;
  lastError?: string;
}

export interface ProjectLoadResult {
  ok: boolean;
  state: ProjectLoadState;
  message: string;
  evidence: ProjectLoadEvidence;
  /** Only set when ok=true and state=PLACE_READY. */
  bridge?: StudioBridgeLike;
}

/** Default path to the MCP auth token file. */
const DEFAULT_AUTH_FILE = path.join(os.homedir(), ".robloxstudio-mcp", "auth-token");

/** MCP tool surface the loader needs. */
export interface StudioProjectLoaderOps {
  manageInstance(args: ManageInstanceArgs): Promise<StudioCallResult>;
  /** Managed-launch status lifecycle (process alive? failed? connected?). */
  manageStatus(): Promise<StudioCallResult>;
  getConnectedInstances(): Promise<StudioCallResult>;
  getProjectStructure(args: { path?: string; maxDepth?: number; instance_id?: string }): Promise<StudioCallResult>;
  getRuntimeLogs(args: { tail?: number; instance_id?: string }): Promise<StudioCallResult>;
}

/** One managed Studio process as reported by `manage_instance` status. */
export interface ManagedProcessInfo {
  launchId?: string;
  instanceId?: string;
  pid?: number;
  /** Raw lifecycle state, e.g. launching/connected/failed/exited. */
  state: string;
  connected: boolean;
  /** Whether the OS process is still running (independent of plugin state). */
  processRunning: boolean;
  roles: string[];
  source?: string;
  localPlaceFile?: string;
  failureReason?: string;
}

/** Parse a `manage_instance` status result into process info. */
export function parseManageStatus(r: StudioCallResult): {
  ok: boolean;
  reachable: boolean;
  processes: ManagedProcessInfo[];
  connectedInstanceIds: string[];
  message: string;
} {
  if (!r.ok) return { ok: false, reachable: false, processes: [], connectedInstanceIds: [], message: r.message };
  const sc = (r.data ?? {}) as {
    managed?: Array<Record<string, unknown>>;
    connected?: Array<Record<string, unknown>>;
  };
  const managed = Array.isArray(sc.managed) ? sc.managed : [];
  const connected = Array.isArray(sc.connected) ? sc.connected : [];
  const processes: ManagedProcessInfo[] = managed.map((m) => ({
    launchId: typeof m.launch_id === "string" ? m.launch_id : undefined,
    instanceId: typeof m.instance_id === "string" ? m.instance_id : undefined,
    pid: typeof m.pid === "number" ? m.pid : undefined,
    state: typeof m.state === "string" ? m.state : "unknown",
    connected: m.connected === true,
    processRunning: m.process_running === true || m.process_observation_status === "running",
    roles: Array.isArray(m.roles) ? (m.roles as unknown[]).filter((x): x is string => typeof x === "string") : [],
    source: typeof m.source === "string" ? m.source : undefined,
    localPlaceFile: typeof m.local_place_file === "string" ? m.local_place_file : undefined,
    failureReason:
      typeof m.failure_reason === "string"
        ? m.failure_reason
        : typeof m.message === "string"
          ? m.message
          : undefined,
  }));
  const connectedInstanceIds = connected
    .map((c) => (typeof c.instance_id === "string" ? c.instance_id : ""))
    .filter((s) => s.length > 0);
  return { ok: true, reachable: true, processes, connectedInstanceIds, message: r.message };
}

export interface ManageInstanceArgs {
  action: "launch" | "status" | "close";
  source?: "baseplate" | "local_file" | "published_place" | "place_revision";
  local_place_file?: string;
  place_id?: number;
  place_version?: number;
  wait_for_connection?: boolean;
  timeout_ms?: number;
  instance_id?: string;
  launch_id?: string;
}

/**
 * Resolve config from environment overrides (AI_FACTORY_STUDIO_LOAD_*) + per-call overrides.
 */
export function resolveProjectLoadConfig(
  overrides?: Partial<ProjectLoadConfig>,
  env?: NodeJS.ProcessEnv
): ProjectLoadConfig {
  const e = env ?? process.env;
  const getNumber = (envKey: string, overrideKey: keyof ProjectLoadConfig, fallback: number): number => {
    const v = Number(e[envKey]);
    if (Number.isFinite(v) && v > 0) return v;
    const overrideVal = overrides?.[overrideKey];
    if (typeof overrideVal === "number") return overrideVal;
    return fallback;
  };
  return {
    launchAckTimeoutMs: getNumber("AI_FACTORY_STUDIO_LOAD_LAUNCH_MS", "launchAckTimeoutMs", DEFAULT_PROJECT_LOAD_CONFIG.launchAckTimeoutMs),
    studioStartupTimeoutMs: getNumber("AI_FACTORY_STUDIO_LOAD_STARTUP_MS", "studioStartupTimeoutMs", DEFAULT_PROJECT_LOAD_CONFIG.studioStartupTimeoutMs),
    pluginConnectTimeoutMs: getNumber("AI_FACTORY_STUDIO_LOAD_PLUGIN_MS", "pluginConnectTimeoutMs", DEFAULT_PROJECT_LOAD_CONFIG.pluginConnectTimeoutMs),
    placeLoadTimeoutMs: getNumber("AI_FACTORY_STUDIO_LOAD_PLACE_MS", "placeLoadTimeoutMs", DEFAULT_PROJECT_LOAD_CONFIG.placeLoadTimeoutMs),
    slowLoadThresholdMs: getNumber("AI_FACTORY_STUDIO_LOAD_SLOW_MS", "slowLoadThresholdMs", DEFAULT_PROJECT_LOAD_CONFIG.slowLoadThresholdMs),
    maxTotalTimeoutMs: getNumber("AI_FACTORY_STUDIO_LOAD_MAX_MS", "maxTotalTimeoutMs", DEFAULT_PROJECT_LOAD_CONFIG.maxTotalTimeoutMs),
    pollIntervalMs: getNumber("AI_FACTORY_STUDIO_LOAD_POLL_MS", "pollIntervalMs", DEFAULT_PROJECT_LOAD_CONFIG.pollIntervalMs),
    expectedPlaceName: overrides?.expectedPlaceName,
    source: overrides?.source,
    placeNamePrefixMatch: overrides?.placeNamePrefixMatch,
  };
}

/** Extract place name from .rbxlx file path. */
export function placeNameFromPath(placePath: string): string {
  // Normalize both forward and backward slashes for cross-platform compatibility
  const normalized = placePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? placePath;
  return base.replace(/\.rbxlx?$/i, "");
}

/**
 * Create a loader ops adapter from a StudioBridgeLike (MCP or HTTP bridge).
 * The bridge must have access to the robloxstudio MCP server's manage_instance tool.
 */
export function createProjectLoaderOps(bridge: StudioBridgeLike): StudioProjectLoaderOps {
  return {
    manageInstance: (args) => bridge.callTool("manage_instance", args as unknown as Record<string, unknown>),
    manageStatus: () => bridge.callTool("manage_instance", { action: "status" }),
    getConnectedInstances: () => bridge.callTool("get_connected_instances", {}),
    getProjectStructure: (args) => bridge.callTool("get_project_structure", args),
    getRuntimeLogs: (args) => bridge.callTool("get_runtime_logs", args),
  };
}

/** Empty evidence template. */
function emptyEvidence(requestedPlacePath: string, expectedPlaceName?: string): ProjectLoadEvidence {
  return {
    requestedPlacePath,
    expectedPlaceName,
    state: "NOT_RUNNING",
    transitions: [],
    diagnostics: {
      studioProcessDetected: false,
      processAlive: false,
      mcpReachable: false,
      pluginConnected: false,
      connectedInstances: [],
      launchesAttempted: 0,
      elapsedMs: 0,
      lastProbeMs: 0,
      probeCount: 0,
    },
    advisoryMessages: [],
    ready: false,
    recoveryAttempted: false,
    launchId: undefined,
  };
}

function recordTransition(
  evidence: ProjectLoadEvidence,
  from: ProjectLoadState,
  to: ProjectLoadState,
  reason: string
): void {
  evidence.transitions.push({ from, to, reason, timestampMs: Date.now() });
  evidence.state = to;
  emitToolEvent({
    type: "studio.load.state",
    message: `studio load ${from} → ${to} (${reason})`,
    data: { from, to, reason, place: evidence.expectedPlaceName },
  });
}

/**
 * Main entry: load a Roblox project (.rbxlx) into Studio and wait for readiness.
 *
 * Strategy:
 *   1. Check for existing healthy Studio with the correct place.
 *   2. If found and ready, reuse it.
 *   3. If Studio exists but wrong place, close it (safe).
 *   4. Launch new Studio with the target place.
 *   5. Poll through explicit states with bounded timeouts.
 *   6. Return bridge only when PLACE_READY is confirmed.
 */
export async function loadProject(
  ops: StudioProjectLoaderOps,
  placePath: string,
  config?: Partial<ProjectLoadConfig>
): Promise<ProjectLoadResult> {
  const resolvedConfig = resolveProjectLoadConfig(config);
  const expectedPlaceName = resolvedConfig.expectedPlaceName ?? placeNameFromPath(placePath);
  const start = Date.now();

  const evidence = emptyEvidence(placePath, expectedPlaceName);
  let state: ProjectLoadState = "NOT_RUNNING";
  const source = resolvedConfig.source ?? "local_file";

  // Track project file size for diagnostics (local files only).
  if (source === "local_file") {
    try {
      const stat = await fs.stat(placePath);
      evidence.diagnostics.projectFileSizeBytes = stat.size;
      if (stat.size > 50_000_000) {
        evidence.advisoryMessages.push(`Large project file (${Math.round(stat.size / 1_000_000)} MB) — extended load time expected`);
      }
    } catch {
      evidence.advisoryMessages.push("Could not stat project file");
    }
  }

  recordTransition(evidence, "NOT_RUNNING", "STUDIO_STARTING", "checking existing Studio");

  // ── Phase 0: Check for existing connected Studio with correct place ──
  const existing = await probeExistingStudio(ops, evidence, expectedPlaceName, resolvedConfig, resolvedConfig.placeNamePrefixMatch ?? false);
  if (existing.reuse) {
    evidence.ready = true;
    recordTransition(evidence, state, "PLACE_READY", `reused existing Studio (${existing.instanceId})`);
    return { ok: true, state: "PLACE_READY", message: `Reused existing Studio (${existing.instanceId})`, evidence, bridge: existing.bridge };
  }

  // Same place, but not ready yet: the owned Studio is still loading.
  // Keep polling it — never close/relaunch a healthy same-place load.
  if (existing.instanceId && existing.samePlace) {
    evidence.instanceId = existing.instanceId;
    evidence.advisoryMessages.push(
      `Reusing owned Studio instance ${existing.instanceId} (same place, still loading) — no new launch`
    );
    recordTransition(evidence, state, "PLACE_DETECTED", "reusing owned loading Studio, polling for readiness");
    state = "PLACE_DETECTED";
  } else {
    // Different place (or nothing usable): close the wrong-place instance
    // cleanly first, then launch exactly once.
    if (existing.instanceId && !existing.reuse) {
      recordTransition(evidence, state, "STUDIO_STARTING", `closing existing Studio with different place (${existing.instanceId})`);
      await closeStudio(ops, existing.instanceId);
      evidence.advisoryMessages.push(`Closed existing Studio instance ${existing.instanceId} (different place)`);
    }

    // ── Phase 0b: check managed-launch status before launching.
    // An owned launch for the same place file may already be in flight
    // (previous attempt, or another poller). Never double-launch it.
    const ownedLaunch = await probeOwnedLaunch(ops, evidence, placePath, source);
    if (ownedLaunch.inFlight) {
      evidence.launchId = ownedLaunch.launchId ?? evidence.launchId;
      if (ownedLaunch.launchId) evidence.diagnostics.launchId = ownedLaunch.launchId;
      evidence.advisoryMessages.push(
        `Found owned launch in flight (${ownedLaunch.launchId ?? "unknown launch"} for ${placePath}) — polling, no new launch`
      );
      recordTransition(evidence, state, "STUDIO_PROCESS_ALIVE", "owned launch already in flight, polling");
      state = "STUDIO_PROCESS_ALIVE";
    } else {
      // ── Phase 1: Launch Studio with the target place (exactly once) ──
      recordTransition(evidence, state, "STUDIO_STARTING", `launching Studio (${source}) with target place`);
      const launchResult = await launchStudio(ops, placePath, resolvedConfig, evidence);
      if (!launchResult.ok) {
        return { ok: false, state: launchResult.state, message: launchResult.message, evidence };
      }
      if (launchResult.inconclusive) {
        evidence.launchAckInconclusive = true;
      }
      state = "STUDIO_STARTING";
    }
  }

  // ── Phase 2-5: Poll through explicit states ──
  const maxTotalDeadline = start + resolvedConfig.maxTotalTimeoutMs;
  let slowWarned = false;
  let lastPolledState: ProjectLoadState = state;
  
  while (Date.now() < maxTotalDeadline) {
    const probe = await probeState(ops, evidence, expectedPlaceName, resolvedConfig, start);
    
    // Record state transition if changed
    if (probe.state !== lastPolledState) {
      recordTransition(evidence, lastPolledState, probe.state, "polled state change");
      lastPolledState = probe.state;
    }

    state = probe.state;
    evidence.diagnostics = probe.diagnostics;
    if (probe.state !== "PLACE_READY") {
      evidence.diagnostics.lastState = probe.state;
    }
    evidence.diagnostics.elapsedMs = Date.now() - start;
    evidence.diagnostics.probeCount += 1;
    evidence.diagnostics.lastProbeMs = Date.now();

    // Log progress at reasonable intervals
    if (probe.state !== "STUDIO_STARTING" || probe.diagnostics.probeCount % 6 === 0) {
      emitToolEvent({
        type: "studio.load.progress",
        message: `studio load ${probe.state} (${Math.round(probe.diagnostics.elapsedMs / 1000)}s)`,
        data: { state: probe.state, elapsedSec: Math.round(probe.diagnostics.elapsedMs / 1000), place: expectedPlaceName },
      });
    }

    if (probe.state === "PLACE_READY") {
      evidence.ready = true;
      // Add advisory if load was slow but eventually succeeded
      if (probe.diagnostics.elapsedMs > resolvedConfig.slowLoadThresholdMs && !slowWarned) {
        slowWarned = true;
        evidence.advisoryMessages.push(`Load slow but healthy (${Math.round(probe.diagnostics.elapsedMs / 1000)}s) — completed successfully`);
      }
      const instanceId = probe.instanceId as string;
      const bridge = await createBridgeForInstance(ops, instanceId, expectedPlaceName);
      return { ok: true, state: "PLACE_READY", message: `Project ready after ${Math.round(probe.diagnostics.elapsedMs / 1000)}s`, evidence, bridge };
    }

    if ((probe.state === "LOAD_SLOW" || probe.state === "PLACE_LOADING") && !slowWarned) {
      slowWarned = true;
      evidence.advisoryMessages.push(`Load slow but healthy (${Math.round(probe.diagnostics.elapsedMs / 1000)}s) — continuing to wait`);
    }

    if (probe.state === "LOAD_TIMEOUT" || probe.state === "FAILED" || probe.state === "DISCONNECTED") {
      return { ok: false, state: probe.state, message: probe.message, evidence };
    }

    await sleep(Math.max(100, resolvedConfig.pollIntervalMs));
  }

  // Max total timeout exceeded
  evidence.diagnostics.elapsedMs = Date.now() - start;
  evidence.diagnostics.timeoutCategory = "max-total";
  evidence.diagnostics.lastState = state;
  return { ok: false, state: "LOAD_TIMEOUT", message: `Project load exceeded maximum budget (${Math.round(resolvedConfig.maxTotalTimeoutMs / 1000)}s)`, evidence };
}

/** Probe for existing Studio instance with the expected place. */
async function probeExistingStudio(
  ops: StudioProjectLoaderOps,
  evidence: ProjectLoadEvidence,
  expectedPlaceName: string,
  config: ProjectLoadConfig,
  prefixMatch = false
): Promise<{ reuse: boolean; samePlace: boolean; instanceId?: string; bridge?: StudioBridgeLike }> {
  let r: StudioCallResult;
  try {
    r = await ops.getConnectedInstances();
  } catch {
    return { reuse: false, samePlace: false };
  }
  if (!r.ok) return { reuse: false, samePlace: false };

  const sc = (r.data ?? {}) as { instances?: StudioInstanceRef[]; multiplayerGroups?: unknown[] };
  const instances = Array.isArray(sc.instances) ? sc.instances : [];
  evidence.diagnostics.connectedInstances = instances;
  evidence.diagnostics.mcpReachable = true;
  if (instances.length > 0) {
    evidence.diagnostics.pluginConnected = true;
  }

  for (const inst of instances) {
    if (inst.placeName && placeNameMatches(inst.placeName, expectedPlaceName, prefixMatch)) {
      // Found matching place — verify it's actually ready
      const ready = await verifyPlaceReady(ops, inst.id, expectedPlaceName);
      if (ready) {
        evidence.instanceId = inst.id;
        evidence.actualPlaceName = inst.placeName;
        return { reuse: true, samePlace: true, instanceId: inst.id };
      }
      // Same place but not ready yet: the owned Studio is still loading.
      // Report it so the caller polls instead of closing/relaunching.
      evidence.advisoryMessages.push(`Found matching place ${inst.placeName} but not yet ready`);
      return { reuse: false, samePlace: true, instanceId: inst.id };
    }
  }
  const other = instances[0];
  return { reuse: false, samePlace: false, instanceId: other?.id };
}

/**
 * Check managed-launch status for an owned launch already in flight for the
 * same place file. This is what prevents duplicate launches when a previous
 * attempt (or a parallel poller) already started Studio.
 */
async function probeOwnedLaunch(
  ops: StudioProjectLoaderOps,
  evidence: ProjectLoadEvidence,
  placePath: string,
  expectedSource = "local_file"
): Promise<{ inFlight: boolean; launchId?: string; pid?: number }> {
  let status: ReturnType<typeof parseManageStatus>;
  try {
    status = parseManageStatus(await ops.manageStatus());
  } catch {
    return { inFlight: false };
  }
  if (!status.ok || !status.reachable) return { inFlight: false };
  const wanted = placePath.replace(/\\/g, "/").toLowerCase();
  for (const p of status.processes) {
    const state = p.state.toLowerCase();
    const failedLike = /failed|exited|error|closed/.test(state) && !p.connected;
    if (failedLike && !p.processRunning) continue; // truly dead process
    if (failedLike && !isTimeoutLike(p.failureReason ?? "")) continue; // hard failure: concrete evidence the launch is unusable
    const alive = p.connected || p.processRunning || /launching|running|starting|connected/.test(state);
    if (!alive) continue;
    const sameFile =
      typeof p.localPlaceFile === "string" && p.localPlaceFile.replace(/\\/g, "/").toLowerCase() === wanted;
    const sameBaseplateLaunch = expectedSource === "baseplate" && p.source === "baseplate";
    const sameInstance =
      typeof p.instanceId === "string" && p.instanceId.length > 0 && p.instanceId === evidence.instanceId;
    if (sameFile || sameBaseplateLaunch || sameInstance) {
      evidence.diagnostics.studioProcessDetected = true;
      evidence.diagnostics.processAlive = true;
      if (typeof p.pid === "number") evidence.diagnostics.studioPid = p.pid;
      return { inFlight: true, launchId: p.launchId, pid: p.pid };
    }
  }
  return { inFlight: false };
}

/**
 * Verify a place is actually responsive (edit peer available, structure query
 * works). Accepts the known structural payload shapes — the real server's
 * exact `get_project_structure` envelope varies, so readiness means "the
 * query succeeded AND returned something structural", never list presence.
 */
export function isStructurePayloadReady(data: unknown): boolean {
  if (data == null || typeof data !== "object") return false;
  const sc = data as { root?: unknown; name?: unknown; children?: unknown; tree?: unknown; path?: unknown; services?: unknown };
  if (typeof sc.root === "string") return sc.root.length > 0;
  if (typeof sc.name === "string") return sc.name.length > 0;
  if (sc.tree != null && typeof sc.tree === "object") return true;
  if (typeof sc.path === "string") return sc.path.length > 0;
  // Live server shape (verified 2026-09-19): a service overview envelope
  // {note, type:"service_overview", timestamp, services:[...]}.
  if (Array.isArray(sc.services)) return sc.services.length > 0;
  // NOTE: a bare `children` array with no root/name/tree/path/services
  // counts as "still loading", not ready — a partial tree without an anchor.
  return false;
}

/** Top-level keys of a structure payload (for honest load diagnostics). */
export function structurePayloadKeys(data: unknown): string[] {
  if (data == null || typeof data !== "object") return [];
  try {
    return Object.keys(data as Record<string, unknown>).slice(0, 12);
  } catch {
    return [];
  }
}

async function verifyPlaceReady(
  ops: StudioProjectLoaderOps,
  instanceId: string,
  expectedPlaceName: string
): Promise<boolean> {
  try {
    // Quick probe: get_project_structure at root
    const r = await ops.getProjectStructure({ path: "game", maxDepth: 1, instance_id: instanceId });
    if (!r.ok) return false;
    return isStructurePayloadReady(r.data);
  } catch {
    return false;
  }
}

/**
 * Launch Studio with the target place via manage_instance.
 *
 * DECOUPLED: the request itself is a quick acknowledgement
 * (wait_for_connection=false, short launch-ack budget). All long waiting
 * happens in bounded status/instance polling — never in one held request.
 * A transport/timeout failure of the ack is NOT a launch failure on its own:
 * the follow-up status poll is authoritative.
 */
async function launchStudio(
  ops: StudioProjectLoaderOps,
  placePath: string,
  config: ProjectLoadConfig,
  evidence: ProjectLoadEvidence
): Promise<{ ok: boolean; state: ProjectLoadState; message: string; inconclusive?: boolean }> {
  evidence.diagnostics.launchesAttempted += 1;
  const source = config.source ?? "local_file";
  let r: StudioCallResult;
  try {
    r = await ops.manageInstance({
      action: "launch",
      source,
      ...(source === "local_file" ? { local_place_file: placePath } : {}),
      wait_for_connection: false, // We'll poll ourselves
      timeout_ms: Math.min(config.launchAckTimeoutMs, 60_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    evidence.diagnostics.lastError = msg;
    evidence.advisoryMessages.push(
      `Launch-ack request threw (${msg}) — launch may still be in flight; verifying via status polling`
    );
    return { ok: true, state: "STUDIO_STARTING", message: "Launch acknowledgement inconclusive; verifying via status", inconclusive: true };
  }

  if (!r.ok) {
    if (isTimeoutLike(r.message)) {
      evidence.diagnostics.lastError = r.message;
      evidence.advisoryMessages.push(
        `Launch-ack timed out (${r.message.slice(0, 200)}) — launch may still be in flight; verifying via status polling`
      );
      return { ok: true, state: "STUDIO_STARTING", message: "Launch acknowledgement timed out; verifying via status", inconclusive: true };
    }
    const msg = (r.data as { message?: string } | undefined)?.message ?? r.message;
    evidence.diagnostics.lastError = msg;
    return { ok: false, state: "FAILED", message: `manage_instance launch failed: ${msg}` };
  }

  // Extract instance_id and launch_id from response if available
  const sc = (r.data ?? {}) as { instance_id?: string; launch_id?: string };
  if (sc.instance_id) evidence.instanceId = sc.instance_id;
  if (sc.launch_id) {
    evidence.launchId = sc.launch_id;
    evidence.diagnostics.launchId = sc.launch_id;
  }

  evidence.diagnostics.studioProcessDetected = true;
  return { ok: true, state: "STUDIO_STARTING", message: "Studio launch requested" };
}

function isTimeoutLike(message: string): boolean {
  return /timed?\s*out|timeout|deadline|aborted|abort|econnreset|socket hang up|temporarily unavailable|try again/i.test(message ?? "");
}

/** Close a Studio instance by instance_id. */
async function closeStudio(ops: StudioProjectLoaderOps, instanceId: string): Promise<void> {
  try {
    await ops.manageInstance({ action: "close", instance_id: instanceId });
  } catch {
    // best effort
  }
}

/**
 * Poll current load state.
 *
 * Process health (managed-launch status) and plugin health (connected
 * instances) are observed SEPARATELY so a healthy Studio process that is
 * still loading a large place is never misreported as an MCP failure:
 *   - process alive + MCP unreachable  → STUDIO_PROCESS_ALIVE
 *   - MCP reachable + zero instances   → PLUGIN_CONNECTING
 *   - instances, no target place       → PLUGIN_CONNECTED
 *   - target sighted first time        → PLACE_DETECTED
 *   - target probing, within budgets   → PLACE_OPENING
 *   - target probing, past slow mark   → PLACE_LOADING (healthy, sustained)
 * Only max-total expiry, a dead process, or an explicit failure produce
 * LOAD_TIMEOUT / FAILED. A plugin-connect timeout on a live process only
 * adds an advisory and keeps polling.
 */
async function probeState(
  ops: StudioProjectLoaderOps,
  evidence: ProjectLoadEvidence,
  expectedPlaceName: string,
  config: ProjectLoadConfig,
  start: number
): Promise<{ state: ProjectLoadState; diagnostics: LoadDiagnostics; message: string; instanceId?: string }> {
  const elapsed = Date.now() - start;
  const diagnostics = { ...evidence.diagnostics, elapsedMs: elapsed, probeCount: evidence.diagnostics.probeCount + 1 };

  // ── Managed-launch status: is the Studio process itself alive? ──
  let statusOk = false;
  let processAlive = false;
  try {
    const status = parseManageStatus(await ops.manageStatus());
    statusOk = status.ok && status.reachable;
    for (const p of status.processes) {
      const st = p.state.toLowerCase();
      if (/failed|exited|error|closed/.test(st) && !p.connected) {
        const isOurs = Boolean(p.launchId && evidence.launchId && p.launchId === evidence.launchId);
        // Server supervision timeout with a live process is NOT terminal:
        // the plugin frequently registers after the server's deadline
        // (observed live). Keep polling; the place may still become ready.
        if (p.processRunning && isTimeoutLike(p.failureReason ?? "")) {
          processAlive = true;
          diagnostics.processAlive = true;
          if (typeof p.pid === "number") diagnostics.studioPid = p.pid;
          if (p.launchId && !evidence.launchId) {
            evidence.launchId = p.launchId;
            diagnostics.launchId = p.launchId;
          }
          const note = `Server supervision timed out (${p.failureReason}) but Studio process is still running — continuing to poll, no relaunch`;
          if (!evidence.advisoryMessages.some((m) => m.includes("supervision timed out"))) {
            evidence.advisoryMessages.push(note);
          }
          continue;
        }
        if (isOurs || !p.processRunning) {
          diagnostics.processAlive = false;
          diagnostics.lastError = p.failureReason ?? `managed launch ${p.state}`;
          diagnostics.timeoutCategory = undefined;
          diagnostics.lastState = "FAILED";
          return {
            state: "FAILED",
            diagnostics,
            message: `Studio launch failed (${p.failureReason ?? p.state}) — will not relaunch automatically`,
          };
        }
        continue;
      }
      const alive = p.connected || p.processRunning || /launching|running|starting|connected/.test(st);
      if (alive) {
        processAlive = true;
        if (typeof p.pid === "number") diagnostics.studioPid = p.pid;
        if (p.launchId && !evidence.launchId) {
          evidence.launchId = p.launchId;
          diagnostics.launchId = p.launchId;
        }
      }
    }
  } catch {
    // Status probe is best-effort; instance polling below is authoritative.
  }
  diagnostics.processAlive = processAlive;
  if (processAlive) {
    evidence.diagnostics.studioProcessDetected = true;
    diagnostics.studioProcessDetected = true;
  }

  // ── Connected instances: is the plugin up, and is our place there? ──
  let instances: StudioInstanceRef[] = [];
  let instancesOk = false;
  try {
    const r = await ops.getConnectedInstances();
    if (r.ok) {
      instancesOk = true;
      const sc = (r.data ?? {}) as { instances?: StudioInstanceRef[]; multiplayerGroups?: unknown[] };
      instances = Array.isArray(sc.instances) ? sc.instances : [];
    }
  } catch {
    instancesOk = false;
  }
  diagnostics.mcpReachable = instancesOk;
  diagnostics.connectedInstances = instances;

  if (!instancesOk) {
    diagnostics.pluginConnected = false;
    if (processAlive) {
      // Healthy process, but the MCP bridge itself is unreachable. Give it
      // the studio-startup budget to appear; past that the bridge (not the
      // game) is the blocker.
      if (elapsed > config.studioStartupTimeoutMs) {
        diagnostics.timeoutCategory = "mcp-unreachable";
        diagnostics.lastState = "STUDIO_PROCESS_ALIVE";
        return { state: "DISCONNECTED", diagnostics, message: "MCP unreachable though Studio process is alive (past studio-startup budget)" };
      }
      return { state: "STUDIO_PROCESS_ALIVE", diagnostics, message: "Studio process alive, waiting for MCP/instances..." };
    }
    if (elapsed > config.studioStartupTimeoutMs) {
      diagnostics.timeoutCategory = "mcp-unreachable";
      diagnostics.lastState = "STUDIO_STARTING";
      return { state: "DISCONNECTED", diagnostics, message: "MCP unreachable after studio startup timeout" };
    }
    return { state: "STUDIO_STARTING", diagnostics, message: "Waiting for MCP..." };
  }

  if (instances.length === 0) {
    diagnostics.pluginConnected = false;
    if (processAlive) {
      // Process alive, MCP reachable, no instances: plugin still connecting.
      // Never fail a healthy load here — only the max-total budget stops us.
      if (elapsed > config.maxTotalTimeoutMs) {
        diagnostics.timeoutCategory = "max-total";
        diagnostics.lastState = "PLUGIN_CONNECTING";
        return { state: "LOAD_TIMEOUT", diagnostics, message: "Max total budget exceeded with no connected instances (process was alive)" };
      }
      return { state: "PLUGIN_CONNECTING", diagnostics, message: "MCP reachable, waiting for plugin instances..." };
    }
    if (elapsed > config.studioStartupTimeoutMs) {
      diagnostics.timeoutCategory = "studio-startup";
      diagnostics.lastState = "STUDIO_STARTING";
      return { state: "LOAD_TIMEOUT", diagnostics, message: "No instances after studio startup timeout" };
    }
    return { state: "STUDIO_STARTING", diagnostics, message: "Studio starting, no instances yet" };
  }

  // Check if our expected place is among instances
  const prefixMatch = config.placeNamePrefixMatch ?? false;
  const targetInstance = instances.find((inst) => inst.placeName && placeNameMatches(inst.placeName, expectedPlaceName, prefixMatch));
  if (!targetInstance) {
    // Instances exist but not our place.
    diagnostics.pluginConnected = true;
    if (elapsed > config.maxTotalTimeoutMs) {
      diagnostics.timeoutCategory = "max-total";
      diagnostics.lastState = "PLUGIN_CONNECTED";
      return { state: "LOAD_TIMEOUT", diagnostics, message: `Max total budget exceeded without expected place ${expectedPlaceName}` };
    }
    if (elapsed > config.pluginConnectTimeoutMs) {
      diagnostics.lastState = "PLUGIN_CONNECTED";
      return { state: "PLUGIN_CONNECTED", diagnostics, message: `Studio running but ${expectedPlaceName} not loaded yet (past plugin-connect budget, still polling — process healthy)` };
    }
    return { state: "PLUGIN_CONNECTED", diagnostics, message: `Studio running but ${expectedPlaceName} not loaded yet` };
  }

  // Found matching place
  evidence.instanceId = targetInstance.id;
  evidence.actualPlaceName = targetInstance.placeName;
  diagnostics.pluginConnected = true;
  const firstSighting = !evidence.seenTarget;
  evidence.seenTarget = true;

  // Check if place is responsive
  const ready = await verifyPlaceReady(ops, targetInstance.id, expectedPlaceName);
  if (ready) {
    return { state: "PLACE_READY", diagnostics, message: "Place ready and responsive", instanceId: targetInstance.id };
  }
  if (firstSighting) {
    return { state: "PLACE_DETECTED", diagnostics, message: "Target place sighted, first readiness probe pending", instanceId: targetInstance.id };
  }

  // Place detected but not ready
  if (elapsed > config.maxTotalTimeoutMs) {
    diagnostics.timeoutCategory = "max-total";
    diagnostics.lastState = "PLACE_LOADING";
    return { state: "LOAD_TIMEOUT", diagnostics, message: "Place load exceeded maximum budget" };
  }
  if (elapsed > config.placeLoadTimeoutMs) {
    diagnostics.timeoutCategory = "place-load";
    diagnostics.lastState = "PLACE_LOADING";
    return { state: "LOAD_TIMEOUT", diagnostics, message: "Place load exceeded place load budget" };
  }
  if (elapsed > config.slowLoadThresholdMs) {
    return { state: "PLACE_LOADING", diagnostics, message: "Place loading slowly but detected", instanceId: targetInstance.id };
  }
  return { state: "PLACE_OPENING", diagnostics, message: "Place detected, waiting for readiness", instanceId: targetInstance.id };
}

/** Create a bridge configured for the ready instance. */
async function createBridgeForInstance(
  ops: StudioProjectLoaderOps,
  instanceId: string,
  expectedPlaceName: string
): Promise<StudioBridgeLike> {
  // Create a new bridge instance configured for the specific instance
  return createStudioBridge({ instanceId });
}

/** Check if place name matches expected (handles .rbxlx extension differences). */
function placeNameMatches(actual: string, expected: string, prefixMatch = false): boolean {
  const normalize = (s: string) => s.replace(/\.rbxlx?$/i, "").toLowerCase();
  const a = normalize(actual);
  const e = normalize(expected);
  if (a === e) return true;
  if (prefixMatch) return a.startsWith(e) || e.startsWith(a);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convenience: load project and run a callback with the ready bridge. */
export async function withLoadedProject<T>(
  ops: StudioProjectLoaderOps,
  placePath: string,
  fn: (bridge: StudioBridgeLike, evidence: ProjectLoadEvidence) => Promise<T>,
  config?: Partial<ProjectLoadConfig>
): Promise<{ ok: boolean; result?: T; evidence: ProjectLoadEvidence; message: string }> {
  const result = await loadProject(ops, placePath, config);
  if (!result.ok || !result.bridge) {
    return { ok: false, evidence: result.evidence, message: result.message };
  }
  try {
    const value = await fn(result.bridge, result.evidence);
    return { ok: true, result: value, evidence: result.evidence, message: result.message };
  } catch (e) {
    return { ok: false, evidence: result.evidence, message: `Callback failed: ${e instanceof Error ? e.message : e}` };
  }
}