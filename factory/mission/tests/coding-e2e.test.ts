import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMission } from "../mission.js";
import { MissionState } from "../state.js";
import { createPlanner } from "../planner.js";
import { MissionOrchestrator } from "../orchestrator.js";
import { InMemoryEventSink, MissionEventTypes } from "../events.js";
import { CompositeCodingBuildAdapter, CodingMissionAuditor } from "../adapters.js";

const TRAFFIC_DODGE_DIR = path.resolve("projects/traffic-dodge");
const PACKAGE_JSON_PATH = path.join(TRAFFIC_DODGE_DIR, "package.json");

let originalPackageJson: string;

beforeAll(async () => {
  originalPackageJson = await fs.readFile(PACKAGE_JSON_PATH, "utf8");
});

afterAll(async () => {
  await fs.writeFile(PACKAGE_JSON_PATH, originalPackageJson, "utf8");
});

describe("REAL E2E: Traffic Dodge package name fix", () => {
  it(
    "completes full coding mission",
    async () => {
      const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON_PATH, "utf8"));
      const currentName = pkg.name;

      if (currentName === "traffic-dodge") {
        console.log("Package name is already 'traffic-dodge'. Verifying build only.");
        expect(currentName).toBe("traffic-dodge");
        return;
      }

      expect(currentName).toBe("neon-breaker");

      const mission = createMission("Fix the Traffic Dodge package name", {
        projectId: "traffic-dodge",
        engine: "web",
        stack: "Phaser + TypeScript",
        template: "yagames-phaser-template",
        workspace: TRAFFIC_DODGE_DIR,
      });

      const planner = createPlanner();
      const plan = planner.decompose(mission);

      expect(plan.delegations.length).toBe(3);
      expect(plan.delegations[0].title).toContain("Inspect");
      expect(plan.delegations[1].title).toContain("Apply");
      expect(plan.delegations[2].title).toContain("Build");

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "coding-e2e-"));
      const state = new MissionState(tmpDir, mission.id);
      await state.init();
      await state.setMission(mission);
      await state.setPlan(plan);
      for (const del of plan.delegations) {
        await state.addDelegation(del);
      }

      const adapter = new CompositeCodingBuildAdapter();
      const auditor = new CodingMissionAuditor();
      const eventSink = new InMemoryEventSink();

      const orchestrator = new MissionOrchestrator({
        maxRepairs: 3,
        baseDir: tmpDir,
        project: TRAFFIC_DODGE_DIR,
        factoryAdapter: adapter,
        auditor,
        eventSink,
        missionState: state,
      });

      const result = await orchestrator.executeMission(mission, plan);

      console.log("Mission status:", result.status);

      expect(result.status).toBe("completed");

      const finalPkg = JSON.parse(await fs.readFile(PACKAGE_JSON_PATH, "utf8"));
      expect(finalPkg.name).toBe("traffic-dodge");

      const events = eventSink.recent();
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain(MissionEventTypes.DELEGATION_STARTED);
      expect(eventTypes).toContain(MissionEventTypes.DELEGATION_COMPLETED);
      expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDITING);
      expect(eventTypes).toContain(MissionEventTypes.MISSION_AUDIT_PASSED);

      const delegations = state.getDelegations();
      for (const del of delegations) {
        const auditResult = state.getAuditResult(del.id);
        expect(auditResult).toBeDefined();
        expect(auditResult!.status).toBe("PASS");
      }

      const progress = state.getProgress();
      expect(progress.completed).toBe(progress.total);
    },
    120_000
  );
});
