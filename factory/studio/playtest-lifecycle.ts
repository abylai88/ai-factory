/**
 * Roblox Studio Playtest lifecycle — explicit state machine.
 *
 * The playtest controls of the Studio plugin (multiplayer_playtest,
 * solo_playtest, get_connected_instances) are fire-and-forget: a start can
 * fail with `multiplayer_start_not_detected`, a stop can land in the middle
 * of a transition, and Studio refuses to start another playtest while a
 * previous session is still winding down. Blindly re-invoking start is how
 * sessions wedge.
 *
 * This module is the single lifecycle engine used by the tool layer
 * (mcp-bridge start_playtest/stop_playtest) and by the playtest orchestrator
 * (playtest.ts / visual-qa.ts). It models the lifecycle explicitly:
 *
 *   EDIT → STARTING → RUNNING → STOPPING → EDIT
 *               ↘ STUCK / DISCONNECTED / FAILED / UNKNOWN
 *
 * and guarantees:
 *   1. SAFE START — inspect first; any non-EDIT state is recovered (stop +
 *      bounded teardown confirm) before a fresh start. Never blind double-start.
 *   2. EXPLICIT MODES — solo and multiplayer are distinct operations. A
 *      fallback (multiplayer requested, only solo available) is always
 *      recorded as `fallbackReason`. No silent mode substitution.
 *   3. BOUNDED READINESS — the lifecycle polls inspect() through explicit
 *      phases (startup → runtime) with distinct, bounded budgets. Boosted by
 *      a runtime assertion (a player actually present) when requested.
 *   4. GUARANTEED TEARDOWN — stop() always runs on the way out (unless the
 *      caller opts into leaving the session RUNNING). If EDIT is NOT
 *      confirmed within the teardown budget, `teardownUnconfirmed: true` is
 *      recorded honestly — never fabricated.
 *   5. HONEST CLASSIFICATION — infrastructure/wedged outcomes are BLOCKED
 *      (optionally `needsHuman`); genuine game failures are FAIL. Evidence is
 *      structured so statuses are observable and unverifiable.
 *
 * This module is transport-agnostic: it consumes an injected
 * `PlaytestLifecycleOps` surface (inspect/startSolo/startMultiplayer/stop) so
 * every branch is unit-testable against a fake MCP without live Studio.
 */

import type { StudioCallResult } from "./bridge.js";
import { emitToolEvent } from "../tools/observability.js";

// ── Requirements: PlaytestState values ─────────────────────────────────────
export type PlaytestState =
  | "EDIT" // Studio in edit mode, no runtime session
  | "STARTING" // playtest start requested/transitioning
  | "RUNNING" // a live server/client session is present
  | "STOPPING" // teardown in progress
  | "STUCK" // plugin thinks finished but edit mode is not restored
  | "DISCONNECTED" // Studio/bridge not reachable
  | "FAILED" // start reported a genuine (non-infra) failure
  | "UNKNOWN"; // cannot classify from available evidence

export type PlaytestMode = "solo" | "multiplayer";

/** Snapshot returned by inspect(). */
export interface PlaytestInspect {
  state: PlaytestState;
  /** Raw plugin phase string (e.g. "edit", "running", "completed"). */
  phase: string;
  connected: boolean;
  editModeReady: boolean;
  /** Runtime roles observed, e.g. ["edit","server","client-1"]. */
  roles: string[];
  serverPeerId?: string;
  clientPeerIds: string[];
  multiplayerGroupId?: string;
  message: string;
}

export interface PlaytestStart {
  ok: boolean;
  message: string;
  /** The mode the start call actually exercised. */
  mode: PlaytestMode;
  /** infra=true => infrastructure/BLOCKED at the caller, never code FAIL. */
  infra: boolean;
  /** Raw error code from the plugin, e.g. multiplayer_start_not_detected. */
  errorCode?: string;
}

export interface PlaytestStop {
  ok: boolean;
  message: string;
  /** True when EDIT could not be confirmed (session may still be stopping). */
  unconfirmed: boolean;
}

export interface PlaytestLifecycleConfig {
  /** Budget for the start call + first server/client peers to appear. */
  startupTimeoutMs: number;
  /** Budget for runtime readiness (a player actually present). */
  runtimeTimeoutMs: number;
  /** Budget to confirm EDIT after a stop. */
  teardownTimeoutMs: number;
  /** Budget to recover a stale session before starting fresh. */
  recoveryTimeoutMs: number;
  pollIntervalMs: number;
}

