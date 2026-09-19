import { promises as fs } from "node:fs";
import path from "node:path";
import type { StudioBridgeClient } from "../studio/bridge.js";
import { captureScreenshot } from "../studio/tools.js";
import { emitToolEvent } from "../tools/observability.js";

/**
 * Screenshot / vision pipeline.
 *
 * Agent question ("does the player have a floor beneath them?") → capture
 * screenshot tool → artifact on disk + registry event → vision evaluation
 * (pluggable) → PASS/FAIL/structured observation → repair/visual agent.
 *
 * Without Studio the capture is BLOCKED (infrastructure). Without a vision
 * model the evaluation degrades to recorded-observation (human/vision step
 * pending) — never a fabricated PASS.
 */

export interface ScreenshotResult {
  status: "PASS" | "FAIL" | "BLOCKED";
  message: string;
  /** Absolute path when saved locally, or bridge reference id. */
  screenshotPath?: string;
  data?: unknown;
  infraReason?: string;
}

export interface VisionVerdict {
  verdict: "PASS" | "FAIL" | "NEEDS_HUMAN";
  observation: string;
}

export type VisionEvaluator = (screenshotPath: string, question: string) => Promise<VisionVerdict>;

/**
 * Visual QA state — the four-state model used by scene/Runtime QA reporting.
 *
 *   VISUAL_PASS          a screenshot was captured AND a vision verdict
 *                        returned PASS.
 *   VISUAL_FAIL          a screenshot was captured AND vision returned FAIL.
 *   VISUAL_UNVERIFIED    evidence was captured but no vision verdict exists
 *                        (no evaluator / NEEDS_HUMAN). NEVER upgraded to PASS
 *                        by heuristics — a human/vision step is required.
 *   VISUAL_UNAVAILABLE   the capture itself could not be produced (Studio
 *                        window hidden, transport failure, etc.).
 *
 * It is never valid to convert VISUAL_UNVERIFIED → VISUAL_PASS without a
 * vision verdict.
 */
export type VisualQaState = "VISUAL_PASS" | "VISUAL_FAIL" | "VISUAL_UNVERIFIED" | "VISUAL_UNAVAILABLE";

export function assessVisualState(shot: ScreenshotResult, verdict?: VisionVerdict): { state: VisualQaState; reason: string } {
  if (shot.status === "BLOCKED") return { state: "VISUAL_UNAVAILABLE", reason: shot.message };
  if (shot.status === "FAIL") return { state: "VISUAL_UNAVAILABLE", reason: shot.message };
  if (verdict?.verdict === "FAIL") return { state: "VISUAL_FAIL", reason: verdict.observation };
  if (verdict?.verdict === "PASS") {
    if (shot.screenshotPath) return { state: "VISUAL_PASS", reason: verdict.observation };
    return { state: "VISUAL_UNVERIFIED", reason: "verdict PASS but no screenshot artifact was retained" };
  }
  return { state: "VISUAL_UNVERIFIED", reason: verdict?.observation ?? shot.message };
}

export function describeVisualState(state: VisualQaState): string {
  switch (state) {
    case "VISUAL_PASS":
      return "visual evidence verified (screenshot + positive vision verdict)";
    case "VISUAL_FAIL":
      return "visual regression: captured screenshot does not match the expected scene";
    case "VISUAL_UNVERIFIED":
      return "visual evidence incomplete: no vision verdict (human or vision evaluation pending)";
    case "VISUAL_UNAVAILABLE":
      return "visual evidence unavailable: a screenshot could not be captured";
  }
}

export async function capturePlaytestScreenshot(
  bridge: StudioBridgeClient,
  opts?: { label?: string; outDir?: string; role?: string; projectDir?: string }
): Promise<ScreenshotResult> {
  const role = opts?.role ?? "qa";
  const shot = await captureScreenshot(bridge, { label: opts?.label ?? "playtest" });
  if (!shot.ok) {
    if (shot.infra) {
      const reason = `roblox_toolchain: screenshot unavailable — Studio not connected (${shot.message})`;
      emitToolEvent({ type: "tool.blocked", toolId: "screenshot.capture", role, projectDir: opts?.projectDir, message: reason });
      return { status: "BLOCKED", message: reason, infraReason: reason };
    }
    return { status: "FAIL", message: `screenshot failed: ${shot.message}` };
  }
  const data = shot.data as Record<string, unknown> | undefined;
  const ref =
    typeof data?.path === "string"
      ? data.path
      : typeof data?.screenshotPath === "string"
        ? (data.screenshotPath as string)
        : typeof data?.id === "string"
          ? (data.id as string)
          : undefined;

  // Persist any inline base64 payload to disk so repair agents + Telegram
  // have a stable artifact reference.
  let screenshotPath = ref;
  const b64 =
    typeof data?.base64 === "string"
      ? (data.base64 as string)
      : typeof data?.image === "string"
        ? (data.image as string)
        : undefined;
  if (b64 && opts?.projectDir) {
    try {
      const dir = path.join(opts.projectDir, opts.outDir ?? "docs/qa");
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `screenshot-${Date.now()}.png`);
      await fs.writeFile(file, Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64"));
      screenshotPath = file;
    } catch {
      // keep bridge reference
    }
  }
  emitToolEvent({
    type: "screenshot.created",
    toolId: "screenshot.capture",
    role,
    projectDir: opts?.projectDir,
    message: `screenshot captured${screenshotPath ? `: ${screenshotPath}` : ""}`,
    data: screenshotPath ? { screenshotPath } : undefined,
  });
  return { status: "PASS", message: "screenshot captured", screenshotPath, data: shot.data };
}

/**
 * Evaluate a screenshot against a question. With no evaluator configured,
 * records the observation request honestly (NEEDS_HUMAN) instead of
 * inventing a verdict.
 */
export async function evaluateScreenshot(
  screenshotPath: string,
  question: string,
  evaluator?: VisionEvaluator
): Promise<VisionVerdict> {
  if (!screenshotPath) return { verdict: "NEEDS_HUMAN", observation: "no screenshot captured" };
  if (!evaluator) {
    return {
      verdict: "NEEDS_HUMAN",
      observation: `screenshot recorded at ${screenshotPath}; vision evaluation pending for: "${question}"`,
    };
  }
  return evaluator(screenshotPath, question);
}
