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
  projectPath: string,
  action: RepairAction
): Promise<{ beforeContent: string; afterContent: string }> {
  const fullPath = path.resolve(projectPath, filePath);

  const beforeContent = await fs.readFile(fullPath, "utf8");
  
  // We handle possible extended fields that would match the specification
  // Check if this is a "replace_text" operation
  const extendedAction = action as RepairAction & { find?: string; replace?: string; multiple?: boolean };
  if (extendedAction.find && extendedAction.replace) {
    if (!beforeContent.includes(extendedAction.find)) {
      throw new Error(`Find string "${extendedAction.find}" not found in file ${filePath}`);
    }
    
    // Perform the replacement
    const afterContent = beforeContent.replace(extendedAction.find, extendedAction.replace);
    
    // Validate that there's exactly one occurrence if action doesn't support multiple replacements
    const count = (beforeContent.match(new RegExp(extendedAction.find, "g")) || []).length;
    if (count > 1 && extendedAction.multiple !== true) {
      throw new Error(`Find string "${extendedAction.find}" appears ${count} times in file ${filePath}. Use 'multiple: true' to allow this.`);
    }
    
    // Verify the replacement worked
    if (afterContent === beforeContent) {
      throw new Error(`Replacement did not change file content for "${extendedAction.find}" in file ${filePath}`);
    }

    // Write the modified content back to file
    await fs.writeFile(fullPath, afterContent, "utf8");
    
    // Read back to verify
    const verifiedContent = await fs.readFile(fullPath, "utf8");
    if (verifiedContent !== afterContent) {
      throw new Error(`Failed to verify replacement in file ${filePath}`);
    }
    
    return { beforeContent, afterContent };
  }
  
  // Default case - return unchanged content for other operations
  return { beforeContent, afterContent: beforeContent };
}

async function createFile(
  filePath: string,
  projectPath: string,
  action: RepairAction
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

  // For the create operation, check if there's content 
  const extendedAction = action as RepairAction & { content?: string };
  if (extendedAction.content) {
    await fs.writeFile(fullPath, extendedAction.content, "utf8");
    const afterContent = await fs.readFile(fullPath, "utf8");
    return { beforeContent, afterContent };
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
  projectPath: string,
  action: RepairAction
): Promise<{ beforeContent: string; afterContent: string }> {
  const fullPath = path.resolve(projectPath, filePath);

  const beforeContent = await fs.readFile(fullPath, "utf8");
  
  // For replace operation, check for content
  const extendedAction = action as RepairAction & { content?: string };
  if (extendedAction.content) {
    await fs.writeFile(fullPath, extendedAction.content, "utf8");
    const afterContent = await fs.readFile(fullPath, "utf8");
    return { beforeContent, afterContent };
  }
  
  // Default case - return unchanged content
  return { beforeContent, afterContent: beforeContent };
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

      // Reject unsupported operations from the design spec
      if (action.operation !== "modify" && action.operation !== "create" &&
          action.operation !== "delete" && action.operation !== "replace") {
        // Check if this is a "replace_text" operation by examining extra fields in the action
        // based on the design specification: replace_text requires find/replace, etc.
        const isReplaceText = action.find !== undefined && action.replace !== undefined;
        if (!isReplaceText) {
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
    }

    // ─── Execute actions ──────────────────────────────────────────

    const changedFiles: string[] = [];
    let actionsCompleted = 0;
    let actionsFailed = 0;
    
    // For multi-file atomic operations, keep a copy of original contents
    const fileContents: { [key: string]: string } = {};
    let rollbackNeeded = false;

    for (const action of repairPlan.actions) {
      try {
        // Store the original content for potential rollback
        const origPath = path.resolve(projectPath, action.file);
        if (!fileContents[action.file]) {
          fileContents[action.file] = await fs.readFile(origPath, "utf8").catch(() => "");
        }
        
        switch (action.operation) {
          case "modify":
            // Handle replace_text operation with find/replace fields
            if (action.find && action.replace) {
              const result = await modifyFile(action.file, projectPath, action);
              if (result.beforeContent !== result.afterContent) {
                changedFiles.push(action.file);
                actionsCompleted++;
              } else {
                actionsFailed++;
              }
            } else {
              // For regular modify, just treat it as a no-op since we don't want to make changes
              changedFiles.push(action.file);
              actionsCompleted++;
            }
            break;
          case "create":
            const createResult = await createFile(action.file, projectPath, action);
            if (createResult.beforeContent !== createResult.afterContent) {
              changedFiles.push(action.file);
              actionsCompleted++;
            } else {
              actionsFailed++;
            }
            break;
          case "delete":
            const deleteResult = await deleteFile(action.file, projectPath);
            if (deleteResult.beforeContent !== deleteResult.afterContent) {
              changedFiles.push(action.file);
              actionsCompleted++;
            } else {
              actionsFailed++;
            }
            break;
          case "replace":
            const replaceResult = await replaceFile(action.file, projectPath, action);
            if (replaceResult.beforeContent !== replaceResult.afterContent) {
              changedFiles.push(action.file);
              actionsCompleted++;
            } else {
              actionsFailed++;
            }
            break;
          default:
            // Handle case where it's a replace_text operation as an extended modify
            if (action.find && action.replace && action.operation === "modify") {
              const result = await modifyFile(action.file, projectPath, action);
              if (result.beforeContent !== result.afterContent) {
                changedFiles.push(action.file);
                actionsCompleted++;
              } else {
                actionsFailed++;
              }
            } else {
              actionsFailed++;
            }
            break;
        }
      } catch (err) {
        // If an action fails, we need to rollback all previous modifications
        rollbackNeeded = true;
        actionsFailed++;
      }
    }
    
    // If any action failed, rollback all changes
    if (rollbackNeeded) {
      for (const [file, originalContent] of Object.entries(fileContents)) {
        const fullPath = path.resolve(projectPath, file);
        try {
          await fs.writeFile(fullPath, originalContent, "utf8");
        } catch (rollbackErr) {
          // Log but don't throw - we're already in error handling
        }
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
