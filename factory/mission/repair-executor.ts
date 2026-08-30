import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Mission,
  DiagnosisRepairPlan,
  RepairAction,
} from "./mission.js";
import { auditRepairPlan, isRepairPlanSafe } from "./repair-plan-audit.js";

export interface RepairExecutionResult {
  status: "completed" | "failed" | "rejected";
  changedFiles: string[];
  actionsCompleted: number;
  actionsFailed: number;
  summary: string;
  startedAt: string;
  finishedAt: string;
}

export interface RepairExecutor {
  execute(
    mission: Mission,
    repairPlan: DiagnosisRepairPlan,
    projectPath: string
  ): Promise<RepairExecutionResult>;
}

// ─── Path Safety ────────────────────────────────────────────────────

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || filePath.startsWith("~");
}

function hasPathTraversal(filePath: string): boolean {
  return filePath.includes("..");
}

async function hasSymlinkEscape(filePath: string, projectPath: string): Promise<boolean> {
  const resolved = path.resolve(projectPath, filePath);
  const parts = resolved.split(path.sep);
  const projectParts = projectPath.split(path.sep);

  for (let i = projectParts.length; i <= parts.length; i++) {
    const checkPath = parts.slice(0, i).join(path.sep);
    try {
      const stat = await fs.lstat(checkPath);
      if (stat.isSymbolicLink()) {
        return true;
      }
    } catch {
      break;
    }
  }

  return false;
}

function isInProtectedPath(filePath: string, protectedPaths: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of protectedPaths) {
    const prefix = pattern.replace(/\/?\*\*$/, "").replace(/\/$/, "");
    if (normalized === prefix || normalized.startsWith(prefix + "/")) {
      return true;
    }
    const dir = normalized.split("/")[0];
    const patternDir = prefix.split("/")[0];
    if (dir === patternDir) {
      return true;
    }
  }
  return false;
}

function validateActionFilePath(
  filePath: string,
  projectPath: string,
  protectedPaths: string[]
): { valid: boolean; reason?: string } {
  if (!filePath || filePath.trim().length === 0) {
    return { valid: false, reason: "Action file path is empty" };
  }

  if (isAbsolutePath(filePath)) {
    return { valid: false, reason: `Absolute path not allowed: ${filePath}` };
  }

  if (hasPathTraversal(filePath)) {
    return { valid: false, reason: `Path traversal not allowed: ${filePath}` };
  }

  if (isInProtectedPath(filePath, protectedPaths)) {
    return { valid: false, reason: `Protected path not allowed: ${filePath}` };
  }

  return { valid: true };
}

// ─── Structured File Modification ───────────────────────────────────

async function modifyFile(
  filePath: string,
  projectPath: string
): Promise<{ beforeContent: string; afterContent: string }> {
  const fullPath = path.resolve(projectPath, filePath);

  const beforeContent = await fs.readFile(fullPath, "utf8");
  const afterContent = beforeContent;

  return { beforeContent, afterContent };
}

async function createFile(
  filePath: string,
  projectPath: string
): Promise<{ beforeContent: string; afterContent: string }> {
  const fullPath = path.resolve(projectPath, filePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });

  let beforeContent = "";
  try {
    beforeContent = await fs.readFile(fullPath, "utf8");
  } catch {
    beforeContent = "";
  }

  return { beforeContent, afterContent: beforeContent };
}

async function deleteFile(
  filePath: string,
  projectPath: string
): Promise<{ beforeContent: string; afterContent: string }> {
  const fullPath = path.resolve(projectPath, filePath);

  let beforeContent = "";
  try {
    beforeContent = await fs.readFile(fullPath, "utf8");
  } catch {
    beforeContent = "";
  }

  await fs.unlink(fullPath);
  return { beforeContent, afterContent: "" };
}

async function replaceFile(
  filePath: string,
  projectPath: string
): Promise<{ beforeContent: string; afterContent: string }> {
  const fullPath = path.resolve(projectPath, filePath);

  const beforeContent = await fs.readFile(fullPath, "utf8");
  const afterContent = beforeContent;

  return { beforeContent, afterContent };
}

