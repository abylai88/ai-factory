import { DiagnosisRepairPlan, RepairAction } from "./mission.js";

export interface AuditViolation {
  rule: string;
  message: string;
}

export function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || filePath.startsWith("~");
}

export function hasPathTraversal(filePath: string): boolean {
  return filePath.includes("..");
}

export function isInProtectedPath(filePath: string, protectedPaths: string[]): boolean {
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

export function isProjectRelative(filePath: string): boolean {
  if (isAbsolutePath(filePath)) return false;
  if (hasPathTraversal(filePath)) return false;
  return !isInProtectedPath(filePath, ["factory", "agents", "visual-office"]);
}

export function auditAction(action: RepairAction, protectedPaths: readonly string[]): AuditViolation[] {
  const violations: AuditViolation[] = [];

  if (!action.file || action.file.trim().length === 0) {
    violations.push({ rule: "action.file.required", message: "Action must have a non-empty file path" });
  }

  if (isAbsolutePath(action.file)) {
    violations.push({ rule: "action.file.no-absolute", message: `Absolute path not allowed: ${action.file}` });
  }

  if (hasPathTraversal(action.file)) {
    violations.push({ rule: "action.file.no-traversal", message: `Path traversal not allowed: ${action.file}` });
  }

  if (isInProtectedPath(action.file, [...protectedPaths])) {
    violations.push({ rule: "action.file.no-protected", message: `Protected path not allowed: ${action.file}` });
  }

  if (!action.reason || action.reason.trim().length === 0) {
    violations.push({ rule: "action.reason.required", message: "Action must have a reason" });
  }

  if (!action.expectedOutcome || action.expectedOutcome.trim().length === 0) {
    violations.push({ rule: "action.expectedOutcome.required", message: "Action must have an expected outcome" });
  }

  return violations;
}

export function auditRepairPlan(plan: DiagnosisRepairPlan): AuditViolation[] {
  const violations: AuditViolation[] = [];

  if (!plan.missionId || plan.missionId.trim().length === 0) {
    violations.push({ rule: "plan.missionId.required", message: "RepairPlan must have a valid mission ID" });
  }

  if (!plan.allowedProjectId || plan.allowedProjectId.trim().length === 0) {
    violations.push({ rule: "plan.allowedProjectId.required", message: "RepairPlan must have a valid project ID" });
  }

  if (plan.maxAttempts < 1 || plan.maxAttempts > 10) {
    violations.push({ rule: "plan.maxAttempts.bounded", message: `maxAttempts must be between 1 and 10, got ${plan.maxAttempts}` });
  }

  if (!plan.actions || plan.actions.length === 0) {
    violations.push({ rule: "plan.actions.non-empty", message: "RepairPlan must have at least one action" });
  }

  if (!plan.verificationPlan || !plan.verificationPlan.steps || plan.verificationPlan.steps.length === 0) {
    violations.push({ rule: "plan.verificationPlan.required", message: "RepairPlan must have a verification plan with at least one step" });
  }

  if (!plan.summary || plan.summary.trim().length === 0) {
    violations.push({ rule: "plan.summary.required", message: "RepairPlan must have a summary" });
  }

  for (const action of plan.actions) {
    const actionViolations = auditAction(action, plan.protectedPaths);
    violations.push(...actionViolations);
  }

  return violations;
}

export function isRepairPlanSafe(plan: DiagnosisRepairPlan): boolean {
  return auditRepairPlan(plan).length === 0;
}
