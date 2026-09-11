import { describe, it, expect } from "vitest";
import { TeamContextBuilder, createTeamContextBuilder } from "../team-context.js";
import { ArtifactStore } from "../artifact-store.js";
import type { Mission, Delegation, AgentRole } from "../mission.js";
import { createMission, createDelegation } from "../mission.js";

const mission: Mission = createMission("Build a competitive game", {
  projectId: "game-1",
  engine: "phaser",
  stack: "typescript",
});

function makeDel(
  id: string,
  role: AgentRole,
  dependsOn: string[] = [],
  title = `Task ${id}`,
): Delegation {
  return createDelegation(mission.id, "obj-1", title, `desc ${id}`, "engineering", {
    dependsOn,
    parallelizable: false,
    role,
  });
}

describe("TeamContextBuilder", () => {
  describe("basic context building", () => {
    it("builds context with mission goal, role, and task", () => {
      const builder = new TeamContextBuilder();
      const del = makeDel("d1", "Developer");
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Developer",
        delegations: [],
        failures: [],
      });
      expect(ctx.role).toBe("Developer");
      expect(ctx.missionGoal).toBe(mission.goal);
      expect(ctx.yourTask).toBe(del.title);
      const titles = ctx.sections.map((s) => s.title);
      expect(titles).toContain("MISSION GOAL");
      expect(titles).toContain("YOUR ROLE");
      expect(titles).toContain("YOUR TASK");
    });

    it("includes a dependency section when deps exist", () => {
      const builder = new TeamContextBuilder();
      const dep = makeDel("d0", "Architect", [], "Architecture design");
      const del = makeDel("d1", "Developer", ["d0"]);
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Developer",
        delegations: [
          { id: "d0", title: dep.title, role: "Architect", status: "passed", resultSummary: "Created design" },
        ],
        failures: [],
      });
      const depSection = ctx.sections.find((s) => s.title === "DEPENDENCIES COMPLETED");
      expect(depSection).toBeDefined();
      expect(depSection!.body).toContain("Architecture design");
      expect(depSection!.body).toContain("[Architect]");
      expect(depSection!.body).toContain("[passed]");
    });

    it("includes an artifacts section when artifactStore provided", () => {
      const builder = new TeamContextBuilder();
      const store = new ArtifactStore(mission.id);
      store.registerArtifact({
        delegationId: "d0",
        type: "code",
        title: "Player",
        summary: "Player movement",
        createdByRole: "Developer",
        path: "src/player.ts",
      });
      const del = makeDel("d1", "Developer", ["d0"]);
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Developer",
        delegations: [],
        failures: [],
        artifactStore: store,
      });
      const artSection = ctx.sections.find((s) => s.title === "AVAILABLE ARTIFACTS");
      expect(artSection).toBeDefined();
      expect(artSection!.body).toContain("Player");
      expect(artSection!.body).toContain("src/player.ts");
    });

    it("includes a failures section when failures exist", () => {
      const builder = new TeamContextBuilder();
      const del = makeDel("d1", "Repair");
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Repair",
        delegations: [],
        failures: [
          {
            delegationId: "d0",
            title: "Build",
            role: "Developer",
            reason: "Build failed with exit 1",
            attempt: 1,
          },
        ],
      });
      const failSection = ctx.sections.find((s) => s.title === "PREVIOUS FAILURES");
      expect(failSection).toBeDefined();
      expect(failSection!.body).toContain("Build");
      expect(failSection!.body).toContain("Build failed");
    });
  });

  describe("context bounds", () => {
    it("truncates sections to fit within maxContextChars", () => {
      const builder = new TeamContextBuilder({ maxContextChars: 500 });
      const del = makeDel("d1", "Developer");
      const longDelegations = Array.from({ length: 20 }, (_, i) => ({
        id: `d${i}`,
        title: "Long title ".repeat(50),
        role: "Developer" as AgentRole,
        status: "passed",
        resultSummary: "Long summary ".repeat(50),
      }));
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Developer",
        delegations: longDelegations,
        failures: [],
      });
      // The total length should be bounded
      expect(ctx.totalChars).toBeLessThanOrEqual(500 + 200); // some slack
    });

    it("flags truncation when sections are truncated", () => {
      const builder = new TeamContextBuilder({ maxContextChars: 100 });
      // Create a delegation whose dependsOn matches the long-title delegation
      const del = makeDel("d1", "Developer", ["d0"]);
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Developer",
        delegations: [
          {
            id: "d0",
            title: "X".repeat(200),
            role: "Developer",
            status: "passed",
          },
        ],
        failures: [],
      });
      expect(ctx.truncated).toBe(true);
    });
  });

  describe("role-specific context selection", () => {
    it("selects relevant delegations for Developer", () => {
      const builder = new TeamContextBuilder();
      const del = makeDel("d1", "Developer", ["d0"]);
      const all = [
        { id: "d0", title: "Architecture", role: "Architect" as AgentRole, status: "passed" },
        { id: "d2", title: "Research", role: "Researcher" as AgentRole, status: "passed" },
        { id: "d3", title: "Design", role: "Designer" as AgentRole, status: "passed" },
      ];
      const selected = builder.selectRelevantDelegations({
        role: "Developer",
        currentDelegation: del,
        allDelegations: all,
        max: 3,
      });
      const ids = selected.map((s) => s.id);
      expect(ids).toContain("d0"); // dependency always included
    });

    it("selects relevant artifacts for QA prioritising code+test", () => {
      const builder = new TeamContextBuilder();
      const store = new ArtifactStore(mission.id);
      store.registerArtifact({
        delegationId: "d0", type: "design", title: "Design Doc", summary: "s", createdByRole: "Designer",
      });
      store.registerArtifact({
        delegationId: "d0", type: "code", title: "Player Code", summary: "s", createdByRole: "Developer",
      });
      store.registerArtifact({
        delegationId: "d0", type: "test", title: "Player Test", summary: "s", createdByRole: "QA",
      });
      const del = makeDel("d1", "QA");
      const selected = builder.selectRelevantArtifacts({
        role: "QA",
        delegation: del,
        artifactStore: store,
      });
      expect(selected.length).toBeGreaterThan(0);
    });

    it("selects relevant failures for Repair focusing on Developer/Repair", () => {
      const builder = new TeamContextBuilder();
      const failures = [
        { delegationId: "d0", title: "Build", role: "Developer" as AgentRole, reason: "exit 1", attempt: 1 },
        { delegationId: "d1", title: "Research", role: "Researcher" as AgentRole, reason: "timeout", attempt: 1 },
        { delegationId: "d2", title: "Repair attempt", role: "Repair" as AgentRole, reason: "still failing", attempt: 2 },
      ];
      const del = makeDel("d1", "Repair");
      const selected = builder.selectRelevantFailures({
        role: "Repair",
        delegation: del,
        failures,
      });
      const roles = selected.map((f) => f.role);
      expect(roles.every((r) => r === "Developer" || r === "Repair")).toBe(true);
    });
  });

  describe("Manager full memory", () => {
    it("Manager role gets full memory context", () => {
      const builder = new TeamContextBuilder();
      const del = makeDel("d1", "Manager");
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Manager",
        delegations: [],
        failures: [],
        memoryContext: "Full mission memory goes here with all details.",
      });
      const memSection = ctx.sections.find((s) => s.title === "FULL MISSION MEMORY");
      expect(memSection).toBeDefined();
      expect(memSection!.body).toContain("Full mission memory");
    });

    it("non-Manager roles do NOT get full memory section", () => {
      const builder = new TeamContextBuilder();
      const del = makeDel("d1", "Developer");
      const ctx = builder.buildAgentContext({
        mission,
        delegation: del,
        role: "Developer",
        delegations: [],
        failures: [],
        memoryContext: "Should not be included",
      });
      const memSection = ctx.sections.find((s) => s.title === "FULL MISSION MEMORY");
      expect(memSection).toBeUndefined();
    });
  });

  describe("factory", () => {
    it("createTeamContextBuilder returns a builder", () => {
      const b = createTeamContextBuilder();
      expect(b).toBeInstanceOf(TeamContextBuilder);
    });
  });
});
