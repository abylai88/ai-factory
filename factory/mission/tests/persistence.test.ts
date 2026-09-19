import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission, createDelegation, createExecutionPlan } from "../mission.js";
import { MissionState } from "../state.js";
import {
  PERSISTED_SNAPSHOT_VERSION,
  migrateSnapshot,
  sanitizeForPersistence,
  SnapshotVersionError,
} from "../persisted-memory.js";
import { ArtifactStore } from "../artifact-store.js";
import { RepairHistory } from "../repair-history.js";
import { missionSummaryToHermesStatus } from "../../hermes/status.js";

let tmpDir: string;
let missionCounter = 0;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "persistence-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function nextMissionId(): string {
  missionCounter += 1;
  return `persist-mission-${missionCounter}`;
}

async function openState(missionId: string): Promise<MissionState> {
  const state = new MissionState(tmpDir, missionId);
  await state.init();
  return state;
}

function snapPath(missionId: string): string {
  return path.join(tmpDir, "outputs", "missions", `${missionId}.state.json`);
}

describe("versioned snapshot", () => {
  it("stamps version 1 on save and reports persistence info", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Build a game"));
    const raw = await fs.readFile(snapPath(mid), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(PERSISTED_SNAPSHOT_VERSION);
    expect(parsed.artifacts).toEqual([]);
    expect(parsed.decisions).toEqual([]);
    expect(parsed.repairRecords).toEqual([]);
  });

  it("migrates a v0 snapshot (no version field) with safe defaults", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    const mission = createMission("Old mission");
    await state.setMission(mission);
    // Simulate a v0 snapshot: strip version + new fields.
    const parsed = JSON.parse(await fs.readFile(snapPath(mid), "utf8"));
    delete parsed.version;
    delete parsed.artifacts;
    delete parsed.decisions;
    delete parsed.repairRecords;
    await fs.writeFile(snapPath(mid), JSON.stringify(parsed), "utf8");

    const reloaded = await openState(mid);
    expect(reloaded.getMission().goal).toBe("Old mission");
    expect(reloaded.getArtifacts()).toEqual([]);
    expect(reloaded.getDecisions()).toEqual([]);
    expect(reloaded.getRepairRecords()).toEqual([]);
    const info = reloaded.getPersistenceInfo();
    expect(info.migratedFrom).toBe(0);
  });

  it("refuses a newer-than-supported snapshot with BLOCKED/NEEDS_HUMAN", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Future mission"));
    const parsed = JSON.parse(await fs.readFile(snapPath(mid), "utf8"));
    parsed.version = PERSISTED_SNAPSHOT_VERSION + 99;
    await fs.writeFile(snapPath(mid), JSON.stringify(parsed), "utf8");

    await expect(openState(mid)).rejects.toThrow(/BLOCKED\/NEEDS_HUMAN/);
  });

  it("migrateSnapshot rejects non-objects and non-integer versions", () => {
    expect(() => migrateSnapshot(null)).toThrow(SnapshotVersionError);
    expect(() => migrateSnapshot({ version: "1" })).toThrow(SnapshotVersionError);
  });
});

describe("atomic writes and corruption safety", () => {
  it("leaves no .tmp behind and keeps a .bak of the last good state", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Atomic mission"));
    const del = createDelegation(state.getMission().id, "obj-1", "Step", "Do step", "game", {});
    await state.addDelegation(del);
    const dir = path.join(tmpDir, "outputs", "missions");
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(files).toContain(`${mid}.state.json.bak`);
    // Snapshot is valid JSON.
    expect(() => JSON.parse("ok") && 1).toBeTruthy();
    const parsed = JSON.parse(await fs.readFile(snapPath(mid), "utf8"));
    expect(parsed.delegations.length).toBe(1);
  });

  it("falls back to .bak when the snapshot is corrupted", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Corrupt me"));
    const del = createDelegation(state.getMission().id, "obj-1", "Step", "Do step", "game", {});
    await state.addDelegation(del);
    await state.completeDelegation(del.id, "passed", "done-output");

    // Corrupt the primary snapshot (simulates crash mid-write).
    await fs.writeFile(snapPath(mid), "{partial-json", "utf8");

    const reloaded = await openState(mid);
    const info = reloaded.getPersistenceInfo();
    expect(info.usedBackup).toBe(true);
    const reloadedDel = reloaded.getDelegation(del.id);
    expect(reloadedDel?.status).toBe("passed");
    expect(reloadedDel?.result).toBe("done-output");
  });

  it("falls back to JSONL replay when snapshot and backup are both gone", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Replay mission"));
    const del = createDelegation(state.getMission().id, "obj-1", "Step", "Do step", "game", {});
    await state.addDelegation(del);
    await state.completeDelegation(del.id, "passed", "replay-output");

    await fs.rm(snapPath(mid), { force: true });
    await fs.rm(snapPath(mid) + ".bak", { force: true });

    const reloaded = await openState(mid);
    expect(reloaded.getDelegation(del.id)?.result).toBe("replay-output");
  });

  it("missing snapshot starts fresh without error", async () => {
    const state = await openState(nextMissionId());
    expect(state.getDelegations()).toEqual([]);
    expect(state.getMission().status).toBe("draft");
  });
});

