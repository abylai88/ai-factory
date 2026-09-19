import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { classifyGoal } from "../../engine/engine.js";
import { TemplateManager } from "../../setup/project-setup.js";
import {
  ensureProjectDependencies,
  preflightProject,
  isDependencyBootstrapFailure,
  type InstallStrategy,
} from "../../setup/project-bootstrap.js";
import {
  createFullGamePipeline,
  selectPipeline,
} from "../../pipeline/pipeline.js";
import {
  isInfrastructureFailure,
} from "../../pipeline/pipeline-runner.js";
import { ProjectProvisioner } from "../../mission/project-provisioner.js";
import { ValidationGate } from "../../mission/validation-gate.js";
import { classifyFailure } from "../../mission/failure-triage.js";
import { createMission, createDelegation } from "../../mission/mission.js";
import {
  isRobloxGoal,
  isRobloxMission,
  isRobloxProjectDir,
} from "../platform.js";
import { validateRobloxProject } from "../validation.js";
import { isRojoMissingFailure } from "../rojo.js";

// ─── Helpers ────────────────────────────────────────────────────

const ROBLOX_GOAL =
  "Create a Roblox simulator where the player collects coins, upgrades movement speed, and saves progress";
const WEB_GOAL = "Create a browser puzzle game with Phaser";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "roblox-regression-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Repo checkout root (factory code + real templates). */
function repoRoot(): string {
  return process.env.AI_FACTORY_HOME ?? process.cwd();
}

async function copyRobloxTemplate(dest: string): Promise<void> {
  const src = path.join(repoRoot(), "templates", "roblox-rojo-template");
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true });
}

function makeValidationDelegation(missionId: string) {
  // Roblox delegations carry no npm BUILD_COMMAND.
  return createDelegation(missionId, "obj-1", "Build Roblox project", "ROLE: builder", "engineering", {
    acceptanceCriteria: ["Rojo validation succeeds"],
  });
}

// ─── 1. Roblox goal → Roblox engine ─────────────────────────────

describe("1. Roblox goal selects the Roblox engine", () => {
  it("classifies the simulator goal as Roblox + Luau + Rojo", () => {
    const info = classifyGoal(ROBLOX_GOAL);
    expect(info.kind).toBe("roblox");
    expect(info.supported).toBe(true);
    expect(info.stack).toContain("Luau");
  });

  it("still classifies plain Roblox goals as Roblox", () => {
    expect(classifyGoal("Create a Roblox obby game").kind).toBe("roblox");
    expect(classifyGoal("Build a Luau project with Rojo", "roblox").kind).toBe("roblox");
  });

  it("keeps Web goals on the Web engine", () => {
    const info = classifyGoal(WEB_GOAL);
    expect(info.kind).toBe("web");
    expect(info.supported).toBe(true);
  });

  it("isRobloxGoal agrees with the engine classifier", () => {
    expect(isRobloxGoal(ROBLOX_GOAL)).toBe(true);
    expect(isRobloxGoal(WEB_GOAL)).toBe(false);
  });
});

// ─── 2. Roblox goal → Roblox template ───────────────────────────

describe("2. Roblox goal selects the Roblox template", () => {
  it("templateFor returns roblox-rojo-template for the Roblox engine", async () => {
    const manager = new TemplateManager(repoRoot());
    const engine = classifyGoal(ROBLOX_GOAL);
    const template = await manager.templateFor(engine, ROBLOX_GOAL);

    expect(template).not.toBeNull();
    expect(template!.id).toBe("roblox-rojo-template");
    expect(template!.engine).toBe("roblox");
    expect(template!.rootMarkers).toContain("default.project.json");
  });

  it("every root marker exists in the real template", async () => {
    const manager = new TemplateManager(repoRoot());
    const engine = classifyGoal(ROBLOX_GOAL);
    const template = await manager.templateFor(engine, ROBLOX_GOAL);

    for (const marker of template!.rootMarkers) {
      await expect(
        fs.access(path.join(template!.dir, marker)),
        `template marker missing: ${marker}`
      ).resolves.toBeUndefined();
    }
  });

  it("still selects a Web template for Web goals", async () => {
    const manager = new TemplateManager(repoRoot());
    const engine = classifyGoal(WEB_GOAL);
    const template = await manager.templateFor(engine, WEB_GOAL);

    expect(template).not.toBeNull();
    expect(template!.engine).toBe("web");
  });
});

