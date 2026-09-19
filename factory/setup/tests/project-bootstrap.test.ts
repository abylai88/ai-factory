import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  preflightProject,
  ensureProjectDependencies,
  isDependencyBootstrapFailure,
  selectInstallStrategy,
  requiredBinariesForProject,
  envWithLocalBin,
  BOOTSTRAP_ERROR_PREFIX,
  type InstallStrategy,
} from "../project-bootstrap.js";
import {
  PipelineRunner,
  isInfrastructureFailure,
  needsBootstrapPreflight,
  type StepExecutor,
} from "../../pipeline/pipeline-runner.js";
import { classifyFailure } from "../../mission/failure-triage.js";
import { ValidationGate } from "../../mission/validation-gate.js";
import { createDelegation, createMission } from "../../mission/mission.js";
import type { Task } from "../../task-manager/task-manager.js";
import type { Pipeline } from "../../pipeline/pipeline.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bootstrap-test-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const PHASER_PKG = {
  name: "phaser-generic-game",
  version: "1.0.0",
  scripts: {
    build: "webpack --config configs/webpack.prod.js",
    typecheck: "tsc --noEmit",
  },
  devDependencies: {
    typescript: "^5.9.3",
    webpack: "^5.88.2",
    "webpack-cli": "^5.1.4",
  },
  dependencies: {
    phaser: "^3.90.0",
  },
};

async function writeProject(
  dir: string,
  opts?: { withLock?: boolean; bins?: string[]; pkg?: unknown }
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(opts?.pkg ?? PHASER_PKG, null, 2)
  );
  if (opts?.withLock) {
    await fs.writeFile(
      path.join(dir, "package-lock.json"),
      JSON.stringify({ name: "x", lockfileVersion: 3, packages: { "": {} } })
    );
  }
  if (opts?.bins) {
    const binDir = path.join(dir, "node_modules", ".bin");
    await fs.mkdir(binDir, { recursive: true });
    for (const bin of opts.bins) {
      await fs.writeFile(path.join(binDir, bin), "#!/bin/sh\nexit 0\n");
    }
  }
  return dir;
}

/** Fake installer: records the strategy, materializes local binaries. */
function makeFakeInstaller(bins: string[] = ["webpack", "webpack-cli", "tsc"]) {
  const calls: Array<{ strategy: InstallStrategy; dir: string }> = [];
  const installer = async (strategy: InstallStrategy, dir: string) => {
    calls.push({ strategy, dir });
    const binDir = path.join(dir, "node_modules", ".bin");
    await fs.mkdir(binDir, { recursive: true });
    for (const bin of bins) {
      await fs.writeFile(path.join(binDir, bin), "#!/bin/sh\nexit 0\n");
    }
  };
  return { calls, installer };
}

// ─── 1. Fresh template project with no node_modules → installs ──────

describe("bootstrap — fresh scaffold installs dependencies", () => {
  it("runs npm install (no lockfile) and verifies local binaries", async () => {
    const dir = await writeProject(path.join(tmpRoot, "fresh"));
    const { calls, installer } = makeFakeInstaller();

    const before = await preflightProject(dir);
    expect(before.ok).toBe(false);
    expect(before.hasNodeModules).toBe(false);

    const result = await ensureProjectDependencies(dir, { installer });

    expect(result.ok).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.strategy).toBe("install");
    expect(calls.length).toBe(1);
    expect(calls[0].strategy).toBe("install");
    expect(calls[0].dir).toBe(dir);
    expect(result.preflight.ok).toBe(true);
    expect(result.preflight.missingBinaries).toEqual([]);
  });

  it("prefers npm ci when package-lock.json is available", async () => {
    const dir = await writeProject(path.join(tmpRoot, "locked"), { withLock: true });
    const { calls, installer } = makeFakeInstaller();

    const result = await ensureProjectDependencies(dir, { installer });

    expect(result.ok).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.strategy).toBe("ci");
    expect(calls[0].strategy).toBe("ci");
  });

  it("preserves the declared dependency versions (never rewrites package.json)", async () => {
    const dir = await writeProject(path.join(tmpRoot, "versions"));
    const beforePkg = await fs.readFile(path.join(dir, "package.json"), "utf8");
    const { installer } = makeFakeInstaller();

    await ensureProjectDependencies(dir, { installer });

    const afterPkg = await fs.readFile(path.join(dir, "package.json"), "utf8");
    expect(afterPkg).toBe(beforePkg);
    expect(JSON.parse(afterPkg).devDependencies.webpack).toBe("^5.88.2");
  });
});

