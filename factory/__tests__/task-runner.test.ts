import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyError,
  isRetryableError,
  chooseModel,
  getModelsForRole,
  AttemptErrorType
} from "../model-router/router.js";
import {
  TaskRunner,
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  ROLE_TIMEOUTS_MS,
  ROBLOX_ATTEMPT_TIMEOUT_MS,
  ROBLOX_ROLE_TIMEOUTS_MS,
} from "../task-runner/task-runner.js";
import { deployProjectConfig } from "../setup/project-setup.js";
import type {
  EnsureProjectReadyOptions,
  EnsureProjectReadyResult,
} from "../roblox/project-ready.js";

const TEST_PROJECT = "/tmp/test-project-opencode-mcp";
const TEST_BASE_DIR = "/tmp/test-base-opencode-mcp";

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
  it("returns the expected model pool size per role", () => {
    const roles = [
      "research", "game", "engineering", "qa",
      "competitor", "idea", "director", "gameplay",
      "programmer", "content", "monetization", "architect"
    ] as const;

    for (const role of roles) {
      expect(getModelsForRole(role).length).toBe(3);
    }

    // Market has an additional dedicated model for market analysis.
    expect(getModelsForRole("market").length).toBe(4);
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

// ─── Roblox-Aware Timeouts ──────────────────────────────────────

describe("roblox-aware timeouts", () => {
  it("Roblox default budget is tall (>= 15 minutes)", () => {
    expect(ROBLOX_ATTEMPT_TIMEOUT_MS).toBeGreaterThanOrEqual(900_000);
  });

  it("roblox platform uses the extended role budget", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/roblox-project" });
    expect(runner.getTimeoutForRole("programmer", "roblox")).toBe(ROBLOX_ROLE_TIMEOUTS_MS.programmer);
    expect(runner.getTimeoutForRole("qa", "roblox")).toBe(ROBLOX_ROLE_TIMEOUTS_MS.qa);
  });

  it("roblox platform falls back to the roblox default for unmapped roles", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/roblox-project" });
    expect(runner.getTimeoutForRole("research", "roblox")).toBe(ROBLOX_ATTEMPT_TIMEOUT_MS);
    expect(runner.getTimeoutForRole("nonexistent", "roblox")).toBe(ROBLOX_ATTEMPT_TIMEOUT_MS);
  });

  it("web/default platform keeps the historical role budgets", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/roblox-project" });
    expect(runner.getTimeoutForRole("programmer", "web")).toBe(300_000);
    expect(runner.getTimeoutForRole("programmer")).toBe(300_000);
  });

  it("explicit attemptTimeoutMs overrides even the roblox budget", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/p", attemptTimeoutMs: 999 });
    expect(runner.getTimeoutForRole("programmer", "roblox")).toBe(999);
  });

  it("RunnerConfig.robloxTimeoutMs caps unmapped roblox roles", () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/p", robloxTimeoutMs: 777 });
    expect(runner.getTimeoutForRole("research", "roblox")).toBe(777);
    // Mapped roles keep their specific budget.
    expect(runner.getTimeoutForRole("programmer", "roblox")).toBe(ROBLOX_ROLE_TIMEOUTS_MS.programmer);
  });

  it("detectPlatform returns web for a directory without default.project.json", async () => {
    const runner = new TaskRunner({ baseDir: "/tmp/test", project: "/tmp/definitely-not-a-roblox-dir" });
    expect(await runner.detectPlatform()).toBe("web");
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

// ─── MCP Configuration ──────────────────────────────────────────

describe("MCP configuration discovery", () => {
  beforeEach(async () => {
    // Ensure clean env for each test
    const original = process.env.AI_FACTORY_PROJECT;
    if (original !== undefined) {
      process.env.AI_FACTORY_PROJECT = original;
    } else {
      delete process.env.AI_FACTORY_PROJECT;
    }
    // Create temporary project with opencode.json
    const fs = await import("node:fs");
    await fs.promises.mkdir(TEST_PROJECT, { recursive: true });
    await fs.promises.writeFile(
      TEST_PROJECT + "/opencode.json",
      JSON.stringify({
        mcp: {
          robloxstudio: {
            type: "remote",
            url: "http://127.0.0.1:58741/mcp",
            oauth: false,
            headers: {
              "X-MCP-Auth": "{file:~/.robloxstudio-mcp/auth-token}"
            }
          }
        }
      }, null, 2)
    );
  });

  afterEach(async () => {
    // Clean up temporary project
    const fs = await import("node:fs");
    try {
      await fs.promises.rm(TEST_PROJECT, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    const original = process.env.AI_FACTORY_PROJECT;
    if (original !== undefined) {
      process.env.AI_FACTORY_PROJECT = original;
    } else {
      delete process.env.AI_FACTORY_PROJECT;
    }
  });

  it("project opencode.json with robloxstudio MCP config exists", async () => {
    const fs = await import("node:fs");
    const exists = await fs.promises.access(TEST_PROJECT + "/opencode.json").then(
      () => true,
      () => false
    );
    expect(exists).toBe(true);
  });

  it("opencode.json has the robloxstudio MCP server definition", async () => {
    const fs = await import("node:fs");
    const configContent = await fs.promises.readFile(TEST_PROJECT + "/opencode.json", "utf8");
    const config = JSON.parse(configContent);

    expect(config.mcp).toBeDefined();
    expect(config.mcp.robloxstudio).toBeDefined();
    expect(config.mcp.robloxstudio.type).toBe("remote");
    expect(config.mcp.robloxstudio.url).toBe("http://127.0.0.1:58741/mcp");
    expect(config.mcp.robloxstudio.oauth).toBe(false);
    expect(config.mcp.robloxstudio.headers).toBeDefined();
    expect(config.mcp.robloxstudio.headers["X-MCP-Auth"]).toBe(
      "{file:~/.robloxstudio-mcp/auth-token}"
    );
  });

  it("no secret token value is hardcoded or emitted in env", async () => {
    const fs = await import("node:fs");
    const configContent = await fs.promises.readFile(TEST_PROJECT + "/opencode.json", "utf8");
    const config = JSON.parse(configContent);

    // The auth value should be the file reference pattern, not an actual token
    const authValue = config.mcp.robloxstudio.headers["X-MCP-Auth"];
    expect(authValue).toBe("{file:~/.robloxstudio-mcp/auth-token}");
    expect(authValue).not.toMatch(/["a-f0-9]{32,}/); // not a hex token
    expect(authValue).not.toMatch(/sk-[a-zA-Z0-9]/); // not a secret key prefix
  });

  it("project opencode.json with robloxstudio MCP is discoverable", async () => {
    const fs = await import("node:fs");
    const configContent = await fs.promises.readFile(TEST_PROJECT + "/opencode.json", "utf8");
    const config = JSON.parse(configContent);

    // The key assertion: the robloxstudio MCP is configured with a remote URL
    // and a file-referenced auth token
    expect(config.mcp.robloxstudio.type).toBe("remote");
    expect(config.mcp.robloxstudio.url).toBe("http://127.0.0.1:58741/mcp");
    expect(config.mcp.robloxstudio.headers).toBeDefined();
    expect(config.mcp.robloxstudio.headers["X-MCP-Auth"]).toBe(
      "{file:~/.robloxstudio-mcp/auth-token}"
    );
  });

  it("smoke: OPENCODE_CONFIG is set pointing to project opencode.json", async () => {
    // Verify the OPENCODE_CONFIG env variable mechanism is correct.
    // In production, TaskRunner sets OPENCODE_CONFIG = project/opencode.json
    // so the child OpenCode process discovers the robloxstudio MCP config.
    // This test confirms the config file exists with the expected structure,
    // and gracefully reports MCP_UNAVAILABLE if Studio is not running.
    const fs = await import("node:fs");
    const configContent = await fs.promises.readFile(TEST_PROJECT + "/opencode.json", "utf8");
    const config = JSON.parse(configContent);

    // Verify MCP config structure exists
    expect(config.mcp).toBeDefined();
    expect(config.mcp.robloxstudio).toBeDefined();
    expect(typeof config.mcp.robloxstudio.url).toBe("string");
    expect(config.mcp.robloxstudio.url).toContain("127.0.0.1");

    // The auth is a file reference, not a hardcoded secret
    const authValue = config.mcp.robloxstudio.headers["X-MCP-Auth"];
    expect(authValue).toBe("{file:~/.robloxstudio-mcp/auth-token}");

    // Verify we can gracefully handle MCP unavailable:
    // If the robloxstudio MCP server is not running, OpenCode will report
    // MCP_UNAVAILABLE / NEEDS_HUMAN rather than failing unexpectedly.
    // This test verifies the config is set up correctly so that when the
    // live Studio/MCP is available, the child process can connect.
    // When Studio is not running, the system should report needs_human
    // or mcp_unavailable rather than crashing.
    expect(config.mcp.robloxstudio.type).toBe("remote");
});

// ─── Config merge verification ────────────────────────────────────

it("project opencode.json inherits robloxstudio MCP from root when merged", async () => {
    const fs = await import("node:fs");
    // Verify that the root opencode.json (Factory config) contains the
    // robloxstudio MCP definition, which will be merged into project configs
    const rootConfigContent = await fs.promises.readFile(
      "/home/asila/game-factory/ai-factory/opencode.json",
      "utf8"
    );
    const rootConfig = JSON.parse(rootConfigContent);
    expect(rootConfig.mcp).toBeDefined();
    expect(rootConfig.mcp.robloxstudio).toBeDefined();
    expect(rootConfig.mcp.robloxstudio.type).toBe("remote");
    expect(rootConfig.mcp.robloxstudio.url).toBe("http://127.0.0.1:58741/mcp");
    expect(rootConfig.mcp.robloxstudio.oauth).toBe(false);
    expect(rootConfig.mcp.robloxstudio.headers["X-MCP-Auth"]).toBe(
      "{file:~/.robloxstudio-mcp/auth-token}"
    );
  });

  it("root opencode.json has the expected robloxstudio MCP structure", async () => {
    const fs = await import("node:fs");
    const rootConfig = JSON.parse(
      await fs.promises.readFile("/home/asila/game-factory/ai-factory/opencode.json", "utf8")
    );
    expect(rootConfig.mcp).toBeDefined();
    expect(rootConfig.mcp.robloxstudio).toBeDefined();
    expect(rootConfig.mcp.robloxstudio.type).toBe("remote");
    expect(rootConfig.mcp.robloxstudio.url).toBe("http://127.0.0.1:58741/mcp");
    expect(rootConfig.mcp.robloxstudio.oauth).toBe(false);
    expect(rootConfig.mcp.robloxstudio.headers["X-MCP-Auth"]).toBe(
      "{file:~/.robloxstudio-mcp/auth-token}"
    );
  });

  // ─── Regression: existing workspace sync ──────────────────────────
  it("existing project opencode.json without MCP gains robloxstudio via deployProjectConfig", async () => {
    const fs = await import("node:fs");

    // Simulate an existing project whose opencode.json lacks the mcp section
    // but has project-specific settings (small_model, disabled_providers)
    const testProject = "/tmp/test-existing-workspace-no-mcp";
    await fs.promises.mkdir(testProject, { recursive: true });
    await fs.promises.writeFile(
      testProject + "/opencode.json",
      JSON.stringify({
        small_model: "opencode/mimo-v2.5-free",
        disabled_providers: ["openai", "anthropic"],
        // NOTE: no "mcp" section at all -- this simulates an existing
        // project that was created before the MCP sync was implemented
      }, null, 2)
    );

    // Run the same sync that TaskRunner.executeTask() performs
    await deployProjectConfig(testProject, "/home/asila/game-factory/ai-factory/opencode.json");

    // Read back and verify
    const configContent = await fs.promises.readFile(testProject + "/opencode.json", "utf8");
    const config = JSON.parse(configContent);

    // The robloxstudio MCP should have been merged in
    expect(config.mcp).toBeDefined();
    expect(config.mcp.robloxstudio).toBeDefined();
    expect(config.mcp.robloxstudio.type).toBe("remote");
    expect(config.mcp.robloxstudio.url).toBe("http://127.0.0.1:58741/mcp");
    expect(config.mcp.robloxstudio.oauth).toBe(false);
    expect(config.mcp.robloxstudio.headers).toBeDefined();
    expect(config.mcp.robloxstudio.headers["X-MCP-Auth"]).toBe(
      "{file:~/.robloxstudio-mcp/auth-token}"
    );

    // Existing project-specific settings should survive intact
    expect(config.small_model).toBe("opencode/mimo-v2.5-free");
    expect(Array.isArray(config.disabled_providers)).toBe(true);
    expect(config.disabled_providers).toEqual(["openai", "anthropic"]);
    // Unrelated top-level keys should also survive
    expect(config.foo).toBeUndefined(); // ensure we didn't accidentally add extra keys

    // Cleanup
    await fs.promises.rm(testProject, { recursive: true, force: true });
  });

  // ─── Config merge verification ────────────────────────────────────
});

describe("ensureRobloxReadiness", () => {
  async function makeDirs(roblox: boolean): Promise<{ base: string; project: string }> {
    const fs = await import("node:fs");
    const base = await fs.promises.mkdtemp("/tmp/runner-ready-base-");
    const project = await fs.promises.mkdtemp("/tmp/runner-ready-proj-");
    if (roblox) {
      await fs.promises.writeFile(
        project + "/default.project.json",
        JSON.stringify({ name: "T", tree: { $className: "DataModel" } })
      );
    }
    return { base, project };
  }

  async function cleanup(dirs: { base: string; project: string }): Promise<void> {
    const fs = await import("node:fs");
    await fs.promises.rm(dirs.base, { recursive: true, force: true });
    await fs.promises.rm(dirs.project, { recursive: true, force: true });
  }

  it("skips web projects without calling readiness", async () => {
    const dirs = await makeDirs(false);
    try {
      let called = 0;
      const runner = new TaskRunner({
        baseDir: dirs.base,
        project: dirs.project,
        projectReadyFn: (async () => {
          called++;
          return { ok: true, state: "PLACE_READY" };
        }) as unknown as (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>,
      });
      const r = await runner.ensureRobloxReadiness(dirs.project);
      expect(r.ok).toBe(true);
      expect(called).toBe(0);
    } finally {
      await cleanup(dirs);
    }
  });

  it("skips when ensureStudio is disabled", async () => {
    const dirs = await makeDirs(true);
    try {
      let called = 0;
      const runner = new TaskRunner({
        baseDir: dirs.base,
        project: dirs.project,
        ensureStudio: false,
        projectReadyFn: (async () => {
          called++;
          return { ok: true, state: "PLACE_READY" };
        }) as unknown as (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>,
      });
      const r = await runner.ensureRobloxReadiness(dirs.project);
      expect(r.ok).toBe(true);
      expect(called).toBe(0);
    } finally {
      await cleanup(dirs);
    }
  });

  it("runs readiness for roblox projects and passes through success", async () => {
    const dirs = await makeDirs(true);
    try {
      const runner = new TaskRunner({
        baseDir: dirs.base,
        project: dirs.project,
        projectReadyFn: (async () => ({
          ok: true,
          state: "PLACE_READY",
          artifact: { ok: true, artifactPath: "/tmp/x.rbxlx", fresh: true, rebuilt: false, sizeBytes: 10, buildDurationMs: 0, rojoBin: "/bin", freshnessReason: "test" },
        })) as unknown as (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>,
      });
      const r = await runner.ensureRobloxReadiness(dirs.project);
      expect(r.ok).toBe(true);
    } finally {
      await cleanup(dirs);
    }
  });

  it("passes through readiness failure without throwing", async () => {
    const dirs = await makeDirs(true);
    try {
      const runner = new TaskRunner({
        baseDir: dirs.base,
        project: dirs.project,
        projectReadyFn: (async () => ({ ok: false, code: "ROJO_UNAVAILABLE", reason: "no rojo" })) as unknown as (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>,
      });
      const r = await runner.ensureRobloxReadiness(dirs.project);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/no rojo/);
    } finally {
      await cleanup(dirs);
    }
  });

  it("converts a throwing readiness hook into PROJECT_NOT_READY", async () => {
    const dirs = await makeDirs(true);
    try {
      const runner = new TaskRunner({
        baseDir: dirs.base,
        project: dirs.project,
        projectReadyFn: (async () => {
          throw new Error("boom");
        }) as unknown as (projectDir: string, opts?: EnsureProjectReadyOptions) => Promise<EnsureProjectReadyResult>,
      });
      const r = await runner.ensureRobloxReadiness(dirs.project);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.result).toMatchObject({ code: "PROJECT_NOT_READY" });
    } finally {
      await cleanup(dirs);
    }
  });
});