export const DEFAULT_PLAYTEST_CONFIG: PlaytestLifecycleConfig = {
  startupTimeoutMs: 90_000,
  runtimeTimeoutMs: 60_000,
  teardownTimeoutMs: 30_000,
  recoveryTimeoutMs: 30_000,
  pollIntervalMs: 1_000,
};

/**
 * Resolve lifecycle config from environment overrides
 * (AI_FACTORY_PLAYTEST_*) + per-call overrides. Never invented: an unset
 * env value keeps the default.
 */
export function resolvePlaytestConfig(
  overrides?: Partial<PlaytestLifecycleConfig>,
  env?: NodeJS.ProcessEnv
): PlaytestLifecycleConfig {
  const e = env ?? process.env;
  const int = (key: string, fallback: number): number => {
    const v = Number(e[key]);
    return Number.isFinite(v) && v > 0 ? v : overrides?.[key as keyof PlaytestLifecycleConfig] ?? fallback;
  };
  return {
    startupTimeoutMs: int("AI_FACTORY_PLAYTEST_STARTUP_MS", overrides?.startupTimeoutMs ?? DEFAULT_PLAYTEST_CONFIG.startupTimeoutMs),
    runtimeTimeoutMs: int("AI_FACTORY_PLAYTEST_RUNTIME_MS", overrides?.runtimeTimeoutMs ?? DEFAULT_PLAYTEST_CONFIG.runtimeTimeoutMs),
    teardownTimeoutMs: int("AI_FACTORY_PLAYTEST_TEARDOWN_MS", overrides?.teardownTimeoutMs ?? DEFAULT_PLAYTEST_CONFIG.teardownTimeoutMs),
    recoveryTimeoutMs: int("AI_FACTORY_PLAYTEST_RECOVERY_MS", overrides?.recoveryTimeoutMs ?? DEFAULT_PLAYTEST_CONFIG.recoveryTimeoutMs),
    pollIntervalMs: int("AI_FACTORY_PLAYTEST_POLL_MS", overrides?.pollIntervalMs ?? DEFAULT_PLAYTEST_CONFIG.pollIntervalMs),
  };
}

/**
 * Map an inspect snapshot to a PlaytestState.
 *
 * The tricky real-world case is the stuck transition: the plugin reports
 * phase "completed" (it considers the session finished) but edit mode is NOT
 * restored and a multiplayer group / peers are still visible — Studio still
 * refuses a new playtest. That is STUCK, not EDIT.
 */
export function inspectToState(inspect: PlaytestInspect): PlaytestState {
  if (!inspect || !inspect.connected) return "DISCONNECTED";
  const phase = (inspect.phase ?? "").toLowerCase();
  // Runtime presence is defined by server/client peers, never the edit role.
  const roleRuntime = (inspect.roles ?? []).some((r) => RUNTIME_ROLE_RE.test(r));
  const hasRuntime =
    roleRuntime ||
    (inspect.serverPeerId ?? "") !== "" ||
    (inspect.clientPeerIds ?? []).length > 0 ||
    (inspect.multiplayerGroupId ?? "") !== "";

  // Explicit, unambiguous signals first.
  if ((phase === "" || /^edit/i.test(phase)) && !hasRuntime) return "EDIT";
  if (/^running/i.test(phase) || /play/i.test(phase)) return "RUNNING";
  if (/^starting/i.test(phase)) return "STARTING";
  if (/^stopping/i.test(phase) || /^ending|^endingplay/i.test(phase)) return "STOPPING";

  // The stuck transition: finished-but-not-restored.
  if (/complete/i.test(phase) && !inspect.editModeReady) return "STUCK";

  // Fallbacks.
  if (/failed/i.test(phase) || /error/i.test(phase)) return "FAILED";
  if (/complete/i.test(phase) && inspect.editModeReady && !hasRuntime) return "EDIT";
  if (inspect.multiplayerGroupId) {
    // A group exists without a clear phase: assume it owns a live session.
    return inspect.editModeReady ? "STUCK" : "RUNNING";
  }
  return hasRuntime ? "RUNNING" : "UNKNOWN";
}

