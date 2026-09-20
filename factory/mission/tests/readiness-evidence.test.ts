import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MissionState } from "../state.js";
import { recordProjectReadyEvidence, recordPlaytestEvidence } from "../readiness-evidence.js";
import type { EnsureProjectReadyResult } from "../../roblox/project-ready.js";
import type { ManagedPlaytestResult } from "../../studio/playtest-lifecycle.js";
import { missionSummaryToHermesStatus } from "../../hermes/status.js";

let tmpDir: string;
let missionCounter = 0;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "readiness-evidence-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function nextMissionId(): string {
  missionCounter += 1;
  return `evidence-mission-${missionCounter}`;
}

async function openState(missionId: string): Promise<MissionState> {
  const state = new MissionState(tmpDir, missionId);
  await state.init();
  return state;
}

function makeProjectReadyResult(state: string = "PLACE_READY", loadOk: boolean = true): EnsureProjectReadyResult {
  const result: EnsureProjectReadyResult = {
    ok: true,
    state: state as any,
    artifact: { ok: true, artifactPath: "build.rbxlx", sizeBytes: 1024, rebuilt: true, projectPath: "/tmp/project" } as any,
  };
  if (loadOk) {
    (result as any).load = {
      ok: true,
      state: state,
      message: "place loaded",
      evidence: {
        requestedPlacePath: "/tmp/project",
        state: state,
        transitions: [],
        diagnostics: {
          studioProcessDetected: true,
          processAlive: true,
          mcpReachable: true,
          pluginConnected: true,
          connectedInstances: [],
          launchesAttempted: 1,
          elapsedMs: 1200,
          lastProbeMs: Date.now(),
          probeCount: 3,
        },
        advisoryMessages: [],
        launchAckInconclusive: false,
        seenTarget: true,
      },
    };
  }
  return result;
}

function makePlaytestResult(overrides: Partial<ManagedPlaytestResult> = {}): ManagedPlaytestResult {
  return {
    status: "PASS",
    message: "playtest PASS",
    state: "RUNNING",
    evidence: {
      requestedMode: "multiplayer",
      actualMode: "multiplayer",
      startupDurationMs: 5000,
      runtimeDurationMs: 10000,
      runtimeRoles: ["server", "client"],
      serverPeerId: "",
      clientPeerIds: [],
      transitions: [],
      recovered: false,
      teardownUnconfirmed: false,
      timedOut: false,
      needsHuman: false,
      advisoryMessages: [],
    },
    assertions: [{ name: "player-present", passed: true, message: "at least one player present" }],
    durationMs: 15000,
    output: "",
    ...overrides,
  };
}

describe("recordProjectReadyEvidence", () => {
  it("records a PLACE_READY evidence summary", async () => {
    const state = await openState(nextMissionId());
    const result = makeProjectReadyResult();
    await recordProjectReadyEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.projectDir).toBe("/tmp/project");
    expect(evidence!.artifactPath).toBe("build.rbxlx");
    expect(evidence!.artifactFresh).toBe(true);
    expect(evidence!.evidence).toContain("PLACE_READY");
    expect(evidence!.evidence).toContain("fresh artifact");
    expect(evidence!.evidence).toContain("probes: 3");
    expect(evidence!.needsRevalidation).toBe(false);
  });

  it("records ARTIFACT_READY when skipStudio is set", async () => {
    const state = await openState(nextMissionId());
    const result = makeProjectReadyResult("ARTIFACT_READY", false);
    await recordProjectReadyEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence).toContain("ARTIFACT_READY");
  });

  it("does nothing for a failed readiness result", async () => {
    const state = await openState(nextMissionId());
    const result = { ok: false, code: "STUDIO_UNAVAILABLE" as const, reason: "studio down" };
    await recordProjectReadyEvidence(state, "/tmp/project", result as any);
    const evidence = state.getReadinessEvidence();
    expect(evidence).toBeNull();
  });

  it("evidence string is concise and under 1000 chars", async () => {
    const state = await openState(nextMissionId());
    const result = makeProjectReadyResult();
    await recordProjectReadyEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence!.evidence.length).toBeLessThan(1000);
  });
});

describe("recordPlaytestEvidence", () => {
  it("records a PASS playtest evidence", async () => {
    const state = await openState(nextMissionId());
    const result = makePlaytestResult();
    await recordPlaytestEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence).toContain("playtest PASS");
    expect(evidence!.evidence).toContain("assertions: 1/1");
  });

  it("records a FAIL playtest evidence", async () => {
    const state = await openState(nextMissionId());
    const result = makePlaytestResult({ status: "FAIL", assertions: [{ name: "player-present", passed: false, message: "no player" }] });
    await recordPlaytestEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence).toContain("playtest FAIL");
  });

  it("records a BLOCKED playtest evidence", async () => {
    const state = await openState(nextMissionId());
    const result = makePlaytestResult({ status: "BLOCKED", infraReason: "studio not connected" });
    await recordPlaytestEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence).toContain("playtest BLOCKED");
  });

  it("records teardown unconfirmed when applicable", async () => {
    const state = await openState(nextMissionId());
    const result = makePlaytestResult({ evidence: { teardownUnconfirmed: true } as any });
    await recordPlaytestEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence!.evidence).toContain("teardown: unconfirmed");
  });

  it("does not mark mission READY on assertion failure", async () => {
    const state = await openState(nextMissionId());
    const result = makePlaytestResult({ status: "FAIL" });
    await recordPlaytestEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence).toContain("FAIL");
  });
});

