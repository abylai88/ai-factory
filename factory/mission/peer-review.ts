import { randomUUID } from "node:crypto";
import type {
  AgentRole,
  AgentResult,
  Delegation,
  Mission,
} from "./mission.js";
import { AgentRegistry, getDefaultRegistry } from "./agent-registry.js";

// ── Review Types ───────────────────────────────────────────────

export type ReviewIssueSeverity = "critical" | "high" | "medium" | "low";

export interface ReviewIssue {
  severity: ReviewIssueSeverity;
  description: string;
  file?: string;
  suggestedAction?: string;
}

export interface ReviewRequest {
  id: string;
  delegationId: string;
  artifactPaths: string[];
  originalRole: AgentRole;
  reviewerRole: AgentRole;
  task: string;
  expectedOutcome: string;
  missionId: string;
  context: {
    missionGoal: string;
    validationPassed?: boolean;
    validationError?: string;
  };
  createdAt: string;
}

export interface ReviewResult {
  id: string;
  requestId: string;
  delegationId: string;
  passed: boolean;
  issues: ReviewIssue[];
  reviewerRole: AgentRole;
  summary: string;
  createdAt: string;
}

export interface PeerReviewConfig {
  maxReviewAttempts?: number;
  registry?: AgentRegistry;
  reviewTimeoutMs?: number;
}

// ── Peer Review System ─────────────────────────────────────────

/**
 * Independent peer review system.
 *
 * Critical rule: an agent must NOT be the only authority validating its own work.
 * Reviewers are selected based on the original role via AgentRegistry routing rules.
 */
export class PeerReviewSystem {
  private readonly config: { maxReviewAttempts: number; reviewTimeoutMs: number; registry: AgentRegistry };
  private readonly registry: AgentRegistry;
  private readonly reviews: Map<string, ReviewResult> = new Map();

  constructor(config?: PeerReviewConfig) {
    const { maxReviewAttempts = 2, reviewTimeoutMs = 60000, registry } = config ?? {};
    this.config = { maxReviewAttempts, reviewTimeoutMs, registry: registry ?? getDefaultRegistry() };
    this.registry = this.config.registry;
  }