export interface PlaytestTransition {
  from: PlaytestState;
  to: PlaytestState;
  reason: string;
}

/** Allowed forward transitions for the lifecycle (informative, not fatal). */
const VALID_TRANSITIONS: Record<PlaytestState, PlaytestState[]> = {
  EDIT: ["STARTING", "UNKNOWN", "DISCONNECTED"],
  STARTING: ["RUNNING", "STOPPING", "STUCK", "FAILED", "DISCONNECTED", "EDIT", "UNKNOWN"],
  RUNNING: ["STOPPING", "STUCK", "DISCONNECTED", "EDIT", "UNKNOWN", "FAILED"],
  STOPPING: ["EDIT", "STUCK", "DISCONNECTED", "UNKNOWN"],
  STUCK: ["STOPPING", "EDIT", "DISCONNECTED", "UNKNOWN"],
  DISCONNECTED: ["EDIT", "UNKNOWN", "RUNNING", "STOPPING", "STARTING"],
  FAILED: ["EDIT", "STOPPING", "DISCONNECTED", "UNKNOWN"],
  UNKNOWN: ["EDIT", "STARTING", "RUNNING", "STOPPING", "STUCK", "DISCONNECTED", "FAILED"],
};

export function transitionPlaytestState(
  from: PlaytestState,
  to: PlaytestState,
  reason: string
): PlaytestTransition {
  return { from, to, reason };
}

// ── Ops surface the lifecycle consumes (transport-agnostic) ───────────────
export interface PlaytestLifecycleOps {
  inspect(): Promise<PlaytestInspect>;
  startMultiplayer(numPlayers?: number): Promise<PlaytestStart>;
  startSolo(): Promise<PlaytestStart>;
  stopMultiplayer(): Promise<PlaytestStop>;
  stopSolo(): Promise<PlaytestStop>;
  execute(expression: string, peer?: "server" | "client"): Promise<StudioCallResult>;
  readOutput?(): Promise<StudioCallResult>;
  screenshot?(): Promise<StudioCallResult>;
}

export interface PlaytestAssertion {
  name: string;
  expression: string;
  message: string;
}

export const PLAYER_PRESENT_ASSERTION: PlaytestAssertion = {
  name: "player-present",
  expression: "#game:GetService('Players'):GetPlayers() > 0",
  message: "at least one player present",
};

/** Structured lifecycle evidence (shared with observability and tests). */
export interface PlaytestEvidence {
  requestedMode: PlaytestMode;
  actualMode: PlaytestMode;
  fallbackReason?: string;
  startupDurationMs: number;
  runtimeDurationMs: number;
  runtimeRoles: string[];
  serverPeerId?: string;
  clientPeerIds: string[];
  multiplayerGroupId?: string;
  /** Ordered state snapshots during the lifecycle (for behavior tracing). */
  transitions: PlaytestTransition[];
  recovered: boolean;
  recoveryError?: string;
  teardownUnconfirmed: boolean;
  timedOut: boolean;
  needsHuman: boolean;
  /** Non-fatal warnings recorded during the lifecycle (e.g. no player yet). */
  advisoryMessages: string[];
}

export interface PlaytestStartResult {
  ok: boolean;
  message: string;
  blocked: boolean;
  needsHuman: boolean;
  state: PlaytestState;
  evidence: PlaytestEvidence;
  durationMs: number;
}

export interface PlaytestStopResult {
  ok: boolean;
  message: string;
  state: PlaytestState;
  teardownUnconfirmed: boolean;
  evidence: PlaytestEvidence;
  durationMs: number;
}

export interface ManagedPlaytestOptions {
  requestedMode?: PlaytestMode;
  numPlayers?: number;
  /** Wait until a live player is present on the server (runtime readiness). */
  assertRuntimeReady?: boolean;
  /** Assertions evaluated after readiness. Default: player-present. */
  assertions?: PlaytestAssertion[];
  /** Capture a screenshot after readiness (requires ops.screenshot). */
  captureScreenshot?: boolean;
  /** Leave the session RUNNING when finished (no teardown). */
  leaveRunning?: boolean;
  config?: Partial<PlaytestLifecycleConfig>;
  role?: string;
  projectDir?: string;
  /** Optional callback invoked after playtest completes, for recording readiness evidence. */
  onPlaytestEvidence?: (result: ManagedPlaytestResult) => void;
}

