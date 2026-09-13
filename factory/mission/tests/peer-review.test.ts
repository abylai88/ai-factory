import { describe, it, expect } from "vitest";
import { PeerReviewSystem, defaultReviewExecutor, type ReviewExecutor } from "../peer-review.js";
import type { Delegation, Mission, AgentResult } from "../mission.js";
import { createMission, createDelegation } from "../mission.js";
import { AgentRegistry } from "../agent-registry.js";

const mission: Mission = createMission("Build a feature", { projectId: "p1" });

function makeDel(id: string, role: Delegation["role"], requiresReview = true): Delegation {
  const del = createDelegation(mission.id, "obj-1", `Task ${id}`, `desc ${id}`, "engineering", {
    dependsOn: [],
    parallelizable: false,
    role,
    requiresReview,
  });
  del.id = id;
  return del;
}

function passingResult(id: string): AgentResult {
  return {
    delegationId: id,
    status: "passed",
    output: "Work done",
    durationMs: 10,
  };
}

describe("PeerReviewSystem", () => {
  describe("reviewer selection (independent)", () => {
    it("selects QA as primary reviewer for Developer work", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      expect(req).not.toBeNull();
      expect(req!.reviewerRole).toBe("QA");
      expect(req!.originalRole).toBe("Developer");
    });

    it("selects Developer as reviewer for Architect work", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Architect");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      expect(req!.reviewerRole).toBe("Developer");
    });

    it("selects QA as reviewer for Repair work", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Repair");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      expect(req!.reviewerRole).toBe("QA");
    });

    it("reviewer is NEVER the same as the original role", () => {
      const sys = new PeerReviewSystem();
      const roles: Array<Delegation["role"]> = [
        "Developer",
        "Architect",
        "QA",
        "Repair",
        "Designer",
      ];
      for (const role of roles) {
        const del = makeDel("d1", role);
        const req = sys.createReviewRequest({
          delegation: del,
          agentResult: passingResult("d1"),
          mission,
        });
        if (req) {
          expect(req.reviewerRole).not.toBe(role);
        }
      }
    });

    it("returns null when delegation has no role", () => {
      const sys = new PeerReviewSystem();
      const del = createDelegation(mission.id, "obj-1", "No role task", "desc", "engineering");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult(del.id),
        mission,
      });
      expect(req).toBeNull();
    });
  });

  describe("conducting reviews", () => {
    it("records a passing review", async () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      const passingExecutor: ReviewExecutor = async () => ({
        id: "res-mock",
        requestId: req!.id,
        delegationId: del.id,
        passed: true,
        issues: [],
        reviewerRole: req!.reviewerRole,
        summary: "Mock review passed",
        createdAt: new Date().toISOString(),
      });
      const result = await sys.conductReview(req!, passingExecutor);
      expect(result.passed).toBe(true);
      expect(sys.getReview(result.id)).toBeDefined();
    });

    it("records a failing review with custom executor", async () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      const result = await sys.conductReview(req!, async () => ({
        id: "res-custom",
        requestId: req!.id,
        delegationId: del.id,
        passed: false,
        issues: [
          { severity: "high", description: "Missing error handling" },
        ],
        reviewerRole: req!.reviewerRole,
        summary: "Needs error handling",
        createdAt: new Date().toISOString(),
      }));
      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
    });
  });

  describe("processReviewResult decisions", () => {
    it("returns 'approve' on passed review", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const decision = sys.processReviewResult(
        del,
        {
          id: "r1",
          requestId: "req1",
          delegationId: del.id,
          passed: true,
          issues: [],
          reviewerRole: "QA",
          summary: "OK",
          createdAt: new Date().toISOString(),
        },
        1,
      );
      expect(decision).toBe("approve");
    });

    it("returns 'repair' on first failing review", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const decision = sys.processReviewResult(
        del,
        {
          id: "r1",
          requestId: "req1",
          delegationId: del.id,
          passed: false,
          issues: [{ severity: "high", description: "issue" }],
          reviewerRole: "QA",
          summary: "needs work",
          createdAt: new Date().toISOString(),
        },
        1,
      );
      expect(decision).toBe("repair");
    });

    it("returns 'exhausted' when max attempts reached", () => {
      const sys = new PeerReviewSystem({ maxReviewAttempts: 2 });
      const del = makeDel("d1", "Developer");
      const decision = sys.processReviewResult(
        del,
        {
          id: "r1",
          requestId: "req1",
          delegationId: del.id,
          passed: false,
          issues: [{ severity: "high", description: "still broken" }],
          reviewerRole: "QA",
          summary: "still broken",
          createdAt: new Date().toISOString(),
        },
        2,
      );
      expect(decision).toBe("exhausted");
    });
  });

  describe("review prompt building", () => {
    it("includes mission goal and task", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      const prompt = sys.buildReviewPrompt(req!);
      expect(prompt).toContain("MISSION GOAL");
      expect(prompt).toContain(mission.goal);
      expect(prompt).toContain("REVIEW TASK");
      expect(prompt).toContain("QA"); // reviewer role
    });

    it("includes artifact paths when present", () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      del.outputs = [
        {
          id: "a1",
          delegationId: del.id,
          type: "code",
          title: "Player",
          summary: "Movement",
          createdByRole: "Developer",
          createdAt: new Date().toISOString(),
          path: "src/player.ts",
        },
      ];
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      const prompt = sys.buildReviewPrompt(req!);
      expect(prompt).toContain("ARTIFACTS TO REVIEW");
      expect(prompt).toContain("src/player.ts");
    });
  });

  describe("alternate reviewer selection", () => {
    it("returns an alternate for a known role", () => {
      const sys = new PeerReviewSystem();
      const alt = sys.selectAlternateReviewer("Developer");
      expect(alt).toBe("Architect");
    });
  });

  describe("getReviewsForDelegation", () => {
    it("returns all reviews for a delegation", async () => {
      const sys = new PeerReviewSystem();
      const del = makeDel("d1", "Developer");
      const r1 = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      const r2 = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      await sys.conductReview(r1!, defaultReviewExecutor);
      await sys.conductReview(r2!, defaultReviewExecutor);
      const reviews = sys.getReviewsForDelegation(del.id);
      expect(reviews.length).toBe(2);
    });
  });

  describe("custom registry", () => {
    it("uses the supplied registry for routing", () => {
      const customRegistry = new AgentRegistry();
      const sys = new PeerReviewSystem({ registry: customRegistry });
      const del = makeDel("d1", "Developer");
      const req = sys.createReviewRequest({
        delegation: del,
        agentResult: passingResult("d1"),
        mission,
      });
      expect(req!.reviewerRole).toBe("QA");
    });
  });
});