// ─── 2. node_modules exists but webpack binary missing → repairs ─────

describe("bootstrap — missing webpack binary is detected and repaired", () => {
  it("preflight reports the missing binary and ensure reinstalls", async () => {
    const dir = await writeProject(path.join(tmpRoot, "broken"), {
      withLock: true,
      bins: ["tsc"],
    });
    // node_modules exists but webpack/webpack-cli are missing
    await fs.mkdir(path.join(dir, "node_modules", "phaser"), { recursive: true });

    const pre = await preflightProject(dir);
    expect(pre.ok).toBe(false);
    expect(pre.hasNodeModules).toBe(true);
    expect(pre.missingBinaries).toContain("webpack");
    expect(pre.missingBinaries).toContain("webpack-cli");

    const { calls, installer } = makeFakeInstaller();
    const result = await ensureProjectDependencies(dir, { installer });

    expect(result.ok).toBe(true);
    expect(result.installed).toBe(true);
    expect(result.strategy).toBe("ci");
    expect(calls.length).toBe(1);
  });
});

// ─── 3. valid node_modules → no unnecessary reinstall ────────────────

describe("bootstrap — healthy project is left alone", () => {
  it("does not reinstall when preflight passes", async () => {
    const dir = await writeProject(path.join(tmpRoot, "healthy"), {
      withLock: true,
      bins: ["webpack", "webpack-cli", "tsc"],
    });
    let installerCalls = 0;
    const installer = async () => {
      installerCalls++;
    };

    const result = await ensureProjectDependencies(dir, { installer });

    expect(result.ok).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(installerCalls).toBe(0);
  });

  it("does not require node_modules for dependency-free projects", async () => {
    const dir = await writeProject(path.join(tmpRoot, "minimal"), {
      pkg: { name: "test" },
    });
    let installerCalls = 0;
    const result = await ensureProjectDependencies(dir, {
      installer: async () => {
        installerCalls++;
      },
    });

    expect(result.ok).toBe(true);
    expect(result.installed).toBe(false);
    expect(installerCalls).toBe(0);
  });
});

// ─── 4. missing unrelated package ≠ agent failure ────────────────────

describe("bootstrap — unrelated missing module is dependency failure", () => {
  it("classifies 'Cannot find module' as bootstrap/dependency, not code failure", () => {
    expect(isDependencyBootstrapFailure("Cannot find module 'left-pad'")).toBe(true);
    expect(
      isDependencyBootstrapFailure(
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash'"
      )
    ).toBe(true);
  });

  it("triage routes it to dependency_missing, not builder repair", () => {
    const mission = createMission("Test");
    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering",
      { acceptanceCriteria: ["Build succeeds"] }
    );
    const result = classifyFailure({
      delegation,
      validationResult: {
        passed: false,
        command: "npm run build",
        exitCode: 1,
        stdout: "",
        stderr: "Cannot find module 'some-unrelated-pkg'",
        durationMs: 100,
      },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });

    expect(result.category).toBe("dependency_missing");
    expect(result.targetRole).not.toBe("builder");
  });

  it("preflight passes when required binaries exist even if other packages are absent", async () => {
    const dir = await writeProject(path.join(tmpRoot, "partial"), {
      withLock: true,
      bins: ["webpack", "webpack-cli", "tsc"],
    });
    // some unrelated package directory is simply not there
    const pre = await preflightProject(dir);
    expect(pre.ok).toBe(true);
  });
});

