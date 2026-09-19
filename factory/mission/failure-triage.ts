import type { Delegation } from "./mission.js";
import type { ValidationResult } from "./validation-gate.js";
import type { MissionMemory } from "./mission-memory.js";
import { routeFailureToSpecialist, routeFailureTextToSpecialist, type SpecialistRole } from "./specialist-roles.js";

// ── Types ────────────────────────────────────────────────────

export type FailureCategory =
  | "syntax_error"
  | "type_error"
  | "test_failure"
  | "dependency_missing"
  | "build_config"
  | "roblox_structure"
  | "roblox_runtime"
  | "visual_regression"
  | "tool_unavailable"
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
  /** Owning specialist (precise routing; never generic "send to programmer"). */
  specialist?: SpecialistRole;
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
  // Wedged Playtest session — Studio refuses to start a new playtest because a
  // previous session/transition is still active. Infrastructure, NEVER a code
  // bug and NEVER a repair loop. Must stay ahead of the generic
  // `roblox_toolchain:` rule below.
  {
    name: "playtest_session_wedged",
    match: (out, err) => {
      const combined = out + err;
      return (
        /playtest session wedged/i.test(combined) ||
        /already (running|in progress|active).*playtest/i.test(combined) ||
        /finish its current playtest|StopPlayMonitor|playtest.*transition/i.test(combined)
      );
    },
    category: "tool_unavailable",
    action: "research",
    targetRole: "researcher",
    priority: "high",
  },
  // Missing Studio bridge / toolchain — infrastructure, NEVER a code bug
  // and NEVER an architect cascade. Must stay ahead of generic rules.
  {
    name: "studio_toolchain_unavailable",
    match: (out, err) => {
      const combined = out + err;
      return (
        /studio (not connected|unavailable|disconnected|connection refused)/i.test(combined) ||
        /tool_unavailable|TOOL_UNAVAILABLE/i.test(combined) ||
        /BLOCKED \(infrastructure\)/i.test(combined) ||
        /screenshot unavailable/i.test(combined)
      );
    },
    category: "tool_unavailable",
    action: "research",
    targetRole: "researcher",
    priority: "high",
  },
  // Missing Rojo toolchain — infrastructure, NEVER a code bug and NEVER an
  // architect cascade. Must stay ahead of the generic module_not_found rule.
  {
    name: "rojo_toolchain_missing",
    match: (out, err) => {
      const combined = out + err;
      return (
        /roblox_toolchain:/i.test(combined) ||
        /\brojo\b.*(not found|command not found|missing|no such file|ENOENT)/i.test(combined) ||
        /(not found|command not found|no such file).*?\brojo\b/i.test(combined)
      );
    },
    category: "dependency_missing",
    action: "research",
    targetRole: "researcher",
    priority: "high",
  },
  // Roblox provisioning/readiness failures — explicit codes from the
  // place-artifact + project-ready path. Infrastructure, NEVER a code bug
  // and NEVER an architect cascade. Must stay ahead of generic rules.
  {
    name: "roblox_provisioning_unavailable",
    match: (out, err) => {
      const combined = out + err;
      return (
        /ROJO_UNAVAILABLE|STUDIO_UNAVAILABLE|MCP_UNAVAILABLE|PROJECT_LOAD_TIMEOUT|PROJECT_NOT_READY/i.test(combined)
      );
    },
    category: "tool_unavailable",
    action: "research",
    targetRole: "researcher",
    priority: "high",
  },
  {
    name: "roblox_place_build_failed",
    match: (out, err) => /ROJO_BUILD_FAILED/i.test(out + err),
    category: "build_config",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  {
    name: "roblox_artifact_missing",
    match: (out, err) => /ROBLOX_ARTIFACT_MISSING/i.test(out + err),
    category: "roblox_structure",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  // Roblox runtime failures (void fall, missing spawn/floor, playtest
  // assertion failures) — repair via visual/gameplay-capable builder, NEVER
  // the architect. Must stay ahead of generic test-failure rules so the
  // repair prompt keeps its Roblox visual routing.
  {
    name: "roblox_runtime_error",
    match: (out, err) => {
      const combined = out + err;
      return (
        /roblox_runtime/i.test(combined) ||
        /runtime QA FAIL/i.test(combined) ||
        /fall(ing)? into (the )?void|no floor beneath|player.*fall/i.test(combined) ||
        /spawn.*(missing|undefined)|missing.*spawn/i.test(combined) ||
        /failed assertions?:.*(player|spawn|character|floor)/i.test(combined) ||
        /visual\/gameplay repair/i.test(combined)
      );
    },
    category: "roblox_runtime",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  // Visual QA screenshot/evaluation failures — QA analysis first.
  {
    name: "visual_qa_failure",
    match: (out, err) => {
      const combined = out + err;
      return (
        /screenshot|viewport|visual QA|visual-qa|floor-visible|VISUAL_FAIL/i.test(combined) &&
        /FAIL/i.test(combined)
      );
    },
    category: "visual_regression",
    action: "qa_analysis",
    targetRole: "tester",
    priority: "medium",
  },
  // Scene-edit protected-target refusals — policy violation, NOT infra and
  // never a code bug. Repair must respect the protected roots and retry.
  {
    name: "scene_protected_target",
    match: (out, err) => {
      const combined = out + err;
      return (
        /protected scene root/i.test(combined) ||
        /scene editing under Players is not allowed/i.test(combined) ||
        /scene\.destroy requires confirm:true/i.test(combined) ||
        /refuses script instances/i.test(combined)
      );
    },
    category: "roblox_structure",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  // Failed scene mutation (validation error, missing target, or read-back
  // could not confirm the change) — repair the scene edit, keeping evidence.
  {
    name: "scene_edit_failure",
    match: (out, err) => {
      const combined = out + err;
      return (
        /scene (create|clone|set|move|rename|destroy|plan) (FAIL|failed|executed but)/i.test(combined) ||
        /read-back could not confirm/i.test(combined) ||
        /scene target not found/i.test(combined) ||
        /scene path/i.test(combined) &&
          /FAIL|invalid/i.test(combined)
      );
    },
    category: "roblox_structure",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  // A scene edit that regressed visual QA or runtime QA after the change.
  {
    name: "scene_post_edit_regression",
    match: (out, err) => {
      const combined = out + err;
      return (
        /post-scene (runtime|visual) regression/i.test(combined) ||
        /runtime QA FAIL.*scene/i.test(combined) ||
        /VISUAL_FAIL.*scene|scene.*VISUAL_FAIL/i.test(combined)
      );
    },
    category: "roblox_runtime",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  // Malformed Rojo project / Roblox structure errors — repair the project.
  {
    name: "roblox_structure_error",
    match: (out, err) => {
      const combined = out + err;
      return (
        /default\.project\.json/i.test(combined) ||
        /malformed rojo/i.test(combined) ||
        /rojo build failed/i.test(combined) ||
        /roblox.*(structur|mapping|server\/client)/i.test(combined) ||
        /server-authoritative boundary/i.test(combined) ||
        /looks like browser\/TypeScript code/i.test(combined)
      );
    },
    category: "roblox_structure",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
  // Luau syntax errors — fix the code.
  {
    name: "luau_syntax_error",
    match: (out, err) =>
      /\bluau\b.*(syntax|parse error|unexpected)/i.test(out + err) ||
      /unbalanced blocks.*missing "end"/i.test(out + err) ||
      /unexpected symbol near/i.test(out + err),
    category: "syntax_error",
    action: "repair",
    targetRole: "builder",
    priority: "high",
  },
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

  // Missing dependencies — research what's needed.
  // NOTE: shell "binary not found" output (e.g. `sh: 1: webpack: not found`)
  // means node_modules was never installed — a dependency bootstrap problem,
  // NOT a build-config problem. It must stay in this category so it is never
  // routed to an expensive architect review.
  {
    name: "module_not_found",
    match: (out, err) => {
      const combined = out + err;
      if (
        /\b(Cannot find module|ERR_MODULE_NOT_FOUND|Module not found|ModuleNotFoundError)\b/.test(
          combined
        )
      ) {
        return true;
      }
      if (/sh:\s*\d*\s*:?\s*[\w-]+:\s*not found/i.test(combined)) {
        return true;
      }
      if (
        /\b(webpack|webpack-cli|tsc|typescript)\s*:\s*(not found|command not found)\b/i.test(
          combined
        )
      ) {
        return true;
      }
      if (/\bcommand not found\b/i.test(combined)) {
        return true;
      }
      return false;
    },
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
      const textRouted = routeFailureTextToSpecialist(combined);
      return {
        action: rule.action,
        targetRole: rule.targetRole,
        specialist: textRouted ?? routeFailureToSpecialist(rule.category),
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
    specialist: routeFailureTextToSpecialist(combined) ?? "programmer",
    category: "unknown",
    reason: `No specific pattern matched (exit code ${input.validationResult.exitCode}). Defaulting to repair.`,
    priority: "low",
    maxAttempts: Math.min(input.maxAttempts, 2),
  };
}

// ── Platform helper ────────────────────────────────────────────

/** True when the failing validation command belongs to the Roblox path. */
function isRobloxValidationCommand(command: string): boolean {
  const c = (command ?? "").toLowerCase();
  return c.includes("rojo") || c.includes("roblox-validate") || c.includes("roblox");
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
  const specialist = triage.specialist ?? routeFailureToSpecialist(triage.category);
  sections.push(`You are a ${triage.targetRole} agent performing a ${triage.action} task (owning specialist: ${specialist}).`);
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

  // Platform guard: Roblox validation failures must be repaired as Luau/Rojo.
  if (isRobloxValidationCommand(validationResult.command) || triage.category === "roblox_runtime") {
    sections.push("PLATFORM CONTEXT: Roblox (Luau + Rojo).");
    sections.push("Repair ONLY this Roblox project: edit Luau sources under src/, keep");
    sections.push("server-authoritative logic on the server, respect server/client boundaries,");
    sections.push("and validate with the Rojo project structure. Do NOT run npm/webpack/tsc and");
    sections.push("do NOT introduce package.json or browser code. A missing Rojo binary or");
    sections.push("missing Studio connection is infrastructure (roblox_toolchain) — report it");
    sections.push("as blocked, do not rewrite game code for it.");
    sections.push("");
  }
  if (triage.category === "roblox_runtime") {
    sections.push("RUNTIME FAILURE CONTEXT (roblox_runtime): the Rojo build passed but the");
    sections.push("live experience is broken (e.g. no floor under spawn, player falls into");
    sections.push("void, missing SpawnLocation). Prefer the visual/gameplay route: add or fix");
    sections.push("Workspace floor/BasePlate + SpawnLocation + collectible placement first,");
    sections.push("then re-run runtime QA. Do NOT escalate to the Architect for spawn/floor");
    sections.push("failures — attach the screenshot reference and runtime state to your report.");
    sections.push("");
  }
  if (triage.category === "tool_unavailable") {
    sections.push("INFRASTRUCTURE CONTEXT (tool_unavailable): the toolchain (Studio bridge,");
    sections.push("Rojo binary, screenshot path) is unreachable. Document the exact missing");
    sections.push("component and the manual setup step. Do NOT rewrite game code for this.");
    sections.push("");
  }
  if (triage.category === "roblox_structure" && /scene/i.test(triage.reason)) {
    sections.push("SCENE EDIT CONTEXT: a scene mutation was refused or could not be");
    sections.push("verified. Read the before/after evidence in the error output, respect the");
    sections.push("protected roots (Workspace/Players/ReplicatedStorage/ServerScriptService/");
    sections.push("ServerStorage/StarterGui/StarterPlayer/Lighting/SoundService/Terrain), never");
    sections.push("edit under the Players subtree, never touch scripts via scene tools, and");
    sections.push("re-run read-back (scene.inspect / scene.plan) before mutating again.");
    sections.push("");
  }

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