export interface ManagedPlaytestResult {
  status: "PASS" | "FAIL" | "BLOCKED";
  message: string;
  state: PlaytestState;
  evidence: PlaytestEvidence;
  assertions: Array<{ name: string; passed: boolean; message: string }>;
  durationMs: number;
  output: string;
  screenshot?: unknown;
  infraReason?: string;
}

// ── Evidence / event helpers ───────────────────────────────────────────────

export function emptyEvidence(requestedMode: PlaytestMode): PlaytestEvidence {
  return {
    requestedMode,
    actualMode: requestedMode,
    startupDurationMs: 0,
    runtimeDurationMs: 0,
    runtimeRoles: [] as string[],
    clientPeerIds: [] as string[],
    transitions: [] as PlaytestTransition[],
    recovered: false,
    teardownUnconfirmed: false,
    timedOut: false,
    needsHuman: false,
    advisoryMessages: [] as string[],
  };
}

export function recordTransition(
  evidence: PlaytestEvidence,
  from: PlaytestState,
  to: PlaytestState,
  reason: string
): void {
  evidence.transitions.push(transitionPlaytestState(from, to, reason));
  emitToolEvent({
    type: "playtest.state",
    role: undefined,
    message: `playtest state ${from} → ${to} (${reason})`,
    data: { from, to, reason },
  });
}

function describeState(state: PlaytestState): string {
  switch (state) {
    case "EDIT":
      return "Studio is in edit mode with no runtime session";
    case "STARTING":
      return "playtest start is in progress";
    case "RUNNING":
      return "a live playtest session is active";
    case "STOPPING":
      return "playtest teardown is in progress";
    case "STUCK":
      return "playtest session is wedged in a transition (Studio refuses a new start; edit mode not restored)";
    case "DISCONNECTED":
      return "Studio/bridge is unreachable";
    case "FAILED":
      return "the previous playtest attempt failed";
    case "UNKNOWN":
      return "lifecycle state cannot be classified from available evidence";
  }
}

// ── Readiness helpers ─────────────────────────────────────────────────────

const RUNTIME_ROLE_RE = /server|client/i;

function hasStartupPeers(inspect: PlaytestInspect): boolean {
  return (inspect.roles ?? []).some((r) => RUNTIME_ROLE_RE.test(r));
}

async function pollInspect(
  ops: PlaytestLifecycleOps,
  timeoutMs: number,
  pollIntervalMs: number,
  within: (i: PlaytestInspect) => boolean,
  fanOut: (i: PlaytestInspect) => void = () => {}
): Promise<PlaytestInspect | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const i = await ops.inspect();
    fanOut(i);
    if (within(i)) return i;
    await sleep(Math.max(50, pollIntervalMs));
  }
  // One final non-fanout read to time the deadline honestly.
  const last = await ops.inspect();
  return within(last) ? last : undefined;
}

// ── Safe start ─────────────────────────────────────────────────────────────

/**
 * Inspect → recover (if not EDIT) → start requested mode → bounded readiness.
 *
 * The returned `state` is the state reached after the bounded wait. A start
 * that cannot be confirmed as live within budget is reported BLOCKED with
 * `timedOut` + `needsHuman` true on the evidence.
 */