// ─── 5. bootstrap failure = infrastructure/dependency failure ────────

describe("bootstrap — failure classification", () => {
  it("failed install returns a dependency_bootstrap error", async () => {
    const dir = await writeProject(path.join(tmpRoot, "fail"));
    const result = await ensureProjectDependencies(dir, {
      installer: async () => {
        throw new Error("npm ERR! network unreachable");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^dependency_bootstrap:/);
  });

  it("bootstrap errors and shell not-found output are infrastructure", () => {
    expect(
      isInfrastructureFailure("dependency_bootstrap: install failed")
    ).toBe(true);
    expect(isInfrastructureFailure("sh: 1: webpack: not found")).toBe(true);
    expect(isInfrastructureFailure("webpack: not found")).toBe(true);
    expect(isInfrastructureFailure("tsc: command not found")).toBe(true);
    expect(isInfrastructureFailure("Cannot find module 'phaser'")).toBe(true);
    expect(isInfrastructureFailure("npm ERR! code ERESOLVE")).toBe(true);
    // Existing infra categories still work
    expect(isInfrastructureFailure("timeout: agent exceeded 300000ms")).toBe(true);
    // Ordinary project failures are NOT infrastructure
    expect(isInfrastructureFailure("SyntaxError: Unexpected token")).toBe(false);
    expect(isInfrastructureFailure(undefined)).toBe(false);
  });
});

// ─── 6. build runs using local webpack ───────────────────────────────

describe("bootstrap — builds use local dependencies", () => {
  it("envWithLocalBin puts project node_modules/.bin first on PATH", () => {
    const env = envWithLocalBin("/proj", { PATH: "/usr/bin:/bin" } as NodeJS.ProcessEnv);
    expect(env.PATH!.split(path.delimiter)[0]).toBe(
      path.join("/proj", "node_modules", ".bin")
    );
  });

  it("a project-local webpack stub resolves without any global install", async () => {
    const dir = path.join(tmpRoot, "local-webpack");
    await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "node_modules", ".bin", "webpack"),
      "#!/bin/sh\necho LOCAL-WEBPACK-MARKER\nexit 0\n",
      { mode: 0o755 }
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { build: "webpack" } })
    );

    const mission = createMission("Test");
    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: webpack --version",
      "engineering",
      { acceptanceCriteria: ["Build succeeds"] }
    );
    const gate = new ValidationGate({ timeoutMs: 10_000 });
    const result = await gate.validate(delegation, mission, dir);

    expect(result.passed).toBe(true);
    expect(result.stdout).toContain("LOCAL-WEBPACK-MARKER");
  });
});

// ─── 7. typecheck runs using local tsc ───────────────────────────────

describe("bootstrap — typecheck uses local tsc", () => {
  it("a project-local tsc stub resolves without any global install", async () => {
    const dir = path.join(tmpRoot, "local-tsc");
    await fs.mkdir(path.join(dir, "node_modules", ".bin"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "node_modules", ".bin", "tsc"),
      "#!/bin/sh\necho LOCAL-TSC-MARKER\nexit 0\n",
      { mode: 0o755 }
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { typecheck: "tsc --noEmit" } })
    );

    const mission = createMission("Test");
    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "Typecheck",
      "ROLE: builder\nBUILD_COMMAND: tsc --noEmit",
      "engineering",
      { acceptanceCriteria: ["Typecheck passes"] }
    );
    const gate = new ValidationGate({ timeoutMs: 10_000 });
    const result = await gate.validate(delegation, mission, dir);

    expect(result.passed).toBe(true);
    expect(result.stdout).toContain("LOCAL-TSC-MARKER");
  });
});

// ─── 8. no architect/repair cascade for bootstrap failures ───────────

