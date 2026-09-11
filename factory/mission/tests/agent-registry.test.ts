import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry, getDefaultRegistry, resetDefaultRegistry } from "../agent-registry.js";
import type { AgentRole } from "../mission.js";

describe("AgentRegistry", () => {
  beforeEach(() => {
    resetDefaultRegistry();
  });

  describe("capability lookup", () => {
    it("returns capabilities for known roles", () => {
      const registry = new AgentRegistry();
      const dev = registry.getCapabilities("Developer");
      expect(dev).toBeDefined();
      expect(dev?.role).toBe("Developer");
      expect(dev?.capabilities).toContain("implementation");
    });

    it("returns undefined for unknown roles", () => {
      const registry = new AgentRegistry();
      const result = registry.getCapabilities("NonExistent" as AgentRole);
      expect(result).toBeUndefined();
    });

    it("exposes all 7 standard roles", () => {
      const registry = new AgentRegistry();
      const roles = registry.getAllCapabilities().map((c) => c.role);
      expect(roles).toEqual(
        expect.arrayContaining([
          "Manager",
          "Researcher",
          "Developer",
          "Designer",
          "QA",
          "Repair",
          "Architect",
        ]),
      );
    });

    it("accepts custom capability overrides", () => {
      const registry = new AgentRegistry([
        {
          role: "Developer",
          name: "Custom Dev",
          description: "Custom",
          capabilities: ["custom-skill"],
          preferredTaskTypes: ["custom-task"],
          canReview: true,
          canSpawnSubtasks: true,
        },
      ]);
      const dev = registry.getCapabilities("Developer");
      expect(dev?.name).toBe("Custom Dev");
      expect(dev?.capabilities).toContain("custom-skill");
    });
  });

  describe("role matching for task", () => {
    it("matches Developer for implementation tasks", () => {
      const registry = new AgentRegistry();
      const role = registry.findBestRoleForTask("Implement a new feature in the game");
      expect(role).toBe("Developer");
    });

    it("matches Researcher for research tasks", () => {
      const registry = new AgentRegistry();
      const role = registry.findBestRoleForTask("Perform market research and competitor analysis");
      expect(role).toBe("Researcher");
    });

    it("matches QA for testing tasks", () => {
      const registry = new AgentRegistry();
      const role = registry.findBestRoleForTask("Run regression testing and bug reproduction");
      expect(role).toBe("QA");
    });

    it("matches Architect for architecture tasks", () => {
      const registry = new AgentRegistry();
      const role = registry.findBestRoleForTask("Design the system architecture and dependency analysis");
      expect(role).toBe("Architect");
    });

    it("matches Designer for UI tasks", () => {
      const registry = new AgentRegistry();
      const role = registry.findBestRoleForTask("Design the UI and visual assets");
      expect(role).toBe("Designer");
    });

    it("defaults to Developer for unmatched tasks", () => {
      const registry = new AgentRegistry();
      const role = registry.findBestRoleForTask("Do something completely random");
      expect(role).toBe("Developer");
    });
  });

  describe("reviewer routing", () => {
    it("routes Developer work to QA (primary) or Architect (alternate)", () => {
      const registry = new AgentRegistry();
      const route = registry.findReviewerRole("Developer");
      expect(route.primary).toBe("QA");
      expect(route.alternates).toContain("Architect");
    });

    it("routes Architect work to Developer (primary)", () => {
      const registry = new AgentRegistry();
      const route = registry.findReviewerRole("Architect");
      expect(route.primary).toBe("Developer");
    });

    it("routes Researcher work to Manager (primary)", () => {
      const registry = new AgentRegistry();
      const route = registry.findReviewerRole("Researcher");
      expect(route.primary).toBe("Manager");
    });

    it("routes Designer work to QA (primary) or Manager (alternate)", () => {
      const registry = new AgentRegistry();
      const route = registry.findReviewerRole("Designer");
      expect(route.primary).toBe("QA");
      expect(route.alternates).toContain("Manager");
    });

    it("routes Repair work to QA (primary)", () => {
      const registry = new AgentRegistry();
      const route = registry.findReviewerRole("Repair");
      expect(route.primary).toBe("QA");
    });

    it("routes QA work to Architect (primary)", () => {
      const registry = new AgentRegistry();
      const route = registry.findReviewerRole("QA");
      expect(route.primary).toBe("Architect");
    });

    it("ensures reviewer role != original role", () => {
      const registry = new AgentRegistry();
      const roles: AgentRole[] = [
        "Manager",
        "Researcher",
        "Developer",
        "Designer",
        "QA",
        "Repair",
        "Architect",
      ];
      for (const role of roles) {
        const route = registry.findReviewerRole(role);
        expect(route.primary).not.toBe(role);
      }
    });
  });

  describe("fallback roles", () => {
    it("returns at least one fallback for every known role", () => {
      const registry = new AgentRegistry();
      const roles: AgentRole[] = [
        "Manager",
        "Researcher",
        "Developer",
        "Designer",
        "QA",
        "Repair",
        "Architect",
      ];
      for (const role of roles) {
        const fallbacks = registry.getFallbackRoles(role);
        expect(fallbacks.length).toBeGreaterThan(0);
        expect(fallbacks).not.toContain(role);
      }
    });
  });

  describe("capability flags", () => {
    it("only Manager and Architect can review (by default)", () => {
      const registry = new AgentRegistry();
      expect(registry.canReview("Manager")).toBe(true);
      expect(registry.canReview("Architect")).toBe(true);
      expect(registry.canReview("Developer")).toBe(true);
      expect(registry.canReview("QA")).toBe(true);
      expect(registry.canReview("Researcher")).toBe(false);
      expect(registry.canReview("Designer")).toBe(false);
      expect(registry.canReview("Repair")).toBe(false);
    });

    it("only Manager can spawn subtasks by default", () => {
      const registry = new AgentRegistry();
      expect(registry.canSpawnSubtasks("Manager")).toBe(true);
      expect(registry.canSpawnSubtasks("Developer")).toBe(false);
      expect(registry.canSpawnSubtasks("QA")).toBe(false);
    });
  });

  describe("model and concurrency helpers", () => {
    it("returns preferred model for a role", () => {
      const registry = new AgentRegistry();
      const model = registry.getPreferredModel("Developer");
      expect(model).toBeDefined();
    });

    it("returns fallback models for a role", () => {
      const registry = new AgentRegistry();
      const fallbacks = registry.getFallbackModels("Developer");
      expect(Array.isArray(fallbacks)).toBe(true);
    });

    it("returns max concurrency for a role", () => {
      const registry = new AgentRegistry();
      const max = registry.getMaxConcurrency("Developer");
      expect(max).toBeGreaterThan(0);
    });
  });

  describe("default registry singleton", () => {
    it("returns the same instance", () => {
      const a = getDefaultRegistry();
      const b = getDefaultRegistry();
      expect(a).toBe(b);
    });

    it("resets the singleton", () => {
      const a = getDefaultRegistry();
      resetDefaultRegistry();
      const b = getDefaultRegistry();
      expect(a).not.toBe(b);
    });
  });
});