export async function safeStartPlaytest(
  ops: PlaytestLifecycleOps,
  opts: ManagedPlaytestOptions = {}
): Promise<PlaytestStartResult> {
  const start = Date.now();
  const role = opts.role;
  const projectDir = opts.projectDir;
  const config = resolvePlaytestConfig(opts.config);
  const requestedMode = opts.requestedMode ?? "multiplayer";

  let inspect: PlaytestInspect;
  try {
    inspect = await ops.inspect();
  } catch (e) {
    return blockedResult(`roblox_toolchain: could not inspect playtest state: ${errText(e)}`, "DISCONNECTED", emptyEvidence(requestedMode), Date.now() - start, e);
  }

  const evidence = emptyEvidence(requestedMode);
  let state = inspect.state;
  recordTransition(evidence, "UNKNOWN", state, "initial inspect");

  // ── Recover any non-EDIT state before starting. Never blind double-start.
  if (state !== "EDIT" && state !== "DISCONNECTED" && state !== "FAILED") {
    evidence.recovered = true;
    recordTransition(evidence, state, "STOPPING", "recover stale session before start");
    const recovery = await boundedRecovery(ops, config, evidence, role, projectDir);
    if (!recovery.edit) {
      return blockedResult(
        `roblox_toolchain: could not recover Studio to edit mode before starting playtest ("${inspect.message}"). State: ${state}.`,
        "STUCK",
        evidence,
        Date.now() - start,
        new Error(recovery.error ?? "recovery timed out")
      );
    }
    recordTransition(evidence, "STOPPING", "EDIT", "recovery confirmed edit mode");
    state = "EDIT";
  }

  // ── DISCONNECTED is infra BLOCKED before any start attempt.
  if (!inspect.connected) {
    return blockedResult(
      `roblox_toolchain: Studio not connected (${inspect.message}). Open Studio with the MCP plugin and retry — infrastructure, not a game-code bug.`,
      "DISCONNECTED",
      evidence,
      Date.now() - start
    );
  }

  // ── Explicit start: requested mode only. Fallback is recorded, never silent.
  recordTransition(evidence, state, "STARTING", `requesting ${requestedMode} playtest`);
  const startRes =
    requestedMode === "solo" ? await ops.startSolo() : await ops.startMultiplayer(opts.numPlayers);
  // actualMode reflects what the start call really attempted.
  const actualMode = modeOfStart(startRes, requestedMode);
  evidence.actualMode = actualMode;
  if (requestedMode !== actualMode) {
    evidence.fallbackReason = startRes.message;
  }

  let startConfirmed = startRes.ok;
  if (!startRes.ok && /multiplayer_start_not_detected/i.test(startRes.errorCode ?? "")) {
    // The plugin reports the multiplayer group did not form, but the
    // authoritative server peer can still be coming up. Verify by polling
    // the real connected_instances state before declaring failure.
    const peer = await pollInspect(
      ops,
      config.startupTimeoutMs,
      config.pollIntervalMs,
      (i) => hasStartupPeers(i)
    );
    if (peer) {
      startConfirmed = true;
      evidence.fallbackReason = `${startRes.message} (server peer confirmed after start)`;
      evidence.runtimeRoles = peer.roles ?? [];
      evidence.serverPeerId = peer.serverPeerId;
      evidence.clientPeerIds = peer.clientPeerIds ?? [];
      evidence.multiplayerGroupId = peer.multiplayerGroupId;
    }
  }

  if (!startConfirmed) {
    const blocked = startRes.infra;
    const message = blocked
      ? `roblox_toolchain: could not start ${requestedMode} playtest: ${startRes.message}`
      : `playtest failed to start (${requestedMode}): ${startRes.message}`;
    recordTransition(evidence, "STARTING", blocked ? "STUCK" : "FAILED", message);
    evidence.runtimeRoles = [];
    // A failed start may still have spawned peers; attempt bounded teardown.
    const teardown = await boundedTeardown(ops, config, role, projectDir);
    evidence.teardownUnconfirmed = teardown.unconfirmed;
    return outcomeResult(message, blocked ? "STUCK" : "FAILED", evidence, Date.now() - start, blocked);
  }

  // ── Bounded startup readiness: session → peers → server present.
  evidence.startupDurationMs = Date.now() - start;

  const startup = await pollInspect(
    ops,
    config.startupTimeoutMs,
    config.pollIntervalMs,
    (i) => hasStartupPeers(i)
  );

  if (!startup) {
    evidence.timedOut = true;
    const message = `roblox_toolchain: playtest start could not be confirmed live within ${config.startupTimeoutMs}ms. Studio may be wedged — needs human review.`;
    recordTransition(evidence, "STARTING", "STUCK", message);
    evidence.needsHuman = true;
    const teardown = await boundedTeardown(ops, config, role, projectDir);
    evidence.teardownUnconfirmed = teardown.unconfirmed;
    return blockedResult(message, "STUCK", evidence, Date.now() - start, new Error(message));
  }

  evidence.runtimeRoles = startup.roles ?? [];
  evidence.serverPeerId = startup.serverPeerId;
  evidence.clientPeerIds = startup.clientPeerIds ?? [];
  evidence.multiplayerGroupId = startup.multiplayerGroupId;
  recordTransition(evidence, "RUNNING", "RUNNING", "startup ready");

  // ── Runtime readiness: a real player present (bounded poll).
  // A live session (server + client peers confirmed) with no player yet is
  // NOT a Studio wedge — it may be a slow spawn or a genuine game bug. We
  // record an advisory and proceed; the assertions give the definitive verdict.
  if (opts.assertRuntimeReady !== false) {
    const hadPlayer = await waitForPlayer(ops, config, evidence);
    evidence.runtimeDurationMs = Date.now() - start - evidence.startupDurationMs;
    if (!hadPlayer) {
      evidence.timedOut = true;
      evidence.advisoryMessages.push(
        `no player confirmed on the server within ${config.runtimeTimeoutMs}ms — assertions will judge spawn/gameplay`
      );
    }
  }

  return {
    ok: true,
    message: actualMode === requestedMode ? `playtest running (${actualMode})` : `playtest running (${actualMode}, fallback from ${requestedMode})`,
    blocked: false,
    needsHuman: false,
    state: "RUNNING",
    evidence,
    durationMs: Date.now() - start,
  };
}

