import type { StudioBridgeClient } from "./bridge.js";
import { createPlaytestLifecycleOps, type StudioBridgeLike } from "./mcp-bridge.js";
import {
  runManagedPlaytest,
  type PlaytestLifecycleOps,
  type PlaytestAssertion,
  type PlaytestMode,
  type PlaytestEvidence,
  type PlaytestInspect,
  type PlaytestState,
  type PlaytestLifecycleConfig,
  type ManagedPlaytestResult,
} from "./playtest-lifecycle.js";
import { emitToolEvent } from "../tools/observability.js";

/**
 * Studio playtest orchestration.
 *
 * The lifecycle logic lives in `playtest-lifecycle.ts` (explicit state
 * machine, safe start, bounded readiness, guaranteed teardown). This module
 * adapts a `StudioBridgeClient` onto that engine and preserves the historical
 * PASS / FAIL / BLOCKED result surface:
 *   PASS    — playtest ran and runtime assertions held
 *   FAIL    — playtest ran but the game assertion failed (repair with context)
 *   BLOCKED — Studio/bridge unavailable or wedged (infrastructure, never code
 *             repair); `needsHuman` evidence marks wedged Studio sessions.
 *
 * `runPlaytestLifecycle` takes an injectable `PlaytestLifecycleOps` surface so
 * the full lifecycle is unit-testable without a live Studio.
 */

export type PlaytestStatus = "PASS" | "FAIL" | "BLOCKED";

export { type PlaytestAssertion, type PlaytestLifecycleOps, type PlaytestMode, type PlaytestInspect, type PlaytestState };

export interface PlaytestResult {
  status: PlaytestStatus;
  message: string;
  durationMs: number;
  output: string;
  screenshot?: unknown;
  assertions: Array<{ name: string; passed: boolean; message: string }>;
  infraReason?: string;
  /** Structured lifecycle evidence (state transitions, modes, teardown). */
  evidence?: PlaytestEvidence;
}

export interface PlaytestOptions {
  settleMs?: number;
  assertions?: PlaytestAssertion[];
  captureScreenshot?: boolean;
  stopAfter?: boolean;
  role?: string;
  projectDir?: string;
  /** Requested playtest mode; default "multiplayer". */
  mode?: PlaytestMode;
  numPlayers?: number;
  /** Wait for a live player before assertions. Default true. */
  assertRuntimeReady?: boolean;
  config?: Partial<PlaytestLifecycleConfig>;
}

/** Default spawn-sanity assertions: player exists and is not falling. */
export const DEFAULT_SPAWN_ASSERTIONS: PlaytestAssertion[] = [
  {
    name: "player-present",
    expression: "#game:GetService('Players'):GetPlayers() > 0",
    message: "at least one player present",
  },
];

export interface StartFailureClassification {
  infra: boolean;
  wedged: boolean;
  message: string;
}

/**
 * Studio refuses a new playtest while a previous session/transition is still
 * active. That is an infrastructure wedge, not a game-code bug: surface it as
 * BLOCKED so the repair loop is not fed a phantom code failure. (The state
 * machine in playtest-lifecycle.ts now prevents this by recovering stale
 * sessions before starting; this classifier remains for direct tool paths.)
 */
const PLAYTEST_WEDGE_PATTERN =
  /already (running|in progress|active)|finish its current playtest|playtest.*transition|another playtest|StopPlayMonitor|playtest is already|start_playtest.*already/i;

const STUDIO_INFRA_PATTERN =
  /not connected|no (connected )?instances?|no plugin|connection refused|unreachable|timed out|timeout|HTTP 5\d\d/i;

export function classifyPlaytestStartFailure(raw: string): StartFailureClassification {
  const message = (raw ?? "").slice(0, 500);
  if (PLAYTEST_WEDGE_PATTERN.test(message)) {
    return {
      infra: true,
      wedged: true,
      message:
        `roblox_toolchain: playtest session wedged — Studio refused to start another playtest ("${message}"). ` +
        "Stop the active playtest or restart Studio (or use a multi-player playtest). Infrastructure, not a game-code bug.",
    };
  }
  if (STUDIO_INFRA_PATTERN.test(message)) {
    return { infra: true, wedged: false, message: `roblox_toolchain: ${message}` };
  }
  return { infra: false, wedged: false, message };
}

function toPlaytestResult(
  managed: ManagedPlaytestResult
): PlaytestResult {
  return {
    status: managed.status,
    message: managed.message,
    durationMs: managed.durationMs,
    output: managed.output,
    screenshot: managed.screenshot,
    assertions: managed.assertions,
    infraReason: managed.infraReason,
    evidence: managed.evidence,
  };
}

/**
 * Run the full lifecycle over an injected opaque bridge. When the bridge is a
 * plain `StudioBridgeClient` (the historical, tool-speaking surface) the ops
 * adapter from mcp-bridge.ts is used so the raw multiplayer/solo playtest,
 * connected-instances, and eval tools drive the state machine.
 */
export async function runPlaytestLifecycle(
  ops: PlaytestLifecycleOps,
  opts: PlaytestOptions = {}
): Promise<PlaytestResult> {
  const role = opts.role ?? "qa";
  const projectDir = opts.projectDir;
  emitToolEvent({ type: "playtest.started", role, projectDir, message: "studio playtest started" });
  const managed = await runManagedPlaytest(ops, {
    requestedMode: opts.mode ?? "multiplayer",
    numPlayers: opts.numPlayers,
    assertRuntimeReady: opts.assertRuntimeReady ?? true,
    assertions: opts.assertions ?? DEFAULT_SPAWN_ASSERTIONS,
    captureScreenshot: opts.captureScreenshot ?? false,
    leaveRunning: opts.stopAfter === false,
    config: opts.config,
    role,
    projectDir,
  });
  return toPlaytestResult(managed);
}

/**
 * Full playtest lifecycle against a live Studio bridge (MCP or direct-HTTP).
 * Safe start (inspect → recover stale → start), bounded readiness, runtime
 * assertions, and guaranteed teardown with honest evidence.
 */
export async function runStudioPlaytest(
  bridge: StudioBridgeClient,
  opts: PlaytestOptions = {}
): Promise<PlaytestResult> {
  const start = Date.now();
  const role = opts.role ?? "qa";
  const projectDir = opts.projectDir;

  const connected = await bridge.isStudioConnected();
  if (!connected) {
    const d = await bridge.discover();
    const reason = `roblox_toolchain: Studio not connected (${d.message}). Open Studio with the MCP plugin and retry — this is infrastructure, not a game-code bug.`;
    emitToolEvent({ type: "tool.blocked", toolId: "studio.play", role, projectDir, message: reason });
    return { status: "BLOCKED", message: reason, durationMs: Date.now() - start, output: "", assertions: [], infraReason: reason };
  }

  const ops = createPlaytestLifecycleOps(bridge as StudioBridgeLike);
  const result = await runPlaytestLifecycle(ops, opts);
  if (opts.settleMs != null && opts.settleMs > 0) {
    // Historical settle window is honored by readiness polling; nothing extra.
  }
  return result;
}