describe("artifact persistence", () => {
  it("round-trips artifacts across a simulated restart", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    const mission = createMission("Artifact mission");
    await state.setMission(mission);

    const store = new ArtifactStore(mission.id);
    store.registerArtifact({
      delegationId: "del-1",
      type: "code",
      title: "Collector system",
      summary: "Server-authoritative coin collection",
      createdByRole: "Developer",
      path: "src/collect.server.lua",
    });
    const sync = await state.syncArtifacts(store.exportState());
    expect(sync.imported).toBe(1);

    // Simulated process restart.
    const reloaded = await openState(mid);
    const artifacts = reloaded.getArtifacts();
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.path).toBe("src/collect.server.lua");

    // Hydrate a fresh store and confirm handoff still works.
    const store2 = new ArtifactStore(mission.id);
    const { imported, skipped } = store2.importState(artifacts);
    expect(imported).toBe(1);
    expect(skipped).toBe(0);
    expect(store2.count()).toBe(1);
  });

  it("skips invalid artifact entries instead of crashing resume", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Bad artifacts"));
    const res = await state.syncArtifacts([
      { id: "x", type: "nope" } as never,
      {
        id: "art-ok",
        missionId: state.getMission().id,
        delegationId: "d",
        type: "report",
        title: "OK",
        summary: "fine",
        createdByRole: "QA",
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(res).toEqual({ imported: 1, skipped: 1 });
  });

  it("never persists secrets or ephemeral runtime ids in artifact metadata", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    const mission = createMission("Secret mission");
    await state.setMission(mission);
    await state.syncArtifacts([
      {
        id: "art-1",
        missionId: mission.id,
        delegationId: "d1",
        type: "code",
        title: "t",
        summary: "s",
        createdByRole: "Developer",
        createdAt: new Date().toISOString(),
        metadata: {
          authToken: "super-secret-value",
          password: "hunter2",
          instanceId: "studio-peer-123",
          note: "harmless",
        },
      },
    ]);
    const raw = await fs.readFile(snapPath(mid), "utf8");
    expect(raw).not.toContain("super-secret-value");
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("studio-peer-123");
    expect(raw).toContain("harmless");
  });
});

describe("decision persistence", () => {
  it("round-trips key decisions across a simulated restart", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Decision mission"));
    await state.recordDecision({
      category: "architecture",
      title: "Server-authoritative coins",
      detail: "Coin state lives on server; client sends Collect requests via RemoteEvent.",
      rationale: "Prevents exploit of currency.",
      alternatives: ["Client-authoritative with server sanity checks"],
      createdBy: "architect",
    });
    await state.recordDecision({
      category: "core-loop",
      title: "Collect-upgrade-unlock loop",
      detail: "Fast feedback within seconds of spawn.",
      createdBy: "director",
    });

    const reloaded = await openState(mid);
    expect(reloaded.getDecisions().length).toBe(2);
    expect(reloaded.getDecisions("architecture").length).toBe(1);
    expect(reloaded.getDecisions("architecture")[0]?.title).toContain("Server-authoritative");
  });

  it("bounds the decision log instead of growing snapshots unboundedly", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Many decisions"));
    for (let i = 0; i < 55; i++) {
      await state.recordDecision({ category: "qa", title: `d${i}`, detail: `detail ${i}` });
    }
    expect(state.getDecisions().length).toBe(50);
    const reloaded = await openState(mid);
    expect(reloaded.getDecisions().length).toBe(50);
  });
});

describe("repair history persistence", () => {
  it("repeat detection survives a simulated restart", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Repair mission"));

    const history = new RepairHistory(3);
    history.record({
      delegationId: "del-2",
      failure: "TS2345 type error",
      evidence: "stderr...",
      diagnosis: "type mismatch",
      repairAttempted: "fix type",
      repairResult: "failed",
    });
    await state.syncRepairRecords(history.exportState());

    // Simulated process restart → hydrate a fresh RepairHistory.
    const reloaded = await openState(mid);
    const history2 = new RepairHistory(3);
    history2.importState(reloaded.getRepairRecords());
    const decision = history2.decide("del-2", "TS2345 type error", "fix type");
    expect(decision.action).toBe("retry-different");
  });

  it("budget exhaustion survives a simulated restart", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Exhausted mission"));
    const history = new RepairHistory(2);
    history.record({ delegationId: "d", failure: "f1", evidence: "e", diagnosis: "x", repairAttempted: "r1", repairResult: "failed" });
    history.record({ delegationId: "d", failure: "f2", evidence: "e", diagnosis: "x", repairAttempted: "r2", repairResult: "failed" });
    await state.syncRepairRecords(history.exportState());

    const reloaded = await openState(mid);
    const history2 = new RepairHistory(2);
    history2.importState(reloaded.getRepairRecords());
    expect(history2.decide("d", "anything", "r3").action).toBe("blocked");
  });
});