// ── Safe stop ──────────────────────────────────────────────────────────────

/**
 * Stop any active session and confirm EDIT. Idempotent: if already EDIT
 * returns immediately with teardownConfirmed true. If EDIT cannot be
 * confirmed, `teardownUnconfirmed` is honestly recorded.
 */
export async function safeStopPlaytest(
  ops: PlaytestLifecycleOps,
  opts: { role?: string; projectDir?: string; config?: Partial<PlaytestLifecycleConfig> } = {}
): Promise<PlaytestStopResult> {
  const start = Date.now();
  const config = resolvePlaytestConfig(opts.config);
  const role = opts.role;
  const projectDir = opts.projectDir;

  let inspect: PlaytestInspect;
  try {
    inspect = await ops.inspect();
  } catch (e) {
    return {
      ok: false,
      message: `roblox_toolchain: could not inspect playtest state while stopping: ${errText(e)}`,
      state: "DISCONNECTED",
      teardownUnconfirmed: true,
      evidence: emptyEvidence("multiplayer"),
      durationMs: Date.now() - start,
    };
  }

  const evidence = emptyEvidence("multiplayer");
  recordTransition(evidence, "UNKNOWN", inspect.state, "inspect before stop");
  if (inspect.state === "EDIT" || (inspect.state === "DISCONNECTED" && !inspect.connected)) {
    // Already clean — teardown is trivially confirmed (no session to stop).
    recordTransition(evidence, inspect.state, "EDIT", "no active session to stop");
    return {
      ok: true,
      message: "playtest already stopped (edit mode)",
      state: "EDIT",
      teardownUnconfirmed: false,
      evidence,
      durationMs: Date.now() - start,
    };
  }

  const teardown = await boundedTeardown(ops, config, role, projectDir);
  evidence.teardownUnconfirmed = teardown.unconfirmed;
  recordTransition(evidence, inspect.state, "STOPPING", "stop requested");
  if (teardown.unconfirmed) {
    recordTransition(evidence, "STOPPING", "STUCK", "edit mode not confirmed within budget");
    return {
      ok: false,
      message: teardown.error ?? "roblox_toolchain: could not confirm playtest teardown",
      state: "STUCK",
      teardownUnconfirmed: true,
      evidence,
      durationMs: Date.now() - start,
    };
  }
  recordTransition(evidence, "STOPPING", "EDIT", "edit mode confirmed after stop");
  return {
    ok: true,
    message: "playtest stopped (edit mode confirmed)",
    state: "EDIT",
    teardownUnconfirmed: false,
    evidence,
    durationMs: Date.now() - start,
  };
}

// ── Full managed lifecycle ────────────────────────────────────────────────

/**
 * Safe start + assertions + guaranteed teardown, returning PASS/FAIL/BLOCKED
 * with structured evidence. This is the single entry point used by
 * playtest.ts and visual-qa.ts.
 */