// ─── 3. Roblox goal → Roblox pipeline ───────────────────────────

describe("3. Roblox goal selects the Roblox pipeline", () => {
  it("full game pipeline is Roblox-specific for the simulator goal", () => {
    const pipeline = createFullGamePipeline(ROBLOX_GOAL);

    expect(pipeline.name).toBe("Roblox Game Production Pipeline");

    const implementation = pipeline.steps.find((s) => s.id === "implementation");
    const test = pipeline.steps.find((s) => s.id === "test");
    const build = pipeline.steps.find((s) => s.id === "build");

    expect(implementation?.description).toContain("Luau");
    expect(test?.description).toContain("default.project.json");
    expect(build?.description).toContain("Rojo");
    expect(JSON.stringify(pipeline.steps)).not.toContain("npm run build");
  });

  it("selectPipeline routes the simulator goal to the full Roblox pipeline", () => {
    const pipeline = selectPipeline(ROBLOX_GOAL);
    expect(pipeline.type).toBe("game");
    expect(pipeline.name).toContain("Roblox");
  });
});

// ─── 4. Web goal → Web pipeline ─────────────────────────────────

describe("4. Web goal keeps the Web pipeline", () => {
  it("full game pipeline stays TypeScript/Phaser/npm for Web goals", () => {
    const pipeline = createFullGamePipeline(WEB_GOAL);

    expect(pipeline.name).toBe("Game Production Pipeline");

    const implementation = pipeline.steps.find((s) => s.id === "implementation");
    expect(implementation?.description).toContain("TypeScript");
    expect(implementation?.description).toContain("Phaser");
  });

  it("improvement + engineering pipelines stay Web for Web goals", () => {
    const fixPipeline = selectPipeline("Fix the bug in the browser game lobby");
    expect(fixPipeline.name).not.toContain("Roblox");
    expect(JSON.stringify(fixPipeline.steps)).not.toContain("Luau");
  });
});

// ─── 5. Roblox provisioning succeeds ────────────────────────────

