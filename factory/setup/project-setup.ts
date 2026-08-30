import { promises as fs } from "node:fs";
import path from "node:path";
import { EngineInfo } from "../engine/engine.js";

/**
 * ProjectSetup / TemplateManager layer.
 *
 * Responsible for scaffolding a NEW isolated project workspace from an
 * embedded template BEFORE any game-generation agents run. Key rules:
 *   - never copy node_modules
 *   - never copy .git
 *   - never destroy an existing workspace (fail instead)
 *   - engine must already be decided (classifyGoal / --engine) — setup never
 *     guesses the engine from the freshly copied template
 *   - RESUME: if workspace already contains a valid initialized project
 *     (all rootMarkers present), setup is skipped and agents are verified.
 */

export interface TemplateDescriptor {
  id: string;
  engine: "web";
  stack: string;
  dir: string;
  rootMarkers: string[];
}

export interface SetupResult {
  templateId: string;
  created: boolean;
  resumed: boolean;
  workspaceDir: string;
  engine: EngineInfo;
  template: TemplateDescriptor;
  copied: string[];
  skipped: string[];
  agentsDeployed: string[];
  agentsFailed: string[];
}

const EXCLUDE_DIRS = new Set(["node_modules", ".git", ".git2", "dist", "build"]);

/**
 * Project-local OpenCode agents that are deployed into every generated
 * project at <project>/.opencode/agents/ so that when TaskRunner launches
 * opencode with cwd=PROJECT_ROOT, these custom agents are discovered.
 */
export const PIPELINE_AGENTS: readonly string[] = [
  "researcher",
  "designer",
  "builder",
  "tester",
  "reviewer"
];

/**
 * Game-specific agents deployed for game production pipelines.
 * These are additional agents beyond the base pipeline agents.
 */
export const GAME_PIPELINE_AGENTS: readonly string[] = [
  "market",
  "competitor",
  "idea",
  "director",
  "gameplay",
  "programmer",
  "content",
  "monetization",
  "architect"
];

/**
 * All agents that can be deployed — base + game specialized.
 */
export const ALL_PIPELINE_AGENTS: readonly string[] = [
  ...PIPELINE_AGENTS,
  ...GAME_PIPELINE_AGENTS
];

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class TemplateManager {
  private readonly baseDir: string;
  private readonly templatesDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.templatesDir = path.join(baseDir, "templates");
  }

  /** Build the template descriptor for a WEB project. */
  async templateFor(engine: EngineInfo): Promise<TemplateDescriptor | null> {
    if (engine.kind !== "web" || !engine.supported) {
      return null;
    }

    const candidates = ["yagames-phaser-template"];

    for (const id of candidates) {
      const dir = path.join(this.templatesDir, id);
      if (await pathExists(dir)) {
        return {
          id,
          engine: "web",
          stack: engine.stack ?? "Phaser + TypeScript + Webpack",
          dir,
          rootMarkers: ["package.json", "configs", "src", "tsconfig.json"]
        };
      }
    }

    return null;
  }

  /**
   * Check if an existing workspace already contains a valid initialized
   * project by verifying all rootMarkers are present.
   */
  async isInitializedWorkspace(
    workspaceDir: string,
    template: TemplateDescriptor
  ): Promise<boolean> {
    const verification = await this.verifyWorkspace(workspaceDir, template);
    return verification.complete;
  }

  /**
   * Copy a template into `workspaceDir` as an isolated project.
   * Skips node_modules/.git/dist/build. If the workspace already exists and
   * contains a valid initialized project, RESUMES instead of overwriting.
   * Fails (NOT destructive) if the workspace exists but is not a recognized
   * project, unless `force` is set.
   */
  async copyTemplate(
    template: TemplateDescriptor,
    workspaceDir: string,
    opts?: { force?: boolean }
  ): Promise<SetupResult> {
    const copied: string[] = [];
    const skipped: string[] = [];
    const workspaceExists = await pathExists(workspaceDir);

    if (workspaceExists) {
      const existing = await fs.readdir(workspaceDir);

      if (existing.length > 0 && !opts?.force) {
        const initialized = await this.isInitializedWorkspace(workspaceDir, template);

        if (initialized) {
          const deployed = await AgentDeployer.deploy(this.baseDir, workspaceDir);
          await deployProjectConfig(workspaceDir);
          return {
            templateId: template.id,
            created: false,
            resumed: true,
            workspaceDir,
            engine: {
              kind: template.engine,
              stack: template.stack,
              supported: true,
              reason: `Existing workspace detected — resuming from on-disk project.`
            },
            template,
            copied: [],
            skipped: [],
            agentsDeployed: deployed.deployed,
            agentsFailed: deployed.failed
          };
        }

        throw new Error(
          `Workspace already exists and is not empty (${existing.length} entries) at ${workspaceDir}. ` +
            `Not a recognized initialized project. Remove it first or use --force.`
        );
      }
    }

    await fs.mkdir(workspaceDir, { recursive: true });

    const copiedFiles = await copyDir(template.dir, workspaceDir, copied, skipped);

    const deployed = await AgentDeployer.deploy(this.baseDir, workspaceDir);
    await deployProjectConfig(workspaceDir);

    return {
      templateId: template.id,
      created: true,
      resumed: false,
      workspaceDir,
      engine: {
        kind: template.engine,
        stack: template.stack,
        supported: true,
        reason: `Set up from embedded template ${template.id}.`
      },
      template,
      copied: copiedFiles,
      skipped,
      agentsDeployed: deployed.deployed,
      agentsFailed: deployed.failed
    };
  }

  /**
   * Verify a workspace was correctly scaffolded from a template. Returns the
   * root markers that are present and whether they were all copied.
   */
  async verifyWorkspace(
    workspaceDir: string,
    template: TemplateDescriptor
  ): Promise<{ found: string[]; missing: string[]; complete: boolean }> {
    const found: string[] = [];
    const missing: string[] = [];
    for (const marker of template.rootMarkers) {
      if (await pathExists(path.join(workspaceDir, marker))) {
        found.push(marker);
      } else {
        missing.push(marker);
      }
    }
    return {
      found,
      missing,
      complete: missing.length === 0
    };
  }
}