export async function runManagedPlaytest(
  ops: PlaytestLifecycleOps,
  opts: ManagedPlaytestOptions = {}
): Promise<ManagedPlaytestResult> {
  const start = Date.now();
  const role = opts.role;
  const projectDir = opts.projectDir;
  const assertions = opts.assertions ?? [PLAYER_PRESENT_ASSERTION];

  const started = await safeStartPlaytest(ops, opts);
  const evidence = started.evidence;
  if (!started.ok) {
    // Teardown already attempted in safeStart on the failed paths.
    const managedResult: ManagedPlaytestResult = {
      status: started.blocked ? "BLOCKED" : "FAIL",
      message: started.message,
      state: started.state,
      evidence: started.evidence,
      assertions: [],
      durationMs: Date.now() - start,
      output: "",
      ...(started.blocked ? { infraReason: started.message } : {}),
    };
    if (opts.onPlaytestEvidence) {
      try { opts.onPlaytestEvidence(managedResult); } catch { /* evidence recording must not fail the playtest */ }
    }
    return managedResult;
  }

  try {
    const assertionResults: ManagedPlaytestResult["assertions"] = [];
    let output = "";
    let screenshot: unknown;
    if (opts.captureScreenshot === true && ops.screenshot) {
      const shot = await ops.screenshot();
      if (shot.ok) {
        screenshot = shot.data;
        emitToolEvent({
          type: "screenshot.created",
          toolId: "screenshot.capture",
          role,
          projectDir,
          message: "playtest screenshot captured",
        });
      }
    }
    for (const a of assertions) {
      const r = await ops.execute(a.expression, "server");
      const passed = r.ok && /true/i.test(r.stdout.slice(0, 2000));
      assertionResults.push({
        name: a.name,
        passed,
        message: passed ? a.message : `${a.message} — FAILED (${r.message.slice(0, 300)})`,
      });
    }
    if (ops.readOutput) {
      const out = await ops.readOutput();
      output = out.ok ? out.stdout.slice(0, 4000) : "";
      const runtimeErrors = extractRuntimeErrors(output);
      for (const e of runtimeErrors.slice(0, 3)) {
        assertionResults.push({ name: "runtime-output-error", passed: false, message: `runtime error in output: ${e.slice(0, 300)}` });
      }
    }
    const failed = assertionResults.filter((a) => !a.passed);
    const message =
      failed.length > 0
        ? `playtest FAIL: ${failed.map((f) => `${f.name} — ${f.message}`).join("; ").slice(0, 600)}`
        : "playtest PASS";
    notifyLifecycle(role, projectDir, failed.length > 0 ? "FAIL" : "PASS", evidence, Date.now() - start);
    const managedResult: ManagedPlaytestResult = {
      status: failed.length > 0 ? "FAIL" : "PASS",
      message,
      state: "RUNNING",
      evidence,
      assertions: assertionResults,
      durationMs: Date.now() - start,
      output,
      screenshot,
    };
    if (opts.onPlaytestEvidence) {
      try { opts.onPlaytestEvidence(managedResult); } catch { /* evidence recording must not fail the playtest */ }
    }
    return managedResult;
  } finally {
    if (opts.leaveRunning !== true) {
      const stopped = await safeStopPlaytest(ops, { role, projectDir, config: opts.config });
      evidence.teardownUnconfirmed = stopped.teardownUnconfirmed;
      if (stopped.state !== "EDIT") {
        evidence.needsHuman = true;
      }
    }
  }
}

// ── Recovery + teardown primitives ─────────────────────────────────────────

async function boundedRecovery(
  ops: PlaytestLifecycleOps,
  config: PlaytestLifecycleConfig,
  evidence: PlaytestEvidence,
  role?: string,
  projectDir?: string
): Promise<{ edit: boolean; error?: string }> {
  const teardown = await boundedTeardown(ops, config, role, projectDir);
  if (teardown.unconfirmed) {
    evidence.recoveryError = teardown.error;
    return { edit: false, error: teardown.error };
  }
  return { edit: true };
}

