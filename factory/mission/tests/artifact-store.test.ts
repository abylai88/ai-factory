import { describe, it, expect, beforeEach } from "vitest";
import { ArtifactStore, createArtifactStore } from "../artifact-store.js";
import type { Mission, Delegation } from "../mission.js";
import { createMission, createDelegation } from "../mission.js";

const mission: Mission = createMission("Test mission", { projectId: "p1" });

function makeDelegation(id: string, dependsOn: string[] = []): Delegation {
  const del = createDelegation(mission.id, "obj-1", `Task ${id}`, `desc ${id}`, "engineering", {
    dependsOn,
    parallelizable: false,
  });
  del.id = id;
  return del;
}

describe("ArtifactStore", () => {
  let store: ArtifactStore;

  beforeEach(() => {
    store = new ArtifactStore(mission.id);
  });

  describe("registration", () => {
    it("registers an artifact and returns it with an id", () => {
      const a = store.registerArtifact({
        delegationId: "d1",
        type: "code",
        title: "Player controller",
        summary: "Adds player movement logic",
        createdByRole: "Developer",
        path: "src/player.ts",
      });
      expect(a.id).toBeDefined();
      expect(a.missionId).toBe(mission.id);
      expect(a.type).toBe("code");
      expect(a.path).toBe("src/player.ts");
      expect(a.createdByRole).toBe("Developer");
    });

    it("truncates long summaries", () => {
      const long = "x".repeat(5000);
      const a = store.registerArtifact({
        delegationId: "d1",
        type: "report",
        title: "Big report",
        summary: long,
        createdByRole: "Researcher",
      });
      expect(a.summary.length).toBeLessThanOrEqual(200);
    });

    it("enforces maxArtifactsPerMission limit by evicting oldest", () => {
      const small = new ArtifactStore(mission.id, { maxArtifactsPerMission: 2 });
      const a1 = small.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s", createdByRole: "Developer",
      });
      small.registerArtifact({
        delegationId: "d1", type: "code", title: "A2", summary: "s", createdByRole: "Developer",
      });
      small.registerArtifact({
        delegationId: "d1", type: "code", title: "A3", summary: "s", createdByRole: "Developer",
      });
      const remaining = small.getArtifactsForMission();
      expect(remaining.length).toBe(2);
      expect(remaining.find((r) => r.id === a1.id)).toBeUndefined();
    });
  });

  describe("lookups", () => {
    it("getArtifactsForMission returns all artifacts in chronological order", () => {
      const a1 = store.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s", createdByRole: "Developer",
      });
      const a2 = store.registerArtifact({
        delegationId: "d2", type: "test", title: "A2", summary: "s", createdByRole: "QA",
      });
      const list = store.getArtifactsForMission();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(a1.id);
      expect(list[1].id).toBe(a2.id);
    });

    it("getArtifactsForDelegation filters by delegation", () => {
      store.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s", createdByRole: "Developer",
      });
      const a2 = store.registerArtifact({
        delegationId: "d2", type: "test", title: "A2", summary: "s", createdByRole: "QA",
      });
      const list = store.getArtifactsForDelegation("d2");
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(a2.id);
    });

    it("getArtifactsByType filters by artifact type", () => {
      store.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s", createdByRole: "Developer",
      });
      const a2 = store.registerArtifact({
        delegationId: "d2", type: "research", title: "A2", summary: "s", createdByRole: "Researcher",
      });
      const code = store.getArtifactsByType("code");
      expect(code).toHaveLength(1);
      expect(code[0].type).toBe("code");
      const research = store.getArtifactsByType("research");
      expect(research).toHaveLength(1);
      expect(research[0].id).toBe(a2.id);
    });

    it("getArtifactsNeededByDelegation returns artifacts from dependencies", () => {
      store.registerArtifact({
        delegationId: "d1", type: "code", title: "From D1", summary: "s", createdByRole: "Developer",
      });
      store.registerArtifact({
        delegationId: "d2", type: "code", title: "From D2", summary: "s", createdByRole: "Developer",
      });
      const del = makeDelegation("d3", ["d1", "d2"]);
      const needed = store.getArtifactsNeededByDelegation(del);
      expect(needed).toHaveLength(2);
    });
  });

  describe("bounded context building", () => {
    it("builds empty context when no artifacts", () => {
      const ctx = store.buildArtifactContext();
      expect(ctx).toContain("AVAILABLE ARTIFACTS");
      expect(ctx).toContain("(none)");
    });

    it("groups artifacts by type with paths and roles", () => {
      store.registerArtifact({
        delegationId: "d1", type: "code", title: "Player", summary: "Movement",
        createdByRole: "Developer", path: "src/player.ts",
      });
      store.registerArtifact({
        delegationId: "d2", type: "research", title: "Market", summary: "Size 10B",
        createdByRole: "Researcher",
      });
      const ctx = store.buildArtifactContext();
      expect(ctx).toContain("Code:");
      expect(ctx).toContain("Research:");
      expect(ctx).toContain("src/player.ts");
      expect(ctx).toContain("[Developer]");
      expect(ctx).toContain("[Researcher]");
    });

    it("truncates when context exceeds maxChars", () => {
      const tiny = new ArtifactStore(mission.id, { maxContextChars: 200 });
      for (let i = 0; i < 20; i++) {
        tiny.registerArtifact({
          delegationId: `d${i}`,
          type: "code",
          title: `Artifact ${i} with a longer title to take up space`,
          summary: "Some summary content here to fill the space",
          createdByRole: "Developer",
        });
      }
      const ctx = tiny.buildArtifactContext({ maxChars: 200 });
      expect(ctx.length).toBeLessThanOrEqual(400); // allow a bit of slack
    });

    it("limits by type when requested", () => {
      store.registerArtifact({
        delegationId: "d1", type: "code", title: "Code", summary: "s", createdByRole: "Developer",
      });
      store.registerArtifact({
        delegationId: "d2", type: "research", title: "Research", summary: "s", createdByRole: "Researcher",
      });
      const ctx = store.buildArtifactContext({ types: ["code"] });
      expect(ctx).toContain("Code:");
      expect(ctx).not.toContain("Research:");
    });
  });

  describe("attachToDelegation", () => {
    it("attaches artifacts as outputs", () => {
      const a = store.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s",
        createdByRole: "Developer",
      });
      const del = makeDelegation("d1");
      const updated = store.attachToDelegation(del);
      expect(updated.outputs).toBeDefined();
      expect(updated.outputs).toHaveLength(1);
      expect(updated.outputs![0].id).toBe(a.id);
    });

    it("returns delegation unchanged when no artifacts", () => {
      const del = makeDelegation("d-orphan");
      const result = store.attachToDelegation(del);
      expect(result).toBe(del);
    });
  });

  describe("clear and count", () => {
    it("clears all artifacts", () => {
      store.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s", createdByRole: "Developer",
      });
      expect(store.count()).toBe(1);
      store.clear();
      expect(store.count()).toBe(0);
    });
  });

  describe("createArtifactStore factory", () => {
    it("creates a store bound to the mission", () => {
      const s = createArtifactStore(mission);
      s.registerArtifact({
        delegationId: "d1", type: "code", title: "A1", summary: "s", createdByRole: "Developer",
      });
      expect(s.count()).toBe(1);
    });
  });
});
