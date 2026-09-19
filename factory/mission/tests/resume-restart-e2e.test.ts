import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createMission,
  createDelegation,
  createExecutionPlan,
  type Delegation,
  type AgentResult,
} from "../mission.js";
import { MissionState } from "../state.js";
import { ArtifactStore } from "../artifact-store.js";
import { RepairHistory } from "../repair-history.js";
import {
  MissionOrchestrator,
  DeterministicAuditor,
  type FactoryExecutionAdapter,
} from "../orchestrator.js";
import { InMemoryEventSink } from "../events.js";

/**
 * Phase-10 real resume simulation (fully offline):
 *
 *   PROCESS 1: mission start → blueprint → del1 complete + artifact +
 *   decision → del2 fails + repair record → PROCESS TERMINATES
 *   (all in-memory objects dropped; only the snapshot + JSONL remain)
 *
 *   PROCESS 2: fresh MissionState → restore mission/artifact/decision/
 *   repair history → resume del2 → repair → QA → PASS.
 *
 * Proves del1 is NOT restarted and repeat-repair memory survived.
 */

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-restart-e2e-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("restart/resume E2E", () => {
  it("restores memory across a simulated process restart and finishes without repeating completed work", async () => {
    const missionId = "restart-sim-mission";

    // ── PROCESS 1 ──────────────────────────────────────────
    {
      const state = new MissionState(tmpDir, missionId);
      await state.init();
      const mission = createMission("Build a Roblox coin simulator", {
        projectId: "coin-sim",
        engine: "roblox",
      });
      (mission as { blueprint?: unknown }).blueprint = {
        genre: "simulator",
        platform: "roblox",
        coreLoop: "collect → upgrade → unlock",
      };
      await state.setMission(mission);

      const del1 = createDelegation(mission.id, "obj-1", "Research patterns", "research", "game", {
        acceptanceCriteria: ["Research done"],
        role: "Researcher",
      });
      const del2 = createDelegation(mission.id, "obj-1", "Build systems", "build", "game", {
        dependsOn: [del1.id],
        acceptanceCriteria: ["Build succeeds"],
        role: "Developer",
      });
      const plan = createExecutionPlan(
        mission,
        [{ id: "obj-1", title: "Build", description: "Build it", delegations: [del1.id, del2.id] }],
        [del1, del2],
        [],
        [],
      );
      await state.setPlan(plan);
      await state.addDelegation(del1);
      await state.addDelegation(del2);
      await state.startMission();

      // del1 completes with an artifact + a decision.
      await state.completeDelegation(del1.id, "passed", "Research done: fast feedback loops documented.");
      const store = new ArtifactStore(mission.id);
      store.registerArtifact({
        delegationId: del1.id,
        type: "research",
        title: "Simulator patterns",
        summary: "Fast feedback + visible progression",
        createdByRole: "Researcher",
      });
      await state.syncArtifacts(store.exportState());
      await state.recordDecision({
        category: "design",
        title: "Coin collector direction",
        detail: "Bright readable arena; single upgrade menu.",
        createdBy: "director",
      });

      // del2 fails; repair attempt recorded.
      await state.completeDelegation(del2.id, "failed", "", "TS2345: type mismatch in collector");
      const repairs = new RepairHistory(3);
      repairs.record({
        delegationId: del2.id,
        failure: "TS2345: type mismatch in collector",
        evidence: "stderr excerpt",
        diagnosis: "wrong RemoteEvent payload type",
        repairAttempted: "fix payload type",
        repairResult: "failed",
      });
      await state.syncRepairRecords(repairs.exportState());

      // PROCESS TERMINATES: drop every in-memory object. Only files remain.
    }

    // ── PROCESS 2 (fresh objects, same directory) ──────────
    {
      const state = new MissionState(tmpDir, missionId);
      await state.init();

      // Restore checks.
      expect(state.getDelegation(state.getDelegations()[0]!.id)?.status).toBe("passed");
      const dels = state.getDelegations();
      const del1 = dels.find((d) => d.title === "Research patterns")!;
      const del2 = dels.find((d) => d.title === "Build systems")!;
      expect(del1.status).toBe("passed");
      expect(del1.result).toContain("Research done");
      expect(del2.status).toBe("failed");

      expect(state.getArtifacts().length).toBe(1);
      expect(state.getArtifacts()[0]?.summary).toContain("Fast feedback");
      expect(state.getDecisions().length).toBe(1);
      expect(state.getDecisions()[0]?.title).toContain("Coin collector");

      // Repair memory survived: same failure + same repair → retry-different.
      const repairs = new RepairHistory(3);
      repairs.importState(state.getRepairRecords());
      expect(repairs.decide(del2.id, "TS2345: type mismatch in collector", "fix payload type").action).toBe(
        "retry-different",
      );

      // Resume exactly like the CLI does.
      const { plan } = await state.prepareForResume();
      expect(plan).not.toBeNull();

      const calls: string[] = [];
      const adapter: FactoryExecutionAdapter = {
        async runDelegation(delegation: Delegation): Promise<AgentResult> {
          calls.push(delegation.id);
          return {
            delegationId: delegation.id,
            status: "passed",
            output: "Build succeeds: collector fixed with correct payload type.",
            durationMs: 5,
          };
        },
      };
      const orchestrator = new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: tmpDir,
        factoryAdapter: adapter,
        auditor: new DeterministicAuditor(),
        eventSink: new InMemoryEventSink(),
        missionState: state,
        resume: true,
      });
      const mission = state.getMission();
      const finalMission = await orchestrator.executeMission(mission, plan!);

      expect(finalMission.status).toBe("completed");
      // del1 was NOT re-executed; only del2 ran.
      expect(calls).toEqual([del2.id]);

      // Blueprint decision recorded during resumed execution persisted.
      expect(state.getDecisions("blueprint").length).toBeGreaterThanOrEqual(1);

      // Third "process": final state still complete.
      const state3 = new MissionState(tmpDir, missionId);
      await state3.init();
      expect(state3.getMission().status).toBe("completed");
      expect(state3.getProgress()).toEqual({ completed: 2, total: 2 });
    }
  });
});
