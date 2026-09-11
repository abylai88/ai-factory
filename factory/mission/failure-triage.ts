import type { Delegation } from "./mission.js";
import type { ValidationResult } from "./validation-gate.js";
import type { MissionMemory } from "./mission-memory.js";

// ── Types ────────────────────────────────────────────────────

export type FailureCategory =
  | "syntax_error"
  | "type_error"
  | "test_failure"
  | "dependency_missing"
  | "build_config"
  | "unknown";

export type TriageAction =
  | "repair"
  | "research"
  | "qa_analysis"
  | "architect_review"
  | "retry";

export interface TriageInput {
  delegation: Delegation;
  validationResult: ValidationResult;
  attempt: number;
  maxAttempts: number;
  previousErrors: string[];
}

export interface TriageResult {
  action: TriageAction;
  targetRole: string;
  category: FailureCategory;
  reason: string;
  priority: "low" | "medium" | "high";
  maxAttempts: number;
}

// ── Classification Rules ─────────────────────────────────────

interface ClassificationRule {
  name: string;
  match: (stdout: string, stderr: string) => boolean;
  category: FailureCategory;
  action: TriageAction;
  targetRole: string;
  priority: TriageResult["priority"];
}

const RULES: ClassificationRule[] = [
  // Syntax errors — fix the code
  {
    name: "javascript_syntax_error",
    match: (out, err) =>
      /\b(SyntaxError|Unexpected token|Unexpected end of input|Unterminated string)\b/.test(out + err),
    category: "syntax_error",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  {
    name: "json_parse_error",
    match: (out, err) =>
      /\b(JSON\.parse|Unexpected token.*JSON|JSON.*parse error)\b/.test(out + err),
    category: "syntax_error",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },

  // TypeScript type errors — fix the types
  {
    name: "typescript_error",
    match: (out, err) => /\bTS2\d{3}\b/.test(out + err),
    category: "type_error",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  {
    name: "type_reference_error",
    match: (out, err) =>
      /\b(TypeError|Property .* does not exist|Argument of type|Type .* is not assignable)\b/.test(out + err),
    category: "type_error",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },

  // Test failures — route to QA for analysis
  {
    name: "test_assertion_failure",
    match: (out, err) =>
      /\b(AssertionError|expect\(|received:|Expected:|FAIL\s|Tests\s+\d+\s+failed)\b/.test(out + err),
    category: "test_failure",
    action: "qa_analysis",
    targetRole: "tester",
    priority: "medium",
  },
  {
    name: "test_runner_error",
    match: (out, err) =>
      /\b(vitest|jest|mocha|karma).*\b(fail|error|crash)\b|\b(test|spec)\s+.*\s+(fail|error)\b/i.test(out + err),
    category: "test_failure",
    action: "qa_analysis",
    targetRole: "tester",
    priority: "medium",
  },

  // Missing dependencies — research what's needed
  {
    name: "module_not_found",
    match: (out, err) =>
      /\b(Cannot find module|ERR_MODULE_NOT_FOUND|Module not found|ModuleNotFoundError)\b/.test(out + err),
    category: "dependency_missing",
    action: "research",
    targetRole: "researcher",
    priority: "high",
  },
  {
    name: "npm_install_error",
    match: (out, err) =>
      /\b(ERESOLVE|peer dep|Could not resolve|No matching version|npm ERR!|npm ERR code)\b/.test(out + err),
    category: "dependency_missing",
    action: "research",
    targetRole: "researcher",
    priority: "high",
  },

  // Build configuration issues — architect should review
  {
    name: "build_config_error",
    match: (out, err) =>
      /\b(tsconfig|webpack|vite|rollup|esbuild|babel).*(error|config|invalid|missing)\b/i.test(out + err) ||
      /\b(cannot read config|invalid option|unknown option)\b/i.test(out + err),
    category: "build_config",
    action: "architect_review",
    targetRole: "architect",
    priority: "high",
  },
];

// ── Triage Engine ────────────────────────────────────────────

/**
 * Classifies a validation failure and determines the best routing action.
 *
 * Rules are evaluated in priority order. First match wins.
 * If no rules match, returns a default "repair" action with the builder role.
 */
export function classifyFailure(input: TriageInput): TriageResult {
  const stdout = input.validationResult.stdout;
  const stderr = input.validationResult.stderr;
  const combined = stdout + "\n" + stderr;

  // Evaluate rules in order
  for (const rule of RULES) {
    if (rule.match(stdout, stderr)) {
      return {
        action: rule.action,
        targetRole: rule.targetRole,
        category: rule.category,
        reason: `Matched rule "${rule.name}": ${rule.category} → ${rule.action} via ${rule.targetRole}`,
        priority: rule.priority,
        maxAttempts: input.maxAttempts,
      };
    }
  }

  // No rules matched — default to repair with builder
  return {
    action: "repair",
    targetRole: "builder",
    category: "unknown",
    reason: `No specific pattern matched (exit code ${input.validationResult.exitCode}). Defaulting to repair.`,
    priority: "low",
    maxAttempts: Math.min(input.maxAttempts, 2),
  };
}

// ── Prompt Building ──────────────────────────────────────────

/**
 * Build a role-aware prompt for the triage result.
 * Different actions get different instructions.
 * Optionally injects mission memory context for handoff.
 */
export function buildTriagePrompt(
  delegation: Delegation,
  validationResult: ValidationResult,
  triage: TriageResult,
  attempt: number,
  maxAttempts: number,
  previousErrors?: string[],
  memory?: MissionMemory,
): string {
  const sections: string[] = [];

  // Inject mission memory context first (if available)
  if (memory) {
    const contextBlock = memory.buildContextBlock(delegation.id);
    if (contextBlock) {
      sections.push(contextBlock);
      sections.push("");
    }
  }

  // Role header
  sections.push(`You are a ${triage.targetRole} agent performing a ${triage.action} task.`);
  sections.push("");

  // Original task context
  sections.push("ORIGINAL TASK:");
  sections.push(delegation.title);
  if (delegation.description) {
    sections.push(delegation.description.slice(0, 500));
  }
  sections.push("");

  // Failure analysis
  sections.push("FAILURE ANALYSIS:");
  sections.push(`Category: ${triage.category}`);
  sections.push(`Reason: ${triage.reason}`);
  sections.push("");

  // Validation failure details
  sections.push("VALIDATION FAILURE:");
  sections.push(`Command: ${validationResult.command}`);
  sections.push(`Exit code: ${validationResult.exitCode}`);
  sections.push("");

  if (validationResult.stderr) {
    sections.push("STDERR:");
    sections.push(validationResult.stderr.slice(0, 3000));
    sections.push("");
  }

  if (validationResult.stdout) {
    sections.push("STDOUT:");
    sections.push(validationResult.stdout.slice(0, 3000));
    sections.push("");
  }

  // Previous errors
  if (previousErrors && previousErrors.length > 0) {
    sections.push(`PREVIOUS FAILED ATTEMPTS (${previousErrors.length}):`);
    for (const err of previousErrors) {
      sections.push(`- ${err.slice(0, 200)}`);
    }
    sections.push("");
  }

  // Action-specific instructions
  sections.push(`ATTEMPT: ${attempt}/${maxAttempts}`);
  sections.push("");

  switch (triage.action) {
    case "repair":
      sections.push("INSTRUCTIONS:");
      sections.push("1. Read the error output carefully.");
      sections.push("2. Identify the root cause of the failure.");
      sections.push("3. Fix the code to resolve the error.");
      sections.push("4. Run the failing command yourself to verify the fix.");
      sections.push("5. Report what you changed.");
      break;

    case "research":
      sections.push("INSTRUCTIONS:");
      sections.push("1. Analyze the missing dependency or module.");
      sections.push("2. Determine the correct package name and version.");
      sections.push("3. Check if the module exists or needs to be created.");
      sections.push("4. Provide the installation command or alternative.");
      sections.push("5. If the module is internal, identify where it should be defined.");
      break;

    case "qa_analysis":
      sections.push("INSTRUCTIONS:");
      sections.push("1. Analyze the test failure output.");
      sections.push("2. Identify whether the test is wrong or the code is wrong.");
      sections.push("3. If the code is wrong, fix the implementation.");
      sections.push("4. If the test expectation is wrong, fix the test.");
      sections.push("5. Run the failing test to verify the fix.");
      break;

    case "architect_review":
      sections.push("INSTRUCTIONS:");
      sections.push("1. Analyze the build configuration issue.");
      sections.push("2. Review the project architecture for structural problems.");
      sections.push("3. Fix configuration files (tsconfig, webpack, vite, etc.).");
      sections.push("4. Ensure module resolution and build pipeline are correct.");
      sections.push("5. Verify the build succeeds after changes.");
      break;

    case "retry":
      sections.push("INSTRUCTIONS:");
      sections.push("1. This is a retry of the previous attempt.");
      sections.push("2. Review what went wrong before trying again.");
      sections.push("3. Apply any corrections needed.");
      break;
  }

  return sections.join("\n");
}
