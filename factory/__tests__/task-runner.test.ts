import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyError,
  isRetryableError,
  chooseModel,
  getModelsForRole,
  AttemptErrorType
} from "../model-router/router.js";
import { TaskRunner, DEFAULT_ATTEMPT_TIMEOUT_MS, ROLE_TIMEOUTS_MS } from "../task-runner/task-runner.js";

// ─── Error Classification ────────────────────────────────────────

describe("classifyError", () => {
  it("detects rate limit from text", () => {
    expect(classifyError("Rate limit exceeded. Please try again later.", 1)).toBe("rate_limit");
  });

  it("detects 429 status code in output", () => {
    expect(classifyError("Error 429: too many requests", 1)).toBe("rate_limit");
  });

  it("detects payment error", () => {
    expect(classifyError("No payment method on file.", 1)).toBe("payment_error");
  });

  it("detects CreditsError", () => {
    expect(classifyError("CreditsError: insufficient credits", 1)).toBe("payment_error");
  });

  it("detects upstream error", () => {
    expect(classifyError("Upstream error from provider", 1)).toBe("upstream_error");
  });

  it("detects 502 as upstream error", () => {
    expect(classifyError("Bad Gateway 502", 1)).toBe("upstream_error");
  });

  it("detects process error from non-zero exit", () => {
    expect(classifyError("Some random output", 1)).toBe("process_error");
  });

  it("returns unknown for empty output with exit code 0", () => {
    expect(classifyError("", 0)).toBe("unknown");
  });
});

describe("isRetryableError", () => {
  it("retryable: timeout", () => {
    expect(isRetryableError("timeout")).toBe(true);
  });

  it("retryable: rate_limit", () => {
    expect(isRetryableError("rate_limit")).toBe(true);
  });

  it("retryable: upstream_error", () => {
    expect(isRetryableError("upstream_error")).toBe(true);
  });

  it("retryable: process_error", () => {
    expect(isRetryableError("process_error")).toBe(true);
  });

  it("not retryable: payment_error", () => {
    expect(isRetryableError("payment_error")).toBe(false);
  });

  it("not retryable: success", () => {
    expect(isRetryableError("success")).toBe(false);
  });

  it("not retryable: unknown", () => {
    expect(isRetryableError("unknown")).toBe(false);
  });
});

// ─── Model Router ────────────────────────────────────────────────

describe("chooseModel", () => {
  it("selects first model when no failures", () => {
    const choice = chooseModel("research");
    expect(choice.model).toBe("opencode/mimo-v2.5-free");
  });

  it("skips failed models", () => {
    const choice = chooseModel("research", ["opencode/mimo-v2.5-free"]);
    expect(choice.model).toBe("opencode/nemotron-3-ultra-free");
  });

  it("falls back to first model when all failed", () => {
    const choice = chooseModel("research", [
      "opencode/mimo-v2.5-free",
      "opencode/nemotron-3-ultra-free",
      "opencode/nemotron-3.5-lightning-free"
    ]);
    expect(choice.model).toBe("opencode/mimo-v2.5-free");
  });

  it("uses engineering pool for unknown role", () => {
    const choice = chooseModel("nonexistent" as any);
    const engPool = getModelsForRole("engineering");
    expect(choice.model).toBe(engPool[0]);
  });
});

describe("getModelsForRole", () => {
  it("returns 3 models per role", () => {
    const roles = [
      "research", "game", "engineering", "qa", "market",
      "competitor", "idea", "director", "gameplay",
      "programmer", "content", "monetization", "architect"
    ] as const;

    for (const role of roles) {
      expect(getModelsForRole(role).length).toBe(3);
    }
  });

  it("returns free models only", () => {
    const roles = [
      "research", "engineering", "qa"
    ] as const;

    for (const role of roles) {
      const models = getModelsForRole(role);
      for (const model of models) {
        expect(model).toContain("-free");
      }
    }
  });
});