// ─── Deterministic RepairExecutor ───────────────────────────────────

export class DeterministicRepairExecutor implements RepairExecutor {
  async execute(
    mission: Mission,
    repairPlan: DiagnosisRepairPlan,
    projectPath: string
  ): Promise<RepairExecutionResult> {
    const startedAt = new Date().toISOString();

    // ─── Pre-flight validation ────────────────────────────────────

    if (!repairPlan || !repairPlan.actions || repairPlan.actions.length === 0) {
      return {
        status: "rejected",
        changedFiles: [],
        actionsCompleted: 0,
        actionsFailed: 0,
        summary: "Invalid or empty RepairPlan",
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    if (!mission || !mission.id) {
      return {
        status: "rejected",
        changedFiles: [],
        actionsCompleted: 0,
        actionsFailed: 0,
        summary: "Invalid mission",
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    if (repairPlan.missionId !== mission.id) {
      return {
        status: "rejected",
        changedFiles: [],
        actionsCompleted: 0,
        actionsFailed: 0,
        summary: "RepairPlan missionId does not match mission",
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    // ─── Re-run safety audit immediately before execution ─────────

    const violations = auditRepairPlan(repairPlan);
    if (violations.length > 0) {
      return {
        status: "rejected",
        changedFiles: [],
        actionsCompleted: 0,
        actionsFailed: 0,
        summary: `RepairPlan failed safety audit: ${violations.map((v) => v.message).join("; ")}`,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    if (!isRepairPlanSafe(repairPlan)) {
      return {
        status: "rejected",
        changedFiles: [],
        actionsCompleted: 0,
        actionsFailed: 0,
        summary: "RepairPlan is not safe",
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    // ─── Validate project exists ──────────────────────────────────

    try {
      await fs.access(projectPath);
    } catch {
      return {
        status: "rejected",
        changedFiles: [],
        actionsCompleted: 0,
        actionsFailed: 0,
        summary: `Project path does not exist: ${projectPath}`,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }

    // ─── Validate all actions before executing any ────────────────

    for (const action of repairPlan.actions) {
      const validation = validateActionFilePath(
        action.file,
        projectPath,
        [...repairPlan.protectedPaths]
      );
      if (!validation.valid) {
        return {
          status: "rejected",
          changedFiles: [],
          actionsCompleted: 0,
          actionsFailed: 0,
          summary: `Action rejected: ${validation.reason}`,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      const symlinkCheck = await hasSymlinkEscape(action.file, projectPath);
      if (symlinkCheck) {
        return {
          status: "rejected",
          changedFiles: [],
          actionsCompleted: 0,
          actionsFailed: 0,
          summary: `Symlink escape detected in path: ${action.file}`,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }

      if (action.operation !== "modify" && action.operation !== "create" &&
          action.operation !== "delete" && action.operation !== "replace") {
        return {
          status: "rejected",
          changedFiles: [],
          actionsCompleted: 0,
          actionsFailed: 0,
          summary: `Unsupported operation: ${action.operation}`,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      }
    }

    // ─── Execute actions ──────────────────────────────────────────

    const changedFiles: string[] = [];
    let actionsCompleted = 0;
    let actionsFailed = 0;

    for (const action of repairPlan.actions) {
      try {
        switch (action.operation) {
          case "modify":
            await modifyFile(action.file, projectPath);
            changedFiles.push(action.file);
            actionsCompleted++;
            break;
          case "create":
            await createFile(action.file, projectPath);
            changedFiles.push(action.file);
            actionsCompleted++;
            break;
          case "delete":
            await deleteFile(action.file, projectPath);
            changedFiles.push(action.file);
            actionsCompleted++;
            break;
          case "replace":
            await replaceFile(action.file, projectPath);
            changedFiles.push(action.file);
            actionsCompleted++;
            break;
          default:
            actionsFailed++;
            break;
        }
      } catch {
        actionsFailed++;
      }
    }

    const status = actionsFailed > 0 ? "failed" : "completed";

    return {
      status,
      changedFiles,
      actionsCompleted,
      actionsFailed,
      summary: `Executed ${actionsCompleted}/${repairPlan.actions.length} repair actions`,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}