  /**
   * Create a review request for a delegation.
   * Selects a reviewer that is NOT the original role.
   */
  createReviewRequest(input: {
    delegation: Delegation;
    agentResult: AgentResult;
    mission: Mission;
    validationPassed?: boolean;
    validationError?: string;
    // Optional: current artifact paths from the filesystem/artifact store
    // If provided, these take precedence over delegation.outputs (which are plan-time)
    currentArtifactPaths?: string[];
  }): ReviewRequest | null {
    const originalRole = input.delegation.role;
    if (!originalRole) {
      return null;
    }
    if (!this.registry.canReview(originalRole) && !input.delegation.requiresReview) {
      return null;
    }

    const route = this.registry.findReviewerRole(originalRole);
    if (!route || route.primary === originalRole) {
      return null;
    }

    // Use current artifact paths if provided (post-repair), otherwise fall back to plan-time outputs
    const artifactPaths = (input.currentArtifactPaths ?? input.delegation.outputs ?? [])
      .map((o) => typeof o === "string" ? o : o.path)
      .filter((p): p is string => Boolean(p));

    return {
      id: `rev-${randomUUID().slice(0, 8)}`,
      delegationId: input.delegation.id,
      artifactPaths,
      originalRole,
      reviewerRole: route.primary,
      task: input.delegation.title,
      expectedOutcome: input.delegation.acceptanceCriteria.join("; ") || input.delegation.title,
      missionId: input.mission.id,
      context: {
        missionGoal: input.mission.goal,
        validationPassed: input.validationPassed,
        validationError: input.validationError,
      },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Run a review using the provided review executor.
   * The review executor is a function that simulates or actually performs the review.
   */
  async conductReview(
    request: ReviewRequest,
    reviewExecutor: ReviewExecutor,
  ): Promise<ReviewResult> {
    const result = await reviewExecutor(request);
    this.reviews.set(result.id, result);
    return result;
  }

  /**
   * Get a stored review result by ID.
   */
  getReview(id: string): ReviewResult | undefined {
    return this.reviews.get(id);
  }

  /**
   * Get all review results for a delegation.
   */
  getReviewsForDelegation(delegationId: string): ReviewResult[] {
    return Array.from(this.reviews.values()).filter(
      (r) => r.delegationId === delegationId,
    );
  }

  /**
   * Process a review result and decide next action.
   * Returns:
   *   - "approve" if review passed
   *   - "repair"  if review failed and we should route to a repair agent
   *   - "exhausted" if max review attempts have been reached
   */
  processReviewResult(
    delegation: Delegation,
    result: ReviewResult,
    attempt: number,
  ): "approve" | "repair" | "exhausted" {
    if (result.passed) {
      return "approve";
    }
    if (attempt >= this.config.maxReviewAttempts) {
      return "exhausted";
    }
    return "repair";
  }

  /**
   * Build a bounded review prompt for the reviewer agent.
   */
  buildReviewPrompt(request: ReviewRequest): string {
    const lines: string[] = [
      `MISSION GOAL`,
      request.context.missionGoal,
      ``,
      `YOUR ROLE`,
      request.reviewerRole,
      ``,
      `REVIEW TASK`,
      `You are reviewing the work of a ${request.originalRole} agent.`,
      ``,
      `Original task:`,
      request.task,
      ``,
      `Expected outcome:`,
      request.expectedOutcome,
      ``,
    ];

    if (request.context.validationPassed !== undefined) {
      lines.push(`Validation status: ${request.context.validationPassed ? "PASSED" : "FAILED"}`);
      if (request.context.validationError) {
        lines.push(`Validation error: ${request.context.validationError}`);
      }
      lines.push(``);
    }

    if (request.artifactPaths.length > 0) {
      lines.push(`ARTIFACTS TO REVIEW`);
      for (const path of request.artifactPaths) {
        lines.push(`  - ${path}`);
      }
      lines.push(``);
    }

    lines.push(
      `INSTRUCTIONS`,
      `Review the work above against the expected outcome. Report:`,
      `  - Whether the work PASSES review (yes/no)`,
      `  - Any issues with severity (critical, high, medium, low)`,
      `  - Suggested fix for each issue`,
      `  - A summary of your review`,
    );

    return lines.join("\n");
  }

  /**
   * Select an alternate reviewer when the primary is unavailable.
   */
  selectAlternateReviewer(role: AgentRole): AgentRole | undefined {
    const route = this.registry.findReviewerRole(role);
    return route.alternates[0];
  }

  /**
   * Get the maximum number of review attempts.
   */
  getMaxAttempts(): number {
    return this.config.maxReviewAttempts;
  }
}

// ── Review Executor ────────────────────────────────────────────

/**
 * A function that takes a ReviewRequest and returns a ReviewResult.
 * In real use this would invoke the reviewer agent. In tests it can be a mock.
 */
export type ReviewExecutor = (request: ReviewRequest) => Promise<ReviewResult>;

// ── Default Review Executor (stub) ─────────────────────────────

/**
 * Default review executor that blocks by default.
 * Forces explicit configuration of a real reviewer in production.
 * Tests should provide a mock executor that returns passed: true.
 */
export const defaultReviewExecutor: ReviewExecutor = async (request: ReviewRequest) => ({
  id: `res-${randomUUID().slice(0, 8)}`,
  requestId: request.id,
  delegationId: request.delegationId,
  passed: false,
  issues: [{ severity: "critical", description: "Peer review requires a configured review executor. Provide a real executor in production." }],
  reviewerRole: request.reviewerRole,
  summary: "Default executor: review blocked (no real executor configured).",
  createdAt: new Date().toISOString(),
});
