import { scrubEphemeralIds } from "../mission/readiness-evidence.js";

/**
 * Real visual evidence plumbing for the production quality stage.
 *
 * Wraps the EXISTING screenshot capability (Studio bridge
 * `capture_screenshot` via the Studio/MCP bridge) and turns the result
 * into safe, persisted quality evidence — never fabricated.
 *
 * Capture rules:
 * - Capture only when Studio is actually connected (discover first).
 * - Associate the capture with project / mission / stage / context /
 *   timestamp (+ viewport metadata when the bridge provides it).
 * - On failure: honestly `unavailable` — never a visual PASS.
 * - Persisted form carries only safe references/metadata: no MCP
 *   tokens, credentials, peer/instance/process IDs, or raw transcripts.
 */

export interface QualityScreenshotBridge {
  discover(): Promise<{ pluginConnected: boolean; message?: string }>;
  callTool(
    toolName: string,
    params?: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    message: string;
    stdout?: string;
    data?: unknown;
  }>;
}

export interface QualityScreenshotRequest {
  project: string;
  missionId: string;
  /** Production quality stage label, e.g. "quality-review" / "quality-re-review-1". */
  stage: string;
  /** What is being framed, e.g. "spawn view toward goal". */
  contextLabel?: string;
}

export type QualityScreenshotStatus = "captured" | "unavailable";

export interface QualityScreenshotEvidence {
  status: QualityScreenshotStatus;
  /** Safe screenshot reference for critics (path or bridge reference). */
  ref?: string;
  project: string;
  missionId: string;
  stage: string;
  contextLabel: string;
  capturedAt: string;
  /** Viewport/context metadata when the bridge provides it. */
  viewport?: string;
  /** Honest human-readable detail (scrubbed, bounded). */
  detail: string;
}

function safeRef(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  // Keep only a safe tail: absolute paths collapse to their file name,
  // bridge references collapse to alphanumerics + a few separators.
  const t = raw.trim().slice(0, 500);
  const fileName = t.split(/[/\\]/).pop() ?? t;
  const cleaned = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || undefined;
}

/**
 * REAL evidence references only. Accepted:
 * - explicit path-like refs: screenshotPath / path / filePath / artifactPath
 * - explicit ids: id / artifactId / screenshotId
 * - explicit refs: ref / screenshotRef / artifactRef
 * - actual image payloads: imageBase64 / base64 / imageData /
 *   screenshotBase64 / dataUrl (substantial length only)
 *
 * NEVER derived from arbitrary message prose, stdout tails, width/height/
 * format/mimeType metadata, or bare status text. Returns undefined when no
 * real artifact/ref exists so the caller reports VISUAL_UNAVAILABLE.
 */
const REAL_REF_KEYS = [
  "screenshotPath",
  "path",
  "filePath",
  "artifactPath",
  "id",
  "artifactId",
  "screenshotId",
  "ref",
  "screenshotRef",
  "artifactRef",
] as const;

const IMAGE_PAYLOAD_KEYS = [
  "imageBase64",
  "base64",
  "imageData",
  "screenshotBase64",
  "dataUrl",
  "image",
  "pixels",
] as const;

/** Minimum base64/image payload length to count as a real artifact. */
const MIN_IMAGE_PAYLOAD_CHARS = 100;

function refFromRecord(d: Record<string, unknown>): string | undefined {
  for (const key of REAL_REF_KEYS) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) {
      const s = safeRef(v);
      if (s) return s;
    }
  }
  for (const key of IMAGE_PAYLOAD_KEYS) {
    const v = d[key];
    if (typeof v === "string" && v.trim().length >= MIN_IMAGE_PAYLOAD_CHARS) {
      const mime =
        typeof d.mimeType === "string" && d.mimeType.trim()
          ? d.mimeType.trim().slice(0, 40).replace(/[^A-Za-z0-9/+._-]+/g, "_")
          : "image";
      // Honest descriptor of a real pixel payload — never a faked file path.
      return `mcp-screenshot-image:${mime}:${v.trim().length}chars`;
    }
  }
  return undefined;
}

function candidateRecords(data: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    out.push(data as Record<string, unknown>);
    const nested = (data as Record<string, unknown>).structuredContent;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      out.push(nested as Record<string, unknown>);
    }
  }
  return out;
}

export function extractRef(data: unknown, stdout: string | undefined): string | undefined {
  for (const rec of candidateRecords(data)) {
    const s = refFromRecord(rec);
    if (s) return s;
  }
  if (stdout?.trim()) {
    try {
      const parsed = JSON.parse(stdout) as unknown;
      for (const rec of candidateRecords(parsed)) {
        const s = refFromRecord(rec);
        if (s) return s;
      }
    } catch {
      // stdout is not JSON — not evidence. Never fall through to prose tail.
    }
  }
  // No real artifact/ref: prose metadata (message/width/height/format/
  // mimeType) is NEVER evidence.
  return undefined;
}

/**
 * Capture screenshot evidence for one quality-review round.
 * Read-only: never starts a playtest, never launches Studio, never
 * restarts anything. Reuses the already-connected instance.
 */
export async function captureQualityScreenshot(
  bridge: QualityScreenshotBridge | undefined,
  req: QualityScreenshotRequest,
): Promise<QualityScreenshotEvidence> {
  const base = {
    project: req.project.slice(0, 200),
    missionId: req.missionId.slice(0, 100),
    stage: req.stage.slice(0, 100),
    contextLabel: (req.contextLabel ?? "quality review viewport").slice(0, 200),
    capturedAt: new Date().toISOString(),
  };
  if (!bridge) {
    return {
      ...base,
      status: "unavailable",
      detail: "VISUAL_UNAVAILABLE: no Studio bridge provided; screenshot not attempted",
    };
  }
  let connected = false;
  try {
    const disc = await bridge.discover();
    connected = disc.pluginConnected === true;
    if (!connected) {
      return {
        ...base,
        status: "unavailable",
        detail: `VISUAL_UNAVAILABLE: Studio not connected (${scrubEphemeralIds(disc.message ?? "no instance").slice(0, 200)})`,
      };
    }
  } catch (e) {
    return {
      ...base,
      status: "unavailable",
      detail: `VISUAL_UNAVAILABLE: Studio discovery failed (${String(e instanceof Error ? e.message : e).slice(0, 200)})`,
    };
  }
  try {
    const shot = await bridge.callTool("capture_screenshot", { format: "png" });
    if (!shot.ok) {
      return {
        ...base,
        status: "unavailable",
        detail: `VISUAL_UNAVAILABLE: ${scrubEphemeralIds(shot.message).slice(0, 300)}`,
      };
    }
    const ref = extractRef(shot.data, shot.stdout);
    if (!ref) {
      return {
        ...base,
        status: "unavailable",
        detail: "VISUAL_UNAVAILABLE: capture reported ok but returned no usable reference",
      };
    }
    return {
      ...base,
      status: "captured",
      ref,
      detail: `screenshot captured for ${base.stage} (${base.contextLabel})`,
    };
  } catch (e) {
    return {
      ...base,
      status: "unavailable",
      detail: `VISUAL_UNAVAILABLE: capture threw (${String(e instanceof Error ? e.message : e).slice(0, 200)})`,
    };
  }
}

/** Critic-facing ref: real reference when captured, otherwise undefined. */
export function screenshotRefForCritic(ev: QualityScreenshotEvidence): string | undefined {
  return ev.status === "captured" ? ev.ref : undefined;
}