describe("5. Roblox provisioning succeeds through the real factory path", () => {
  it("provisions the real Roblox template with Luau sources", async () => {
    const projectsDir = path.join(tmpRoot, "projects");
    const provisioner = new ProjectProvisioner({
      baseDir: tmpRoot,
      templatesDir: path.join(repoRoot(), "templates"),
      projectsDir,
      allowedTemplateIds: ["roblox-rojo-template", "phaser-generic-web-template"],
    });

    const handle = await provisioner.provision("roblox-rojo-template", "sim-smoke");

    expect(handle.templateId).toBe("roblox-rojo-template");
    expect(await isRobloxProjectDir(handle.projectPath)).toBe(true);

    // Real Rojo project: manifest + server entry + shared modules.
    await expect(fs.access(path.join(handle.projectPath, "default.project.json"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(handle.projectPath, "src/ServerScriptService/main.server.lua"))
    ).resolves.toBeUndefined();
    const tree = JSON.parse(
      await fs.readFile(path.join(handle.projectPath, "default.project.json"), "utf8")
    );
    expect(tree.tree.ServerScriptService["$path"]).toBe("src/ServerScriptService");
  });
});

// ─── 6. Web provisioning still succeeds ─────────────────────────

describe("6. Web provisioning still succeeds", () => {
  it("provisions a Web template without touching Roblox logic", async () => {
    const templatesDir = path.join(tmpRoot, "templates");
    const projectsDir = path.join(tmpRoot, "projects");
    await fs.mkdir(path.join(templatesDir, "phaser-generic-web-template", "src"), { recursive: true });
    await fs.mkdir(path.join(templatesDir, "phaser-generic-web-template", "configs"), { recursive: true });
    await fs.writeFile(
      path.join(templatesDir, "phaser-generic-web-template", "package.json"),
      JSON.stringify({ name: "web-game" })
    );
    await fs.writeFile(
      path.join(templatesDir, "phaser-generic-web-template", "tsconfig.json"),
      "{}"
    );

    const provisioner = new ProjectProvisioner({
      baseDir: tmpRoot,
      templatesDir,
      projectsDir,
      allowedTemplateIds: ["phaser-generic-web-template"],
    });

    const handle = await provisioner.provision("phaser-generic-web-template", "web-game");
    expect(handle.templateId).toBe("phaser-generic-web-template");
    expect(await isRobloxProjectDir(handle.projectPath)).toBe(false);
  });
});

// ─── 7. Roblox bootstrap does not run npm ───────────────────────

describe("7. Roblox bootstrap never runs npm", () => {
  it("ensureProjectDependencies is a no-op for Roblox projects", async () => {
    const projectDir = path.join(tmpRoot, "roblox-proj");
    await copyRobloxTemplate(projectDir);

    const calls: Array<{ strategy: InstallStrategy; dir: string }> = [];
    const result = await ensureProjectDependencies(projectDir, {
      templateId: "roblox-rojo-template",
      installer: async (strategy, dir) => {
        calls.push({ strategy, dir });
      },
    });

    expect(result.ok).toBe(true);
    expect(result.installed).toBe(false);
    expect(result.strategy).toBe("none");
    expect(calls).toEqual([]);
    expect(await fs.access(path.join(projectDir, "node_modules")).then(() => true, () => false)).toBe(false);
  });

  it("preflight passes for Roblox projects without package.json", async () => {
    const projectDir = path.join(tmpRoot, "roblox-preflight");
    await copyRobloxTemplate(projectDir);

    const pre = await preflightProject(projectDir, { templateId: "roblox-rojo-template" });
    expect(pre.ok).toBe(true);
    expect(pre.failures).toEqual([]);
  });
});

// ─── 8. Roblox validation uses the Roblox/Rojo path ─────────────

describe("8. Roblox validation uses the Roblox/Rojo path", () => {
  it("ValidationGate validates Roblox projects without npm", async () => {
    const projectDir = path.join(tmpRoot, "roblox-validate");
    await copyRobloxTemplate(projectDir);

    const mission = createMission(ROBLOX_GOAL, {
      projectId: "sim",
      engine: "roblox",
      stack: "Roblox + Luau + Rojo",
      template: "roblox-rojo-template",
      workspace: projectDir,
    });
    expect(isRobloxMission(mission)).toBe(true);

    const gate = new ValidationGate({ timeoutMs: 15_000 });
    const result = await gate.validate(makeValidationDelegation(mission.id), mission, projectDir, {
      buildCommand: undefined,
      engine: "roblox",
      timeoutMs: 15_000,
    });

    expect(result.command).not.toContain("npm");
    expect(result.command.toLowerCase()).toMatch(/rojo|roblox-validate/);
  });

  it("structural validation passes for the template even without Rojo installed", async () => {
    const projectDir = path.join(tmpRoot, "roblox-structural");
    await copyRobloxTemplate(projectDir);

    const result = await validateRobloxProject(projectDir, { runRojoBuild: false });
    expect(result.status).toBe("PASS");
    expect(result.affectedFiles).toContain("default.project.json");
  });

  it("malformed Rojo mappings FAIL (code/structure bug, not infra)", async () => {
    const projectDir = path.join(tmpRoot, "roblox-broken-map");
    await copyRobloxTemplate(projectDir);
    await fs.writeFile(
      path.join(projectDir, "default.project.json"),
      JSON.stringify({ name: "x", tree: { $className: "DataModel", Ghost: { $path: "src/DoesNotExist" } } })
    );

    const result = await validateRobloxProject(projectDir, { runRojoBuild: false });
    expect(result.status).toBe("FAIL");
    expect(result.stderr).toMatch(/mapping|does not exist|missing/i);
  });

  it("browser code leaked into Luau FAILS validation", async () => {
    const projectDir = path.join(tmpRoot, "roblox-webleak");
    await copyRobloxTemplate(projectDir);
    await fs.writeFile(
      path.join(projectDir, "src/ServerScriptService/evil.server.lua"),
      `import Phaser from "phaser";\nexport default function boot() {}\n`
    );

    const result = await validateRobloxProject(projectDir, { runRojoBuild: false });
    expect(result.status).toBe("FAIL");
    expect(result.affectedFiles.some((f) => f.includes("evil.server.lua"))).toBe(true);
  });
});

// ─── 9. Web validation still uses the npm path ──────────────────

describe("9. Web validation still uses the npm path", () => {
  it("ValidationGate runs npm build commands for Web projects", async () => {
    const projectDir = path.join(tmpRoot, "web-validate");
    await fs.mkdir(path.join(projectDir, "node_modules", ".bin"), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "node_modules", ".bin", "webpack"),
      "#!/bin/sh\necho WEBPACK-MARKER\nexit 0\n",
      { mode: 0o755 }
    );
    await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({ name: "x" }));

    const mission = createMission(WEB_GOAL, { engine: "web", workspace: projectDir });
    const delegation = createDelegation(mission.id, "obj-1", "Build", "ROLE: builder\nBUILD_COMMAND: webpack --version", "engineering", {
      acceptanceCriteria: ["Build succeeds"],
    });

    const gate = new ValidationGate({ timeoutMs: 10_000 });
    const result = await gate.validate(delegation, mission, projectDir);

    expect(result.passed).toBe(true);
    expect(result.stdout).toContain("WEBPACK-MARKER");
  });
});