/** Recursively copy a directory, recording files copied and entries skipped. */
async function copyDir(
  src: string,
  dest: string,
  copiedOut: string[],
  skippedOut: string[]
): Promise<string[]> {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const rel = path.relative(dest, destPath);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) {
        skippedOut.push(rel);
        continue;
      }
      await fs.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath, copiedOut, skippedOut);
    } else {
      if (EXCLUDE_DIRS.has(entry.name)) {
        skippedOut.push(rel);
        continue;
      }
      await fs.copyFile(srcPath, destPath);
      copiedOut.push(rel);
    }
  }

  return copiedOut;
}

/**
 * Deploys the AI Factory pipeline agents from <base>/agents/opencode into a
 * project at <project>/.opencode/agents/, so opencode (launched with
 * cwd=<project>) discovers them as project-local agents. Missing source
 * definitions are reported in `failed` but never block a scaffold: real
 * agents can still be selected because TaskRunner falls back to built-ins.
 */
export class AgentDeployer {
  /**
   * Copy all pipeline agent definitions into `projectDir/.opencode/agents/`.
   * Returns which agent names deployed and which failed (missing/copy error).
   * Deploys both base pipeline agents and game-specific agents.
   */
  static async deploy(
    baseDir: string,
    projectDir: string
  ): Promise<{ deployed: string[]; failed: string[] }> {
    const deployed: string[] = [];
    const failed: string[] = [];

    const sourceDir = path.join(baseDir, "agents", "opencode");
    if (!(await pathExists(sourceDir))) {
      return { deployed, failed: [...ALL_PIPELINE_AGENTS] };
    }

    const targetDir = path.join(projectDir, ".opencode", "agents");
    await fs.mkdir(targetDir, { recursive: true });

    for (const name of ALL_PIPELINE_AGENTS) {
      const src = path.join(sourceDir, `${name}.md`);
      const dest = path.join(targetDir, `${name}.md`);
      try {
        await fs.copyFile(src, dest);
        deployed.push(name);
      } catch {
        failed.push(name);
      }
    }

    return { deployed, failed };
  }
}

const FACTORY_OPENCODE_CONFIG = {
  "$schema": "https://opencode.ai/config.json",
  "small_model": "opencode/mimo-v2.5-free",
  "disabled_providers": ["openai", "anthropic"]
};

/**
 * Deploy the AI Factory project-level OpenCode configuration.
 * This sets `small_model` to a free model to avoid payment errors on
 * title generation, and disables paid providers.
 */
async function deployProjectConfig(projectDir: string): Promise<void> {
  const configPath = path.join(projectDir, "opencode.json");

  try {
    const existing = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(existing);

    if (parsed.small_model) {
      return;
    }
  } catch {
    // File doesn't exist or is invalid — write fresh config
  }

  await fs.writeFile(
    configPath,
    JSON.stringify(FACTORY_OPENCODE_CONFIG, null, 2),
    "utf8"
  );
}

/** Convenience: resolve the default project workspace dir from a goal. */
export function goalSlug(goal: string): string {
  return (
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** Compute the isolated workspace path under <base>/projects/<slug>. */
export function resolveWorkspaceDir(baseDir: string, goal: string): string {
  return path.join(baseDir, "projects", goalSlug(goal));
}