async function boundedTeardown(
  ops: PlaytestLifecycleOps,
  config: PlaytestLifecycleConfig,
  role?: string,
  projectDir?: string
): Promise<{ unconfirmed: boolean; error?: string }> {
  // Stop both modes: multiplayer first, then solo. Both are idempotent in
  // the plugin and cover whichever session actually exists.
  const results: PlaytestStop[] = [];
  try {
    results.push(await ops.stopMultiplayer());
  } catch (e) {
    results.push({ ok: false, message: `stopMultiplayer threw: ${errText(e)}`, unconfirmed: true });
  }
  try {
    results.push(await ops.stopSolo());
  } catch (e) {
    results.push({ ok: false, message: `stopSolo threw: ${errText(e)}`, unconfirmed: true });
  }

  // Confirm teardown: poll until EDIT (no runtime peers), bounded by budget.
  const deadline = Date.now() + config.teardownTimeoutMs;
  let unconfirmed = results.some((r) => !r.ok);
  const lastError = results.find((r) => !r.ok)?.message;
  while (Date.now() < deadline) {
    const i = await ops.inspect();
    if (i.state === "EDIT") {
      return { unconfirmed: false };
    }
    if (i.state === "DISCONNECTED" && i.connected === false) {
      // Bridge/Studio gone entirely — there is nothing left to stop; treat
      // the teardown as confirmed the same way an already-clean session is.
      return { unconfirmed: false };
    }
    await sleep(Math.max(50, config.pollIntervalMs));
  }
  if (unconfirmed) {
    return { unconfirmed: true, error: lastError ?? "stop reported failure" };
  }
  // Timeout without confirmation.
  return { unconfirmed: true, error: `edit mode not confirmed within ${config.teardownTimeoutMs}ms after stop` };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function modeOfStart(r: PlaytestStart, requested: PlaytestMode): PlaytestMode {
  // If the call exercised a different mode than requested (fallback), trust r.mode.
  return r.mode && r.mode !== requested ? r.mode : requested;
}

async function assertPlayerPresent(
  ops: PlaytestLifecycleOps
): Promise<boolean> {
  try {
    const r = await ops.execute(PLAYER_PRESENT_ASSERTION.expression, "server");
    return r.ok && /true/i.test(r.stdout.slice(0, 2000));
  } catch {
    return false;
  }
}

async function waitForPlayer(
  ops: PlaytestLifecycleOps,
  config: PlaytestLifecycleConfig,
  evidence: PlaytestEvidence
): Promise<boolean> {
  const deadline = Date.now() + config.runtimeTimeoutMs;
  while (Date.now() < deadline) {
    if (await assertPlayerPresent(ops)) {
      evidence.runtimeRoles = evidence.runtimeRoles.length > 0 ? evidence.runtimeRoles : ["server"];
      return true;
    }
    await sleep(Math.max(50, config.pollIntervalMs));
  }
  return assertPlayerPresent(ops);
}

function blockedResult(
  message: string,
  state: PlaytestState,
  evidence: PlaytestEvidence,
  durationMs: number,
  cause?: unknown
): PlaytestStartResult {
  return outcomeResult(message, state, evidence, durationMs, true, cause);
}

/**
 * Terminal outcome for a failed safe-start. `blocked` true => infrastructure
 * (BLOCKED at the caller); false => a genuine start failure (FAIL at the
 * caller). State is STUCK for infra, FAILED otherwise.
 */
function outcomeResult(
  message: string,
  state: PlaytestState,
  evidence: PlaytestEvidence,
  durationMs: number,
  blocked: boolean,
  cause?: unknown
): PlaytestStartResult {
  emitToolEvent({
    type: blocked ? "tool.blocked" : "tool.failed",
    toolId: "studio.play",
    message,
    data: { state, evidence },
  });
  return {
    ok: false,
    message,
    blocked,
    needsHuman: blocked,
    state,
    evidence,
    durationMs,
  };
}

function notifyLifecycle(
  role: string | undefined,
  projectDir: string | undefined,
  outcome: "PASS" | "FAIL" | "BLOCKED",
  evidence: PlaytestEvidence,
  durationMs: number
): void {
  emitToolEvent({
    type: "playtest.completed",
    role,
    projectDir,
    message: `playtest ${outcome}`,
    durationMs,
    data: { outcome, evidence },
  });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function extractRuntimeErrors(output: string): string[] {
  // Try to parse as JSON first (HTTP bridge returns raw JSON response).
  // If it has an `output` field, use that (contains actual newlines).
  let text = output;
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed.output === "string") {
      text = parsed.output;
    }
  } catch {
    // Not JSON, use raw text (e.g., MCP bridge returns joined log lines).
  }
  return text
    .split("\n")
    .filter((l) => /error|stack (begin|end)|attempt to|nil|failed/i.test(l))
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}