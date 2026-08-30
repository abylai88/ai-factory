import { randomUUID } from "node:crypto";
import {
  Diagnosis,
  DiagnosisCategory,
  DiagnosisSeverity,
  DiagnosisConfidence,
  DiagnosisInput,
  DiagnosisRepairPlan,
  RepairAction,
  VerificationPlan,
  createDiagnosis,
  createDiagnosisRepairPlan,
  PROTECTED_PATHS,
} from "./mission.js";

export interface DiagnosisRuleResult {
  category: DiagnosisCategory;
  severity: DiagnosisSeverity;
  confidence: DiagnosisConfidence;
  summary: string;
  evidence: string[];
  matched: boolean;
}

export function evaluateBuildFailure(input: DiagnosisInput): DiagnosisRuleResult {
  if (!input.buildFailed) {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  return {
    category: "build-output",
    severity: "critical",
    confidence: "high",
    summary: "Build failed. Source code must be fixed before visual repairs can be proposed.",
    evidence: [
      "Build status: failure",
      ...(input.buildError ? [`Build error: ${input.buildError}`] : []),
    ],
    matched: true,
  };
}

export function evaluateRuntimeErrors(input: DiagnosisInput): DiagnosisRuleResult {
  if (input.runtimeErrors.length === 0) {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  return {
    category: "runtime-error",
    severity: "high",
    confidence: "high",
    summary: `Runtime errors detected: ${input.runtimeErrors.length} error(s)`,
    evidence: input.runtimeErrors.map((e) => `Runtime error: ${e}`),
    matched: true,
  };
}

export function evaluateBlankCanvas(input: DiagnosisInput): DiagnosisRuleResult {
  if (input.visualQaStatus !== "failed") {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  const canvasChecks = input.failedChecks.filter(
    (c) => c.name.includes("canvas") || c.name.includes("Canvas")
  );
  if (canvasChecks.length === 0 || canvasChecks.length < input.failedChecks.length) {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  return {
    category: "blank-canvas",
    severity: "medium",
    confidence: "low",
    summary: "Canvas appears blank or uniform. Possible rendering failure or missing assets.",
    evidence: canvasChecks.map((c) => `Canvas check failed: ${c.name} (${c.viewport})${c.message ? ` — ${c.message}` : ""}`),
    matched: true,
  };
}

export function evaluateAssetLoading(input: DiagnosisInput): DiagnosisRuleResult {
  if (input.visualQaStatus !== "failed") {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  const assetErrors = input.runtimeErrors.filter(
    (e) => e.includes("404") || e.includes("asset") || e.includes("load") || e.includes("network")
  );
  if (assetErrors.length === 0) {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  return {
    category: "asset-loading",
    severity: "medium",
    confidence: "medium",
    summary: "Asset loading errors detected. Missing or unreachable resources.",
    evidence: assetErrors.map((e) => `Asset error: ${e}`),
    matched: true,
  };
}

export function evaluateVisualRegression(input: DiagnosisInput): DiagnosisRuleResult {
  if (input.visualQaStatus !== "failed") {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  if (input.runtimeErrors.length > 0) {
    return { category: "unknown", severity: "low", confidence: "low", summary: "", evidence: [], matched: false };
  }
  const failedNames = input.failedChecks.map((c) => c.name);
  return {
    category: "visual-regression",
    severity: "medium",
    confidence: "high",
    summary: `Visual QA checks failed without runtime errors. ${input.failedChecks.length} check(s) failed.`,
    evidence: failedNames.map((n) => `Failed check: ${n}`),
    matched: true,
  };
}

export function classifyDiagnosis(input: DiagnosisInput): Diagnosis {
  const rules = [
    evaluateBuildFailure,
    evaluateAssetLoading,
    evaluateRuntimeErrors,
    evaluateBlankCanvas,
    evaluateVisualRegression,
  ];

  for (const rule of rules) {
    const result = rule(input);
    if (result.matched) {
      return createDiagnosis(
        input.missionId,
        input.projectId,
        result.category,
        result.severity,
        result.confidence,
        result.summary,
        result.evidence
      );
    }
  }

  return createDiagnosis(
    input.missionId,
    input.projectId,
    "unknown",
    "low",
    "low",
    "Insufficient evidence to determine root cause. Manual investigation required.",
    ["No specific failure pattern matched the available evidence."]
  );
}

function buildActionsForCategory(input: DiagnosisInput, category: DiagnosisCategory): RepairAction[] {
  const actions: RepairAction[] = [];

  if (category === "build-output") {
    for (const file of input.affectedFiles) {
      if (file.startsWith("src/") && (file.endsWith(".ts") || file.endsWith(".js"))) {
        actions.push({
          file,
          operation: "modify",
          reason: "Build failure may originate from this source file",
          expectedOutcome: "Fix compilation or build errors in this file",
          scope: "project",
        });
      }
    }
    if (input.buildError) {
      actions.push({
        file: "package.json",
        operation: "modify",
        reason: "Build error may be related to project configuration",
        expectedOutcome: "Ensure build configuration is correct",
        scope: "project",
      });
    }
  } else if (category === "runtime-error") {
    for (const file of input.affectedFiles) {
      if (file.startsWith("src/") && (file.endsWith(".ts") || file.endsWith(".js"))) {
        actions.push({
          file,
          operation: "modify",
          reason: "Runtime error may originate from this source file",
          expectedOutcome: "Fix runtime error in this file",
          scope: "project",
        });
      }
    }
  } else if (category === "blank-canvas") {
    for (const file of input.affectedFiles) {
      if (file.startsWith("src/") && (file.endsWith(".ts") || file.endsWith(".js"))) {
        actions.push({
          file,
          operation: "modify",
          reason: "Canvas rendering may be affected by this file",
          expectedOutcome: "Ensure canvas renders correctly",
          scope: "project",
        });
      }
    }
  } else if (category === "asset-loading") {
    for (const file of input.affectedFiles) {
      if (file.startsWith("public/") || file.startsWith("assets/") || file.endsWith(".json")) {
        actions.push({
          file,
          operation: "modify",
          reason: "Asset configuration or reference may need correction",
          expectedOutcome: "Fix asset loading errors",
          scope: "project",
        });
      }
    }
  } else if (category === "visual-regression") {
    for (const file of input.affectedFiles) {
      if (file.startsWith("src/") && (file.endsWith(".ts") || file.endsWith(".js"))) {
        actions.push({
          file,
          operation: "modify",
          reason: "Visual output may be affected by this source file",
          expectedOutcome: "Fix visual regression",
          scope: "project",
        });
      }
    }
  }

  if (actions.length === 0 && input.affectedFiles.length > 0) {
    for (const file of input.affectedFiles) {
      actions.push({
        file,
        operation: "modify",
        reason: "File is affected by the diagnosed issue",
        expectedOutcome: "Resolve the diagnosed issue",
        scope: "project",
      });
    }
  }

  if (actions.length === 0) {
    actions.push({
      file: "src/main.ts",
      operation: "modify",
      reason: "No specific files identified. Main entry point as default target.",
      expectedOutcome: "Investigate and fix the root cause",
      scope: "project",
    });
  }

  return actions;
}

function buildVerificationPlan(category: DiagnosisCategory): VerificationPlan {
  if (category === "build-output") {
    return {
      steps: ["build", "audit"],
      description: "Build failed. Fix source, rebuild, then audit. Skip Visual QA until build succeeds.",
    };
  }
  return {
    steps: ["build", "visual-qa", "audit"],
    description: "Rebuild, run Visual QA, then audit to verify the fix.",
  };
}

export function generateRepairPlan(
  input: DiagnosisInput,
  diagnosis: Diagnosis,
  maxAttempts = 3
): DiagnosisRepairPlan {
  const actions = buildActionsForCategory(input, diagnosis.category);
  const verificationPlan = buildVerificationPlan(diagnosis.category);

  return createDiagnosisRepairPlan(
    input.missionId,
    diagnosis.id,
    diagnosis.summary,
    diagnosis.severity,
    diagnosis.confidence,
    actions,
    verificationPlan,
    maxAttempts,
    input.projectId
  );
}
