import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectManifest } from "./types.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const manifestDir = path.resolve(moduleDir, "../scenarios/projects");

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidProjectId(projectId: string): boolean {
  return PROJECT_ID_PATTERN.test(projectId);
}

export async function loadProjectManifest(projectId: string): Promise<ProjectManifest | undefined> {
  if (!isValidProjectId(projectId)) return undefined;
  const manifestPath = path.join(manifestDir, `${projectId}.json`);
  const resolved = path.resolve(manifestPath);
  if (!resolved.startsWith(manifestDir + path.sep)) return undefined;
  try {
    const raw = JSON.parse(await readFile(resolved, "utf8")) as ProjectManifest;
    if (raw.id !== projectId) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export async function listSupportedProjects(): Promise<ProjectManifest[]> {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(manifestDir)).filter(name => name.endsWith(".json"));
  const manifests = await Promise.all(files.map(file => loadProjectManifest(file.replace(/\.json$/, ""))));
  return manifests.filter((m): m is ProjectManifest => Boolean(m));
}

export function resolveProjectPath(factoryRoot: string, manifest: ProjectManifest): string | undefined {
  const factoryResolved = path.resolve(factoryRoot);
  const projectPath = path.resolve(factoryResolved, manifest.factoryRelativePath);
  if (!projectPath.startsWith(factoryResolved + path.sep) && projectPath !== factoryResolved) return undefined;
  if (projectPath.includes("traffic-dodge-backup")) return undefined;
  return projectPath;
}