describe("readiness evidence (Roblox persistent vs ephemeral)", () => {
  it("persists evidence summaries but never ephemeral instance ids", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Roblox mission"));
    await state.recordReadinessEvidence({
      projectDir: "projects/coin-sim",
      artifactPath: "build.rbxlx",
      artifactFresh: true,
      evidence: "PLACE_READY (reused), load 1.2s",
    });

    const reloaded = await openState(mid);
    const ev = reloaded.getReadinessEvidence();
    expect(ev?.artifactPath).toBe("build.rbxlx");
    expect(ev?.needsRevalidation).toBe(false);
    expect(JSON.stringify(ev)).not.toMatch(/instanceId|peerId/i);
  });

  it("marks readiness stale on resume so Studio liveness is revalidated", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Roblox mission"));
    await state.recordReadinessEvidence({
      projectDir: "projects/coin-sim",
      evidence: "PLACE_READY",
    });
    await state.prepareForResume();
    expect(state.getReadinessEvidence()?.needsRevalidation).toBe(true);

    const reloaded = await openState(mid);
    expect(reloaded.getReadinessEvidence()?.needsRevalidation).toBe(true);
    expect(reloaded.getReadinessEvidence()?.artifactPath).toBeUndefined();
    expect(reloaded.getReadinessEvidence()?.projectDir).toBe("projects/coin-sim");
  });
});

describe("sanitizer", () => {
  it("strips secret and ephemeral keys but never alters string values", () => {
    const out = sanitizeForPersistence({
      authToken: "abc",
      nested: { password: "x", instanceId: "p1", keep: "v" },
      results: "long output stays byte-identical ".repeat(500),
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("authToken");
    expect((out.nested as Record<string, unknown>)).not.toHaveProperty("password");
    expect((out.nested as Record<string, unknown>)).not.toHaveProperty("instanceId");
    expect((out.nested as Record<string, unknown>)).toHaveProperty("keep", "v");
    expect((out.results as string).length).toBe("long output stays byte-identical ".repeat(500).length);
  });
});

describe("Hermes compatibility after restart", () => {
  it("reports full status from reloaded state with no secrets", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    const mission = createMission("Hermes mission", { projectId: "coin-sim", engine: "roblox" });
    await state.setMission(mission);
    const plan = createExecutionPlan(mission, [], [], [], []);
    await state.setPlan(plan);
    const d1 = createDelegation(mission.id, "obj-1", "Research", "research patterns", "game", { role: "Researcher" });
    const d2 = createDelegation(mission.id, "obj-1", "Build", "build systems", "game", { dependsOn: [d1.id], role: "Developer" });
    await state.addDelegation(d1);
    await state.addDelegation(d2);
    await state.startMission();
    await state.completeDelegation(d1.id, "passed", "research done");
    await state.startDelegation(d2.id, "pipe-1");

    const reloaded = await openState(mid);
    const status = missionSummaryToHermesStatus(reloaded.getStatusSummary());
    expect(status.missionId).toBe(mission.id);
    expect(status.stage).toBe("building");
    expect(status.completedDelegations).toBe(1);
    expect(status.totalDelegations).toBe(2);
    expect(status.activeRole).toBe("Developer");
    expect(JSON.stringify(status)).not.toMatch(/token|secret|password/i);
  });
});

describe("duplicate prevention", () => {
  it("rejects duplicate delegation ids", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    const mission = createMission("Dup mission");
    await state.setMission(mission);
    const del = createDelegation(mission.id, "obj-1", "Step", "Do", "game", {});
    await state.addDelegation(del);
    await expect(state.addDelegation({ ...del })).rejects.toThrow(/already exists/);
  });

  it("dedupes re-applied artifact/decision/repair events by id", async () => {
    const mid = nextMissionId();
    const state = await openState(mid);
    await state.setMission(createMission("Dedupe mission"));
    const artifact = {
      id: "art-1",
      missionId: state.getMission().id,
      delegationId: "d",
      type: "code" as const,
      title: "t",
      summary: "s",
      createdByRole: "Developer" as const,
      createdAt: new Date().toISOString(),
    };
    await state.appendEvent({ missionId: state.getMission().id, type: "mission.artifact.registered", payload: { artifact } });
    await state.appendEvent({ missionId: state.getMission().id, type: "mission.artifact.registered", payload: { artifact } });
    expect(state.getArtifacts().length).toBe(1);
  });
});
