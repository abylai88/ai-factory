import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Mission,
  Delegation,
  AgentResult,
  AuditResult,
  ExecutionPlan,
  CodingOperation,
  BuildResult,
  CodingResult,
  DelegationMetadata,
  createAuditResult,
  AcceptanceCriteriaResult,
} from "./mission.js";
import { FactoryExecutionAdapter, Auditor } from "./orchestrator.js";

const execFileAsync = promisify(execFile);

// ─── Constants ──────────────────────────────────────────────────────

const PROTECTED_PATHS = [
  "factory/",
  "agents/",
  "visual-office/",
  "node_modules/",
  ".git/",
];

const DANGEROUS_PATH_PATTERNS = [
  /\.\./,
  /^[/\\]/,
  /^[A-Z]:\\/i,
  /[`$|;&(){}]/,
  /[\n\r]/,
  /<|>/,
  /!/,
];

// ─── Path Safety ────────────────────────────────────────────────────

function validateFilePath(filePath: string, projectRoot: string): { valid: boolean; reason?: string } {
  if (/\.\./.test(filePath)) {
    return { valid: false, reason: `Path traversal detected: ${filePath}` };
  }

  if (/^[A-Z]:\\/i.test(filePath) || /[`$|;&(){}]/.test(filePath) || /[\n\r]/.test(filePath) || /<|>/.test(filePath) || /!/.test(filePath)) {
    return { valid: false, reason: `Dangerous characters in path: ${filePath}` };
  }

  const resolved = path.resolve(projectRoot, filePath);
  if (!resolved.startsWith(path.resolve(projectRoot) + path.sep) && resolved !== path.resolve(projectRoot)) {
    return { valid: false, reason: `Path escapes project root: ${filePath}` };
  }

  if (isProtectedRelativePath(filePath)) {
    return { valid: false, reason: `Path is in protected directory: ${filePath}` };
  }

  return { valid: true };
}

function isProtectedRelativePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  for (const protectedPath of PROTECTED_PATHS) {
    if (normalized.startsWith(protectedPath) || normalized.includes("/" + protectedPath)) {
      return true;
    }
  }
  return false;
}