// ─── 10. Roblox failure enters repair correctly ─────────────────

describe("10. Roblox failures route to code repair (not infra)", () => {
  it("malformed project.json classifies as roblox_structure → repair via builder", () => {
    const mission = createMission(ROBLOX_GOAL);
    const delegation = makeValidationDelegation(mission.id);
    const triage = classifyFailure({
      delegation,
      validationResult: {
        passed: false,
        command: "roblox-validate (structural)",
        exitCode: 1,
        stdout: "",
        stderr: "Malformed Rojo mappings: default.project.json references paths that do not exist.",
        durationMs: 50,
      },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });

    expect(triage.category).toBe("roblox_structure");
    expect(triage.action).toBe("repair");
    expect(triage.targetRole).toBe("builder");
  });

  it("isInfrastructureFailure does NOT fire for structure failures", () => {
    expect(
      isInfrastructureFailure("Malformed Rojo mappings: default.project.json references paths that do not exist.")
    ).toBe(false);
  });
});

// ─── 11. Infrastructure failure is classified separately ────────

describe("11. Missing Rojo is infrastructure, not a code bug", () => {
  it("rojo-missing text is a bootstrap/infra failure", () => {
    const msg = "roblox_toolchain: Rojo executable not found. Set ROJO_BIN ...";
    expect(isRojoMissingFailure(msg)).toBe(true);
    expect(isDependencyBootstrapFailure(msg)).toBe(true);
    expect(isInfrastructureFailure(msg)).toBe(true);
    expect(isRojoMissingFailure("sh: 1: rojo: not found")).toBe(true);
    expect(isInfrastructureFailure("sh: 1: rojo: not found")).toBe(true);
  });

  it("missing Rojo triages to research (never architect, never code repair)", () => {
    const mission = createMission(ROBLOX_GOAL);
    const delegation = makeValidationDelegation(mission.id);
    const triage = classifyFailure({
      delegation,
      validationResult: {
        passed: false,
        command: "rojo build default.project.json",
        exitCode: 127,
        stdout: "",
        stderr: "roblox_toolchain: Rojo executable not found.",
        durationMs: 10,
      },
      attempt: 1,
      maxAttempts: 3,
      previousErrors: [],
    });

    expect(triage.category).toBe("dependency_missing");
    expect(triage.action).toBe("research");
    expect(triage.targetRole).toBe("researcher");
    expect(triage.targetRole).not.toBe("architect");
    expect(triage.action).not.toBe("architect_review");
  });

  it("BLOCKED verdict surfaces when Rojo is absent", async () => {
    const projectDir = path.join(tmpRoot, "roblox-blocked");
    await copyRobloxTemplate(projectDir);

    const savedBin = process.env.ROJO_BIN;
    const savedPath = process.env.ROJO_PATH;
    process.env.ROJO_BIN = "/nonexistent/rojo-binary";
    delete process.env.ROJO_PATH;
    try {
      const result = await validateRobloxProject(projectDir);
      expect(result.status).toBe("BLOCKED");
      expect(result.stderr).toContain("roblox_toolchain:");
    } finally {
      if (savedBin === undefined) delete process.env.ROJO_BIN;
      else process.env.ROJO_BIN = savedBin;
      if (savedPath !== undefined) process.env.ROJO_PATH = savedPath;
    }
  });
});
