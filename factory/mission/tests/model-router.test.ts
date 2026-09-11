import { describe, it, expect } from "vitest";
import { ModelRouter, createModelRouter } from "../model-router.js";
import type { Delegation, Mission, AgentRole } from "../mission.js";
import { createMission, createDelegation } from "../mission.js";

const mission: Mission = createMission("Build a thing", { projectId: "p1" });

function makeDel(id: string, role: AgentRole, title = "Task"): Delegation {
  return createDelegation(mission.id, "obj-1", title, `desc ${id}`, "engineering", {
    dependsOn: [],
    parallelizable: false,
    role,
  });
}

describe("ModelRouter", () => {
  describe("role-based routing", () => {
    it("returns a Developer model for Developer delegations", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "Developer"),
        role: "Developer",
        mission,
      });
      expect(route.primary).toBeDefined();
      expect(route.primary).toContain("claude-3-5-sonnet");
    });

    it("returns a Researcher model for Researcher delegations", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "Researcher"),
        role: "Researcher",
        mission,
      });
      expect(route.primary).toBeDefined();
    });

    it("returns an Architect model for Architect delegations", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "Architect"),
        role: "Architect",
        mission,
      });
      expect(route.primary).toBeDefined();
    });

    it("returns a QA model for QA delegations", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "QA"),
        role: "QA",
        mission,
      });
      expect(route.primary).toBeDefined();
    });
  });

  describe("complexity routing", () => {
    it("marks reason for complex tasks", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "Developer", "Debug critical production issue"),
        role: "Developer",
        mission,
        complexity: "expert",
      });
      expect(route.reason).toContain("complex");
    });

    it("marks reason for repair tasks", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "Repair"),
        role: "Repair",
        mission,
        isRepair: true,
      });
      expect(route.reason).toContain("repair");
    });

    it("marks reason for review tasks", () => {
      const router = new ModelRouter();
      const route = router.chooseModel({
        delegation: makeDel("d1", "QA"),
        role: "QA",
        mission,
        isReview: true,
      });
      expect(route.reason).toContain("review");
    });
  });

  describe("fallback routing", () => {
    it("returns at least one fallback for every known role", () => {
      const router = new ModelRouter();
      const roles: AgentRole[] = [
        "Developer",
        "Researcher",
        "Architect",
        "QA",
        "Repair",
        "Manager",
        "Designer",
      ];
      for (const role of roles) {
        const route = router.chooseModel({
          delegation: makeDel("d1", role),
          role,
          mission,
        });
        expect(route.fallbacks.length).toBeGreaterThan(0);
      }
    });

    it("nextFallback returns the first fallback after primary", () => {
      const router = new ModelRouter();
      const route = router.buildFallbackChain("Developer", ["Architect"]);
      const next = router.nextFallback(route, route.primary);
      expect(next).toBe(route.fallbacks[0]);
    });

    it("nextFallback returns next in chain when given a fallback", () => {
      const router = new ModelRouter();
      const route = router.buildFallbackChain("Developer");
      const first = router.nextFallback(route, route.primary)!;
      const second = router.nextFallback(route, first);
      expect(second).toBe(route.fallbacks[1] ?? null);
    });

    it("nextFallback returns null when no more fallbacks", () => {
      const router = new ModelRouter({ maxFallbacks: 1 });
      const route = router.buildFallbackChain("Developer");
      const next = router.nextFallback(route, route.fallbacks[0]);
      expect(next).toBeNull();
    });
  });

  describe("overrides", () => {
    it("respects override primary", () => {
      const router = new ModelRouter({
        overrides: {
          Developer: {
            primary: "custom/model",
            fallbacks: ["alt/model"],
            reason: "test override",
          },
        },
      });
      const route = router.chooseModel({
        delegation: makeDel("d1", "Developer"),
        role: "Developer",
        mission,
      });
      expect(route.primary).toBe("custom/model");
    });
  });

  describe("complexity estimation", () => {
    it("estimates simple complexity from task keywords", () => {
      const router = new ModelRouter();
      expect(router.estimateComplexity("rename a variable")).toBe("simple");
    });

    it("estimates complex from keywords", () => {
      const router = new ModelRouter();
      expect(router.estimateComplexity("debug integration issue")).toBe("complex");
    });

    it("estimates expert from keywords", () => {
      const router = new ModelRouter();
      expect(router.estimateComplexity("fix critical production security issue")).toBe("expert");
    });

    it("defaults to medium when no keywords match", () => {
      const router = new ModelRouter();
      expect(router.estimateComplexity("do something")).toBe("medium");
    });
  });

  describe("buildFallbackChain", () => {
    it("builds a chain from a primary role", () => {
      const router = new ModelRouter();
      const route = router.buildFallbackChain("Developer");
      expect(route.primary).toBeDefined();
      expect(route.fallbacks.length).toBeGreaterThan(0);
      expect(route.reason).toContain("Developer");
    });

    it("appends alternate roles to chain", () => {
      const router = new ModelRouter();
      const route = router.buildFallbackChain("Developer", ["Architect", "QA"]);
      expect(route.fallbacks.length).toBeGreaterThan(0);
      expect(route.reason).toContain("Architect");
      expect(route.reason).toContain("QA");
    });

    it("deduplicates fallbacks across roles", () => {
      const router = new ModelRouter();
      const route = router.buildFallbackChain("Developer", ["Architect"]);
      const unique = new Set(route.fallbacks);
      expect(unique.size).toBe(route.fallbacks.length);
    });
  });

  describe("factory", () => {
    it("createModelRouter returns a ModelRouter", () => {
      const r = createModelRouter();
      expect(r).toBeInstanceOf(ModelRouter);
    });
  });
});
