import type { MissionState } from "./state.js";
import type { EnsureProjectReadyResult } from "../roblox/project-ready.js";
import type { ManagedPlaytestResult } from "../studio/playtest-lifecycle.js";

/**
 * Small adapter module that bridges real Roblox lifecycle results
 * onto the existing MissionState recordReadinessEvidence() API.
 *
 * Never persists secrets, ephemeral Studio peer IDs, live handles,
 * PIDs, or raw transcripts. The MissionState sanitizer strips
 * secret-looking KEYS, but lifecycle messages embed ephemeral runtime
 * identifiers (e.g. "Reused existing Studio (instance:abc)") inside
 * free-text VALUES — so this adapter scrubs those out of the evidence
 * summary before recording.
 */

/**
 * Redact ephemeral Studio runtime identifiers from a free-text summary.
 * Observed live formats: `instance:<id>`, `peer:<id>`, `launch:<id>`.
 * Readability is preserved ("instance:[redacted]") while the concrete
 * handle — meaningless after a restart — never reaches the snapshot/JSONL.
 */
export function scrubEphemeralIds(text: string): string {
  return text
    .replace(/\binstance:[A-Za-z0-9_-]+/g, "instance:[redacted]")
    .replace(/\bpeer:[A-Za-z0-9_-]+/g, "peer:[redacted]")
    .replace(/\blaunch:[A-Za-z0-9_-]+/g, "launch:[redacted]");
}

export async function recordProjectReadyEvidence(
  missionState: MissionState,
  projectDir: string,
  result: EnsureProjectReadyResult,
): Promise<void> {
  if (!result.ok) return;
  const artifact = result.artifact;
  const parts: string[] = [];
  parts.push(result.state);
  parts.push(artifact.rebuilt ? "fresh artifact" : "reused artifact");
  parts.push(artifact.artifactPath);
  if (result.load) {
    parts.push(`load: ${result.load.message}`);
    parts.push(`probes: ${result.load.evidence.diagnostics.probeCount}`);
    parts.push(`launchAckInconclusive: ${result.load.evidence.launchAckInconclusive ? "yes" : "no"}`);
  }
  await missionState.recordReadinessEvidence({
    projectDir,
    artifactPath: artifact.artifactPath,
    artifactFresh: artifact.rebuilt,
    evidence: scrubEphemeralIds(parts.join("; ")).slice(0, 1000),
  });
}

export async function recordPlaytestEvidence(
  missionState: MissionState,
  projectDir: string,
  result: ManagedPlaytestResult,
): Promise<void> {
  const parts: string[] = [];
  parts.push(`playtest ${result.status}`);
  parts.push(`state: ${result.state}`);
  parts.push(`${result.durationMs}ms`);
  if (result.assertions.length > 0) {
    const passed = result.assertions.filter((a) => a.passed).length;
    parts.push(`assertions: ${passed}/${result.assertions.length}`);
  }
  if (result.evidence.teardownUnconfirmed) parts.push("teardown: unconfirmed");
  if (result.infraReason) parts.push(`infra: ${result.infraReason.slice(0, 200)}`);
  await missionState.recordReadinessEvidence({
    projectDir,
    evidence: scrubEphemeralIds(parts.join("; ")).slice(0, 1000),
  });
}
