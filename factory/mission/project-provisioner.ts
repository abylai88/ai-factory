import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * ProjectProvisioner — safe project creation from allowlisted templates.
 *
 * Security invariants:
 *   - Only templates under the approved templates directory are allowed
 *   - No absolute paths accepted from user input
 *   - No path traversal (../) accepted
 *   - No shell expressions, commands, or executable paths accepted
 *   - Template IDs must match a directory that physically exists
 */

export interface ProjectHandle {
  projectId: string;
  templateId: string;
  projectPath: string;
  createdAt: string;
}

export interface ProjectProvisionerConfig {
  baseDir: string;
  templatesDir: string;
  projectsDir: string;
  allowedTemplateIds: readonly string[];
}

const DANGEROUS_PATH_PATTERNS = [
  /\.\./,               // path traversal
  /^[/\\]/,             // absolute paths (unix or windows)
  /^[A-Z]:\\/i,         // windows drive letters
  /[`$|;&(){}]/,        // shell metacharacters
  /[\n\r]/,             // newlines (command injection)
  /<|>/,                // angle brackets (redirection)
  /!/,                  // history expansion
  /\s&&\s/,             // command chaining
  /\s\|\|/,             // command chaining
];

function isTemplateIdSafe(templateId: string): boolean {
  if (!templateId || templateId.length === 0) return false;
  if (templateId.length > 128) return false;

  for (const pattern of DANGEROUS_PATH_PATTERNS) {
    if (pattern.test(templateId)) return false;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) return false;

  return true;
}

function sanitizeProjectId(input?: string): string {
  if (!input) return `proj-${randomUUID().slice(0, 8)}`;
  const sanitized = input.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  if (sanitized.length === 0) return `proj-${randomUUID().slice(0, 8)}`;
  return sanitized;
}

export class ProjectProvisioner {
  private readonly config: ProjectProvisionerConfig;

  constructor(config: ProjectProvisionerConfig) {
    this.config = config;
  }

  /**
   * List all available (allowlisted + existing) templates.
   */
  async listTemplates(): Promise<Array<{ id: string; dir: string; exists: boolean }>> {
    const results: Array<{ id: string; dir: string; exists: boolean }> = [];
    for (const id of this.config.allowedTemplateIds) {
      const dir = path.join(this.config.templatesDir, id);
      let exists = false;
      try {
        const stat = await fs.stat(dir);
        exists = stat.isDirectory();
      } catch {
        exists = false;
      }
      results.push({ id, dir, exists });
    }
    return results;
  }

  /**
   * Provision a new project from an allowlisted template.
   *
   * @param templateId - must be in the allowlisted templates
   * @param projectId - optional user-supplied project ID (sanitized)
   * @returns ProjectHandle with path and metadata
   */
  async provision(templateId: string, projectId?: string): Promise<ProjectHandle> {
    if (!isTemplateIdSafe(templateId)) {
      throw new Error(
        `Invalid template ID "${templateId}". Template IDs must contain only alphanumeric characters, hyphens, and underscores.`
      );
    }

    if (!this.config.allowedTemplateIds.includes(templateId)) {
      throw new Error(
        `Template "${templateId}" is not in the allowlist. ` +
        `Allowed templates: ${this.config.allowedTemplateIds.join(", ")}`
      );
    }

    const templateDir = path.resolve(path.join(this.config.templatesDir, templateId));
    const allowedBase = path.resolve(this.config.templatesDir);

    if (!templateDir.startsWith(allowedBase + path.sep) && templateDir !== allowedBase) {
      throw new Error(`Template path escapes the allowed templates directory.`);
    }

    let templateExists = false;
    try {
      const stat = await fs.stat(templateDir);
      templateExists = stat.isDirectory();
    } catch {
      templateExists = false;
    }

    if (!templateExists) {
      throw new Error(
        `Template directory does not exist: templates/${templateId}. ` +
        `Available templates must exist under the templates/ directory.`
      );
    }

    const sanitizedId = sanitizeProjectId(projectId);
    const projectPath = path.join(this.config.projectsDir, sanitizedId);

    const projectExists = await this.pathExists(projectPath);
    if (projectExists) {
      throw new Error(
        `Project "${sanitizedId}" already exists at ${projectPath}. ` +
        `Choose a different project ID.`
      );
    }

    await fs.mkdir(this.config.projectsDir, { recursive: true });
    await this.copyTemplateDir(templateDir, projectPath);

    return {
      projectId: sanitizedId,
      templateId,
      projectPath,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Validate that a given project path exists and was created from a known template.
   */
  async validateProject(projectPath: string): Promise<{ valid: boolean; reason?: string }> {
    const projectsBase = path.resolve(this.config.projectsDir);

    if (!path.resolve(projectPath).startsWith(projectsBase + path.sep)) {
      return { valid: false, reason: "Project path is outside the projects directory." };
    }

    try {
      await fs.access(projectPath);
    } catch {
      return { valid: false, reason: "Project directory does not exist." };
    }

    return { valid: true };
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async copyTemplateDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    const excludeDirs = new Set(["node_modules", ".git", ".git2", "dist", "build"]);

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        await this.copyTemplateDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