function validateProjectRoot(projectRoot: string): { valid: boolean; reason?: string } {
  const resolved = path.resolve(projectRoot);

  if (/[`$|;&(){}]/.test(projectRoot) || /[\n\r]/.test(projectRoot) || /<|>/.test(projectRoot) || /!/.test(projectRoot)) {
    return { valid: false, reason: `Dangerous characters in project root: ${projectRoot}` };
  }

  if (/\.\./.test(projectRoot)) {
    return { valid: false, reason: `Path traversal in project root: ${projectRoot}` };
  }

  const protectedRoots = [
    path.resolve("factory"),
    path.resolve("agents"),
    path.resolve("visual-office"),
    path.resolve("node_modules"),
  ];

  for (const protectedRoot of protectedRoots) {
    if (resolved === protectedRoot || resolved.startsWith(protectedRoot + path.sep)) {
      return { valid: false, reason: `Project root is a protected directory` };
    }
  }

  return { valid: true };
}

// ─── Controlled Coding Adapter ──────────────────────────────────────

export class ControlledCodingAdapter implements FactoryExecutionAdapter {
  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const metadata = extractMetadata(delegation);

    if (!metadata.codingOperation) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: "No coding operation specified in delegation metadata",
        durationMs: Date.now() - startTime,
      };
    }

    const projectRoot = path.resolve(config.project);
    const rootCheck = validateProjectRoot(projectRoot);
    if (!rootCheck.valid) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: rootCheck.reason,
        durationMs: Date.now() - startTime,
      };
    }

    const op = metadata.codingOperation;
    const fileCheck = validateFilePath(op.file, projectRoot);
    if (!fileCheck.valid) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: fileCheck.reason,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      if (op.operation === "read") {
        const result = await this.handleRead(op, projectRoot);
        return {
          delegationId: delegation.id,
          status: "passed",
          output: JSON.stringify(result),
          durationMs: Date.now() - startTime,
        };
      }

      if (op.operation === "replace") {
        const result = await this.handleReplace(op, projectRoot);
        return {
          delegationId: delegation.id,
          status: "passed",
          output: JSON.stringify(result),
          durationMs: Date.now() - startTime,
        };
      }

      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: `Unknown operation: ${op.operation}`,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async handleRead(op: CodingOperation, projectRoot: string): Promise<CodingResult> {
    const filePath = path.resolve(projectRoot, op.file);
    const content = await fs.readFile(filePath, "utf8");

    return {
      projectId: op.projectId,
      file: op.file,
      operation: "read",
      beforeContent: content,
      afterContent: content,
    };
  }

  private async handleReplace(op: CodingOperation, projectRoot: string): Promise<CodingResult> {
    if (!op.oldString || op.newString === undefined) {
      throw new Error("Replace operation requires oldString and newString");
    }

    const filePath = path.resolve(projectRoot, op.file);
    const beforeContent = await fs.readFile(filePath, "utf8");

    if (!beforeContent.includes(op.oldString)) {
      throw new Error(`oldString not found in ${op.file}`);
    }

    const afterContent = beforeContent.replace(op.oldString, op.newString);
    await fs.writeFile(filePath, afterContent, "utf8");

    return {
      projectId: op.projectId,
      file: op.file,
      operation: "replace",
      beforeContent,
      afterContent,
      fieldChanged: op.field,
      oldValue: op.oldString,
      newValue: op.newString,
    };
  }
}

// ─── Controlled Build Adapter ───────────────────────────────────────

export class ControlledBuildAdapter implements FactoryExecutionAdapter {
  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const metadata = extractMetadata(delegation);

    if (!metadata.buildCommand) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: "No build command specified in delegation metadata",
        durationMs: Date.now() - startTime,
      };
    }

    const projectRoot = path.resolve(config.project);
    const rootCheck = validateProjectRoot(projectRoot);
    if (!rootCheck.valid) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: rootCheck.reason,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const buildResult = await this.executeBuild(metadata.buildCommand, projectRoot);

      const output = JSON.stringify(buildResult);

      if (buildResult.status === "failure") {
        return {
          delegationId: delegation.id,
          status: "failed",
          output,
          error: `Build failed with exit code ${buildResult.exitCode}: ${buildResult.stderr.slice(0, 500)}`,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        delegationId: delegation.id,
        status: "passed",
        output,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async executeBuild(command: string, cwd: string): Promise<BuildResult> {
    const startTime = Date.now();

    try {
      const parts = command.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);

      const result = await execFileAsync(cmd, args, {
        cwd,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      });

      return {
        command,
        status: "success",
        exitCode: 0,
        stdout: result.stdout?.slice(0, 2000) ?? "",
        stderr: result.stderr?.slice(0, 2000) ?? "",
        durationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      const execError = error as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        command,
        status: "failure",
        exitCode: execError.code ?? 1,
        stdout: (execError.stdout ?? "").slice(0, 2000),
        stderr: (execError.stderr ?? execError.message ?? "").slice(0, 2000),
        durationMs: Date.now() - startTime,
      };
    }
  }
}

// ─── Composite Coding + Build Adapter ───────────────────────────────

export class CompositeCodingBuildAdapter implements FactoryExecutionAdapter {
  private readonly codingAdapter = new ControlledCodingAdapter();
  private readonly buildAdapter = new ControlledBuildAdapter();

  async runDelegation(
    delegation: Delegation,
    mission: Mission,
    config: { baseDir: string; project: string; fromStep?: string }
  ): Promise<AgentResult> {
    const metadata = extractMetadata(delegation);

    if (metadata.role === "builder" || metadata.buildCommand) {
      return this.buildAdapter.runDelegation(delegation, mission, config);
    }

    return this.codingAdapter.runDelegation(delegation, mission, config);
  }
}

// ─── Coding Mission Auditor ─────────────────────────────────────────

export class CodingMissionAuditor implements Auditor {
  async audit(
    delegation: Delegation,
    result: AgentResult,
    mission: Mission,
    plan: ExecutionPlan
  ): Promise<AuditResult> {
    if (result.status === "failed") {
      return createAuditResult(
        delegation.id,
        "FAIL",
        `Delegation "${delegation.title}" failed: ${result.error ?? "Unknown error"}`,
        [`Execution failed: ${result.error}`],
        delegation.acceptanceCriteria.map((c) => ({
          criterion: c,
          passed: false,
          evidence: result.error,
        })),
        {
          description: `Fix the failure in ${delegation.title}`,
          focusAreas: ["Error resolution", "Verify fix"],
        }
      );
    }

    const findings: string[] = [];
    const acceptanceResults: AcceptanceCriteriaResult[] = [];

    for (const criterion of delegation.acceptanceCriteria) {
      const evaluation = this.evaluateCriterion(criterion, result, delegation, mission);
      acceptanceResults.push({
        criterion,
        passed: evaluation.passed,
        evidence: evaluation.evidence,
      });
      if (!evaluation.passed) {
        findings.push(`Acceptance criterion not met: ${criterion}`);
      }
    }

    const allPassed = acceptanceResults.every((r) => r.passed);

    if (allPassed) {
      return createAuditResult(
        delegation.id,
        "PASS",
        `Delegation "${delegation.title}" passed all acceptance criteria`,
        ["All criteria satisfied"],
        acceptanceResults
      );
    }

    return createAuditResult(
      delegation.id,
      "FAIL",
      `Delegation "${delegation.title}" failed ${findings.length} acceptance criteria`,
      findings,
      acceptanceResults,
      {
        description: `Address failing acceptance criteria for ${delegation.title}`,
        focusAreas: findings.map((f) => f.replace("Acceptance criterion not met: ", "")),
      }
    );
  }

  private evaluateCriterion(
    criterion: string,
    result: AgentResult,
    delegation: Delegation,
    mission: Mission
  ): { passed: boolean; evidence: string } {
    const lower = criterion.toLowerCase();

    if (lower.includes("intended file changed") || lower.includes("file changed")) {
      return this.evaluateFileChanged(result, delegation);
    }
    if (lower.includes("only intended change") || lower.includes("only intended")) {
      return this.evaluateOnlyIntendedChange(result, delegation);
    }
    if (lower.includes("build succeeded") || lower.includes("build success")) {
      return this.evaluateBuildSucceeded(result);
    }
    if (lower.includes("project remains") || lower.includes("structurally valid")) {
      return this.evaluateStructurallyValid(result);
    }
    if (lower.includes("no protected file") || lower.includes("protected file")) {
      return this.evaluateNoProtectedFiles(result, mission);
    }
    if (lower.includes("mission objective") || lower.includes("objective satisfied")) {
      return this.evaluateMissionObjective(result, delegation, mission);
    }
    if (lower.includes("visual qa passed") || lower.includes("visual qa completed")) {
      return this.evaluateVisualQaPassed(mission);
    }
    if (lower.includes("codebase analyzed")) {
      return this.evaluateGenericKeyword(criterion, result, ["analyzed", "analysis", "inspected", "reviewed"]);
    }
    if (lower.includes("architecture documented")) {
      return this.evaluateGenericKeyword(criterion, result, ["architecture", "design", "structure"]);
    }
    if (lower.includes("key components identified")) {
      return this.evaluateGenericKeyword(criterion, result, ["component", "module", "identified"]);
    }
    if (lower.includes("no files modified")) {
      return this.evaluateNoFilesModified(result);
    }

    return this.evaluateGenericKeyword(criterion, result, criterion.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  }

  private evaluateFileChanged(result: AgentResult, delegation: Delegation): { passed: boolean; evidence: string } {
    try {
      const parsed = JSON.parse(result.output);
      if (parsed.operation === "replace" && parsed.afterContent !== parsed.beforeContent) {
        return { passed: true, evidence: `File ${parsed.file} was modified` };
      }
      if (parsed.operation === "read") {
        return { passed: true, evidence: `File ${parsed.file} was read successfully` };
      }
      return { passed: false, evidence: "File content did not change" };
    } catch {
      return { passed: false, evidence: "Could not parse coding result from output" };
    }
  }

  private evaluateOnlyIntendedChange(result: AgentResult, delegation: Delegation): { passed: boolean; evidence: string } {
    try {
      const parsed = JSON.parse(result.output);
      if (parsed.operation !== "replace") {
        return { passed: true, evidence: "No replacement operation performed" };
      }

      const before = parsed.beforeContent;
      const after = parsed.afterContent;
      if (before === after) {
        return { passed: true, evidence: "No changes made" };
      }

      const beforeLines = before.split("\n");
      const afterLines = after.split("\n");

      if (beforeLines.length !== afterLines.length) {
        return { passed: false, evidence: "Line count changed - unexpected structural modification" };
      }

      let changedLines = 0;
      for (let i = 0; i < beforeLines.length; i++) {
        if (beforeLines[i] !== afterLines[i]) {
          changedLines++;
        }
      }

      if (changedLines <= 3) {
        return { passed: true, evidence: `${changedLines} line(s) changed - within expected scope` };
      }

      return { passed: false, evidence: `${changedLines} lines changed - exceeds expected single-field change` };
    } catch {
      return { passed: false, evidence: "Could not parse coding result" };
    }
  }

  private evaluateBuildSucceeded(result: AgentResult): { passed: boolean; evidence: string } {
    try {
      const parsed = JSON.parse(result.output);
      if (parsed.status === "success") {
        return { passed: true, evidence: `Build succeeded in ${parsed.durationMs}ms` };
      }
      return { passed: false, evidence: `Build failed with exit code ${parsed.exitCode}` };
    } catch {
      if (result.status === "passed") {
        return { passed: true, evidence: "Build delegation passed" };
      }
      return { passed: false, evidence: "Could not parse build result" };
    }
  }

  private evaluateStructurallyValid(result: AgentResult): { passed: boolean; evidence: string } {
    try {
      const parsed = JSON.parse(result.output);
      if (parsed.afterContent) {
        try {
          JSON.parse(parsed.afterContent);
          return { passed: true, evidence: "Modified file is valid JSON" };
        } catch {
          return { passed: true, evidence: "Modified file content is syntactically valid" };
        }
      }
      return { passed: true, evidence: "No structural changes detected" };
    } catch {
      return { passed: true, evidence: "Project structure appears valid" };
    }
  }

  private evaluateNoProtectedFiles(result: AgentResult, mission: Mission): { passed: boolean; evidence: string } {
    try {
      const parsed = JSON.parse(result.output);
      const changedFile = parsed.file ?? "";
      for (const protectedPath of PROTECTED_PATHS) {
        if (changedFile.startsWith(protectedPath) || changedFile.includes(protectedPath)) {
          return { passed: false, evidence: `Protected file modified: ${changedFile}` };
        }
      }
      return { passed: true, evidence: `No protected files modified (${changedFile})` };
    } catch {
      return { passed: true, evidence: "No protected file modification detected" };
    }
  }

  private evaluateMissionObjective(result: AgentResult, delegation: Delegation, mission: Mission): { passed: boolean; evidence: string } {
    const goal = mission.goal.toLowerCase();
    if (goal.includes("package") && goal.includes("name")) {
      try {
        const parsed = JSON.parse(result.output);
        if (parsed.fieldChanged === "name" || parsed.operation === "replace") {
          return { passed: true, evidence: `Package name change applied: ${parsed.newValue}` };
        }
      } catch {
        // fall through
      }
    }

    if (result.status === "passed") {
      return { passed: true, evidence: "Mission objective appears satisfied" };
    }
    return { passed: false, evidence: "Mission objective status unclear" };
  }

  private evaluateVisualQaPassed(mission: Mission): { passed: boolean; evidence: string } {
    if (!mission.context?.requiresVisualQa) {
      return { passed: true, evidence: "Visual QA not required for this mission" };
    }

    const evidence = mission.visualQaEvidence;
    const qa = mission.visualQa;

    if (!evidence && !qa) {
      return { passed: false, evidence: "Visual QA result not available" };
    }

    if (evidence) {
      if (evidence.status === "skipped") {
        return { passed: false, evidence: "Visual QA was skipped because build failed or no adapter configured" };
      }
      if (evidence.status === "failed") {
        const parts: string[] = [];
        if (evidence.failedChecks > 0) parts.push(`${evidence.failedChecks} checks failed`);
        if (evidence.errorCount > 0) parts.push(`completed with ${evidence.errorCount} runtime errors`);
        if (parts.length === 0) parts.push("status was failed");
        return { passed: false, evidence: `Visual QA failed: ${parts.join(" and ")}` };
      }
      if (evidence.failedChecks > 0) {
        return { passed: false, evidence: `Visual QA passed with ${evidence.failedChecks} failed checks` };
      }
      if (evidence.errorCount > 0) {
        return { passed: false, evidence: "Visual QA completed with runtime errors" };
      }
      return { passed: true, evidence: "Visual QA passed with 0 failed checks" };
    }

    if (qa!.status === "skipped") {
      return { passed: false, evidence: "Visual QA was skipped because build failed or no adapter configured" };
    }
    if (!qa!.passed) {
      return { passed: false, evidence: `Visual QA failed: ${qa!.failedChecks} checks failed` };
    }
    if (qa!.failedChecks > 0) {
      return { passed: false, evidence: `Visual QA passed with ${qa!.failedChecks} failed checks` };
    }
    if (qa!.errors.length > 0) {
      return { passed: false, evidence: "Visual QA completed with runtime errors" };
    }
    return { passed: true, evidence: "Visual QA passed with 0 failed checks" };
  }

  private evaluateGenericKeyword(criterion: string, result: AgentResult, keywords: string[]): { passed: boolean; evidence: string } {
    const lower = result.output.toLowerCase();
    const matched = keywords.filter((k) => lower.includes(k));
    if (matched.length > 0) {
      return { passed: true, evidence: `Keywords matched: ${matched.join(", ")}` };
    }
    return { passed: false, evidence: "No criterion keywords found in output" };
  }

  private evaluateNoFilesModified(result: AgentResult): { passed: boolean; evidence: string } {
    if (result.readOnly === true) {
      return { passed: true, evidence: "Execution metadata confirms read-only adapter" };
    }
    try {
      const parsed = JSON.parse(result.output);
      if (parsed.operation === "read") {
        return { passed: true, evidence: "Read-only operation performed" };
      }
      return { passed: false, evidence: "Write operation detected" };
    } catch {
      return { passed: true, evidence: "No write evidence in output" };
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function extractMetadata(delegation: Delegation): DelegationMetadata {
  const desc = delegation.description;
  const lines = desc.split("\n");

  const metadata: DelegationMetadata = {};

  for (const line of lines) {
    const roleMatch = line.match(/^\s*ROLE:\s*(coder|builder|researcher|auditor)\s*$/i);
    if (roleMatch) {
      metadata.role = roleMatch[1].toLowerCase() as DelegationMetadata["role"];
    }

    const fileMatch = line.match(/^\s*FILE:\s*(.+?)\s*$/i);
    if (fileMatch) {
      if (!metadata.codingOperation) {
        metadata.codingOperation = {
          projectId: delegation.missionId,
          file: fileMatch[1].trim(),
          operation: "read",
        };
      } else {
        metadata.codingOperation.file = fileMatch[1].trim();
      }
    }

    const opMatch = line.match(/^\s*OPERATION:\s*(.+?)\s*$/i);
    if (opMatch && metadata.codingOperation) {
      metadata.codingOperation.operation = opMatch[1].trim() as CodingOperation["operation"];
    }

    const fieldMatch = line.match(/^\s*FIELD:\s*(.+?)\s*$/i);
    if (fieldMatch && metadata.codingOperation) {
      metadata.codingOperation.field = fieldMatch[1].trim();
    }

    const oldValueMatch = line.match(/^\s*OLD_VALUE:\s*(.+?)\s*$/i);
    if (oldValueMatch && metadata.codingOperation) {
      metadata.codingOperation.oldString = oldValueMatch[1].trim();
    }

    const valueMatch = line.match(/^\s*VALUE:\s*(.+?)\s*$/i);
    if (valueMatch && metadata.codingOperation) {
      metadata.codingOperation.newString = valueMatch[1].trim();
      metadata.codingOperation.value = valueMatch[1].trim();
    }

    const buildMatch = line.match(/^\s*BUILD_COMMAND:\s*(.+?)\s*$/i);
    if (buildMatch) {
      metadata.buildCommand = buildMatch[1].trim();
      if (!metadata.role) metadata.role = "builder";
    }
  }

  return metadata;
}

export { extractMetadata, validateFilePath, validateProjectRoot, PROTECTED_PATHS };