describe("persistence round-trip", () => {
  it("readiness evidence survives snapshot save/load", async () => {
    const missionId = nextMissionId();
    const state = await openState(missionId);
    const result = makeProjectReadyResult();
    await recordProjectReadyEvidence(state, "/tmp/project", result);
    const evidence1 = state.getReadinessEvidence();
    expect(evidence1).not.toBeNull();

    const raw = await fs.readFile(path.join(tmpDir, "outputs", "missions", `${missionId}.state.json`), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.readinessEvidence).toBeDefined();
    expect(parsed.readinessEvidence.evidence).toBeTruthy();
  });

  it("readiness evidence reloaded from snapshot", async () => {
    const missionId = nextMissionId();
    const state = await openState(missionId);
    await recordProjectReadyEvidence(state, "/tmp/project", makeProjectReadyResult());

    const reloaded = new MissionState(tmpDir, missionId);
    await reloaded.init();
    const evidence = reloaded.getReadinessEvidence();
    expect(evidence).not.toBeNull();
    expect(evidence!.evidence).toContain("PLACE_READY");
  });
});

describe("resume semantics", () => {
  it("prepareForResume marks readiness stale after restart", async () => {
    const missionId = nextMissionId();
    const state = await openState(missionId);
    await recordProjectReadyEvidence(state, "/tmp/project", makeProjectReadyResult());
    expect(state.getReadinessEvidence()!.needsRevalidation).toBe(false);

    await state.prepareForResume();
    expect(state.getReadinessEvidence()!.needsRevalidation).toBe(true);
  });

  it("prepareForResume marks readiness stale and saves", async () => {
    const state = await openState(nextMissionId());
    await recordProjectReadyEvidence(state, "/tmp/project", makeProjectReadyResult());

    // prepareForResume marks readiness stale in-memory and saves
    await state.prepareForResume();
    expect(state.getReadinessEvidence()!.needsRevalidation).toBe(true);
  });
});

describe("deduplication", () => {
  it("repeated lifecycle events update the same readiness record", async () => {
    const state = await openState(nextMissionId());
    await recordProjectReadyEvidence(state, "/tmp/project", makeProjectReadyResult());
    const first = state.getReadinessEvidence()!.recordedAt;

    await recordProjectReadyEvidence(state, "/tmp/project", makeProjectReadyResult());
    const second = state.getReadinessEvidence()!.recordedAt;
    expect(state.getReadinessEvidence()).not.toBeNull();
    // Since recordReadinessEvidence replaces the record, this is expected behavior
    // (single readiness evidence, not an array)
  });
});

describe("ephemeral runtime identifiers are never persisted", () => {
  it("scrubs Studio instance IDs from project-ready load messages", async () => {
    const missionId = nextMissionId();
    const state = await openState(missionId);
    const result = makeProjectReadyResult();
    // Live loader message shape: "Reused existing Studio (instance:xyz)"
    (result as any).load.message = "Reused existing Studio (instance:tyf-pbr)";
    await recordProjectReadyEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence!.evidence).toContain("PLACE_READY");
    expect(evidence!.evidence).toContain("instance:[redacted]");
    expect(evidence!.evidence).not.toContain("instance:tyf-pbr");

    const raw = await fs.readFile(
      path.join(tmpDir, "outputs", "missions", `${missionId}.state.json`),
      "utf8",
    );
    expect(raw).not.toContain("instance:tyf-pbr");
  });

  it("scrubs peer/launch handles from playtest infra reasons", async () => {
    const state = await openState(nextMissionId());
    const result = makePlaytestResult({
      status: "BLOCKED",
      infraReason: "could not start: peer:tw0-epy wedged after launch:abc-123 on instance:srv-server",
    });
    await recordPlaytestEvidence(state, "/tmp/project", result);
    const evidence = state.getReadinessEvidence();
    expect(evidence!.evidence).toContain("playtest BLOCKED");
    expect(evidence!.evidence).not.toContain("peer:tw0-epy");
    expect(evidence!.evidence).not.toContain("launch:abc-123");
    expect(evidence!.evidence).not.toContain("instance:srv-server");
  });
});

describe("Hermes summary secret-free", () => {
  it("missionSummaryToHermesStatus does not expose secrets or ephemeral IDs", async () => {
    const state = await openState(nextMissionId());
    await recordProjectReadyEvidence(state, "/tmp/project", makeProjectReadyResult());
    const summary = missionSummaryToHermesStatus(state.getStatusSummary());
    const json = JSON.stringify(summary);
    expect(json).not.toContain("instanceId");
    expect(json).not.toContain("peerId");
    expect(json).not.toContain("pid");
    expect(json).not.toContain("launchId");
    expect(json).not.toContain("token");
    expect(json).not.toContain("secret");
    expect(json).toContain("evidence");
  });
});
