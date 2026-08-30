import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { Artifact } from "../../shared/src/index.js";
import type { VisualQaRun } from "./types.js";

const ARTIFACT_ID_PATTERN = /^art_[A-Za-z0-9_-]{16,64}$/;

interface StoredArtifact {
  id: string;
  runId: string;
  type: Artifact["type"];
  label: string;
  relativePath: string;
  createdAt: string;
}

export class ArtifactStore {
  private readonly index = new Map<string, StoredArtifact>();
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async init() {
    await mkdir(path.join(this.rootDir, "runs"), { recursive: true });
  }

  runDir(runId: string) {
    return path.join(this.rootDir, "runs", runId);
  }

  viewportDir(runId: string, viewport: string) {
    return path.join(this.runDir(runId), viewport);
  }

  createArtifactId() {
    return `art_${randomBytes(12).toString("hex")}`;
  }

  isValidArtifactId(id: string) {
    return ARTIFACT_ID_PATTERN.test(id);
  }

  async saveBinary(runId: string, viewport: string, checkpoint: string, buffer: Buffer, type: Artifact["type"]): Promise<Artifact> {
    const dir = this.viewportDir(runId, viewport);
    await mkdir(dir, { recursive: true });
    const ext = type === "trace" ? "zip" : type === "report" ? "json" : "png";
    const fileName = `${checkpoint}.${ext}`;
    const absolute = path.join(dir, fileName);
    const relativePath = path.join("runs", runId, viewport, fileName);
    await writeFile(absolute, buffer);
    const id = this.createArtifactId();
    const record: StoredArtifact = {
      id,
      runId,
      type,
      label: `${viewport}/${checkpoint}`,
      relativePath,
      createdAt: new Date().toISOString()
    };
    this.index.set(id, record);
    return { id, type, label: record.label, createdAt: record.createdAt, available: true };
  }

  async saveRunResult(run: VisualQaRun) {
    const dir = this.runDir(run.runId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "result.json"), JSON.stringify(run, null, 2), "utf8");
  }

  async loadRunResult(runId: string): Promise<VisualQaRun | undefined> {
    try {
      const raw = await readFile(path.join(this.runDir(runId), "result.json"), "utf8");
      return JSON.parse(raw) as VisualQaRun;
    } catch {
      return undefined;
    }
  }

  getArtifact(id: string): StoredArtifact | undefined {
    if (!this.isValidArtifactId(id)) return undefined;
    return this.index.get(id);
  }

  registerArtifact(record: StoredArtifact) {
    if (!this.isValidArtifactId(record.id)) return;
    this.index.set(record.id, record);
  }

  async resolveArtifactPath(id: string): Promise<{ absolute: string; artifact: StoredArtifact } | undefined> {
    const artifact = this.getArtifact(id);
    if (!artifact) return undefined;
    const absolute = path.resolve(this.rootDir, artifact.relativePath);
    if (!absolute.startsWith(path.resolve(this.rootDir) + path.sep)) return undefined;
    try {
      await access(absolute);
      return { absolute, artifact };
    } catch {
      return undefined;
    }
  }

  listForRun(runId: string) {
    return [...this.index.values()].filter(a => a.runId === runId).map(a => ({
      id: a.id,
      type: a.type,
      label: a.label,
      createdAt: a.createdAt,
      available: true
    } satisfies Artifact));
  }
}