describe("bootstrap — no architect/repair cascade", () => {
  it("triage maps 'webpack: not found' to dependency_missing (never architect)", () => {
    const mission = createMission("Test");
    const delegation = createDelegation(
      mission.id,
      "obj-1",
      "Build",
      "ROLE: builder\nBUILD_COMMAND: npm run build",
      "engineering",
      { acceptanceCriteria: ["Build succeeds"] }
    );
    const result = classifyFailure({
      delegation,
      validationResult: {
        passed: false,
        command: "npm run build",
        exitCode: 127,
        stdout: "",
        stderr: "sh: 1: webpack: not found",
        durationMs: 100,
      },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });

    expect(result.category).toBe("dependency_missing");
    expect(result.category).not.toBe("build_config");
    expect(result.action).not.toBe("architect_review");
    expect(result.targetRole).not.toBe("architect");
  });

  it("preflight covers implementation/test/build steps but not research/review", () => {
    expect(
      needsBootstrapPreflight({ id: "implementation", title: "", role: "engineering", agent: "programmer", description: "" })
    ).toBe(true);
    expect(
      needsBootstrapPreflight({ id: "test", title: "", role: "qa", agent: "tester", description: "" })
    ).toBe(true);
    expect(
      needsBootstrapPreflight({ id: "build", title: "", role: "engineering", agent: "builder", description: "" })
    ).toBe(true);
    expect(
      needsBootstrapPreflight({ id: "market", title: "", role: "research", agent: "market", description: "" })
    ).toBe(false);
    expect(
      needsBootstrapPreflight({ id: "review", title: "", role: "reviewer", agent: "reviewer", description: "" })
    ).toBe(false);
  });

  it("pipeline blocks on bootstrap failure without entering the bugfix loop", async () => {
    let executions = 0;
    const executor: StepExecutor = {
      async execute(task: Task): Promise<Task> {
        executions++;
        if (task.title.includes("Test implementation")) {
          return {
            ...task,
            status: "failed",
            error: `${BOOTSTRAP_ERROR_PREFIX} missing local binaries: webpack`,
            updatedAt: new Date().toISOString(),
          };
        }
        return {
          ...task,
          status: "passed",
          result: "ok",
          updatedAt: new Date().toISOString(),
        };
      },
    };

    const runner = new PipelineRunner({
      baseDir: "/tmp/test-base",
      project: "/tmp/test-project",
      executor,
    });
    const pipeline: Pipeline = {
      id: "test-pipeline",
      name: "Test",
      goal: "test goal",
      type: "game",
      steps: [
        { id: "implementation", title: "Implement game", role: "engineering", agent: "programmer", description: "desc" },
        { id: "test", title: "Test implementation", role: "qa", agent: "tester", description: "desc" },
      ],
    };

    const result = await runner.run(pipeline);

    expect(result.status).toBe("failed");
    expect(result.output).toContain("dependency_bootstrap");
    // implementation + one test attempt; the bugfix loop would add many more
    expect(executions).toBe(2);
  });
});

// ─── strategy + required-binary helpers ──────────────────────────────

describe("bootstrap — helpers", () => {
  it("selectInstallStrategy prefers ci only when a lockfile exists", () => {
    expect(selectInstallStrategy(true)).toBe("ci");
    expect(selectInstallStrategy(false)).toBe("install");
  });

  it("requiredBinariesForProject derives binaries from package.json", () => {
    expect(
      requiredBinariesForProject({
        devDependencies: { webpack: "^5.0.0", "webpack-cli": "^5.0.0", typescript: "^5.0.0" },
      }).sort()
    ).toEqual(["tsc", "webpack", "webpack-cli"]);
    expect(requiredBinariesForProject({ name: "test" })).toEqual([]);
    expect(requiredBinariesForProject(null, "phaser-generic-web-template").sort()).toEqual([
      "tsc",
      "webpack",
      "webpack-cli",
    ]);
  });
});