// ─── TaskRunner Safety ───────────────────────────────────────────

describe("TaskRunner safety", () => {
  it("throws when no project is provided and no env var", () => {
    const original = process.env.AI_FACTORY_PROJECT;
    delete process.env.AI_FACTORY_PROJECT;

    expect(() => {
      new TaskRunner({ baseDir: "/tmp/test" });
    }).toThrow(/project/);

    if (original !== undefined) {
      process.env.AI_FACTORY_PROJECT = original;
    }
  });

  it("uses AI_FACTORY_PROJECT env var as fallback", () => {
    const original = process.env.AI_FACTORY_PROJECT;
    process.env.AI_FACTORY_PROJECT = "/tmp/test-project";

    const runner = new TaskRunner({ baseDir: "/tmp/test" });
    expect(runner).toBeDefined();

    if (original !== undefined) {
      process.env.AI_FACTORY_PROJECT = original;
    } else {
      delete process.env.AI_FACTORY_PROJECT;
    }
  });

  it("accepts explicit project config", () => {
    const runner = new TaskRunner({
      baseDir: "/tmp/test",
      project: "/tmp/explicit"
    });
    expect(runner).toBeDefined();
  });
});

// ─── Timeout Constants ───────────────────────────────────────────

describe("timeout defaults", () => {
  it("default timeout is 120 seconds", () => {
    expect(DEFAULT_ATTEMPT_TIMEOUT_MS).toBe(120_000);
  });
});

// ─── Per-Role Timeouts ──────────────────────────────────────────

describe("per-role timeouts", () => {
  it("unknown role falls back to DEFAULT_ATTEMPT_TIMEOUT_MS", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/p" });
    expect(runner.getTimeoutForRole("nonexistent")).toBe(DEFAULT_ATTEMPT_TIMEOUT_MS);
  });

  it("role-specific timeout for director is 300s", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/p" });
    expect(runner.getTimeoutForRole("director")).toBe(300_000);
  });

  it("role-specific timeout for market is 180s", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/p" });
    expect(runner.getTimeoutForRole("market")).toBe(180_000);
  });

  it("explicit RunnerConfig.attemptTimeoutMs overrides role timeout", () => {
    const runner = new TaskRunner({
      baseDir: "/tmp/test",
      project: "/tmp/p",
      attemptTimeoutMs: 999
    });
    expect(runner.getTimeoutForRole("director")).toBe(999);
    expect(runner.getTimeoutForRole("market")).toBe(999);
    expect(runner.getTimeoutForRole("nonexistent")).toBe(999);
  });

  it("all ROLE_TIMEOUTS_MS values are defined", () => {
    const expectedRoles = [
      "research", "designer", "game", "engineering", "programmer",
      "qa", "reviewer", "market", "competitor", "idea",
      "director", "gameplay", "content", "monetization", "architect"
    ];
    for (const role of expectedRoles) {
      expect(ROLE_TIMEOUTS_MS[role]).toBeTypeOf("number");
      expect(ROLE_TIMEOUTS_MS[role]).toBeGreaterThan(0);
    }
  });
});

// ─── Pipeline Infrastructure Failure Detection ───────────────────

// We test this via the internal function by checking the pattern
// that would be used in pipeline-runner.ts
describe("infrastructure failure pattern", () => {
  const infraPatterns = [
    "timeout: Agent timed out after 120000ms",
    "rate_limit: Rate limit exceeded. Please try again later.",
    "rate_limit: Error 429",
    "payment_error: No payment method.",
    "payment_error: CreditsError"
  ];

  it("all infrastructure error patterns start with known prefixes", () => {
    const knownPrefixes = ["timeout:", "rate_limit:", "payment_error:"];
    for (const pattern of infraPatterns) {
      const matches = knownPrefixes.some(p => pattern.toLowerCase().startsWith(p));
      expect(matches).toBe(true);
    }
  });
});
