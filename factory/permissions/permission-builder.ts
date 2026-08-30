import { PermissionProfile, SECURITY_DENIALS } from "./permission-profiles.js";

/**
 * Generate the YAML frontmatter permission block for an OpenCode agent .md file.
 *
 * OpenCode expects bash permissions as a map of pattern → action.
 * The catch-all `"*"` must come LAST and should be "ask" (never "allow").
 */
export function buildPermissionYaml(profile: PermissionProfile): string {
  const lines: string[] = [];

  // edit
  lines.push(`  edit: ${profile.edit}`);

  // bash
  lines.push("  bash:");
  for (const bp of profile.bash) {
    const escaped = bp.pattern.includes(":") || bp.pattern.includes("#")
      ? `"${bp.pattern}"`
      : bp.pattern;
    lines.push(`    "${escaped}": ${bp.action}`);
  }

  // todowrite
  lines.push(`  todowrite: ${profile.todowrite}`);

  return lines.join("\n");
}

/**
 * Inject a permission block into an existing agent .md file content.
 * Replaces the YAML frontmatter permission section.
 */
export function injectPermissionIntoAgentMd(
  agentMdContent: string,
  profile: PermissionProfile
): string {
  const permYaml = buildPermissionYaml(profile);

  // Match everything between --- delimiters (YAML frontmatter)
  const fmMatch = agentMdContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return agentMdContent;
  }

  const fm = fmMatch[1];
  const body = agentMdContent.slice(fmMatch[0].length);

  // Remove old permission block (permission: + all indented lines until next non-indented or end)
  let cleaned = fm.replace(/^\s*permission:\n(?:[ \t]+.+\n)*/m, "");

  // Also remove any orphaned edit/todowrite at top level that came from a bad prior injection
  cleaned = cleaned.replace(/^\s*(?:edit|todowrite):\s+\w+\n/gm, "");

  // Insert new permission block at the end of frontmatter
  cleaned = cleaned.trimEnd() + "\n" + permYaml + "\n";

  return `---\n${cleaned}\n---${body}`;
}

/**
 * Validate a permission profile:
 * - catch-all "*" must be "ask" (never "allow")
 * - dangerous patterns must be "deny"
 * - returns list of issues (empty = valid)
 */
export function validateProfile(
  name: string,
  profile: PermissionProfile
): string[] {
  const issues: string[] = [];

  if (profile.edit !== "allow" && profile.edit !== "deny") {
    issues.push(`${name}: edit must be "allow" or "deny", got "${profile.edit}"`);
  }

  if (profile.todowrite !== "allow" && profile.todowrite !== "deny") {
    issues.push(`${name}: todowrite must be "allow" or "deny", got "${profile.todowrite}"`);
  }

  const catchAll = profile.bash.find((b) => b.pattern === "*");
  if (catchAll?.action === "allow") {
    issues.push(`${name}: catch-all "*": allow is forbidden — use "ask"`);
  }

  const dangerous = ["rm -rf*", "sudo*", "npm publish*", "curl * | bash", "wget * | bash", "chmod 777*", "chown *"];
  for (const d of dangerous) {
    const match = profile.bash.find((b) => b.pattern === d);
    if (match && match.action !== "deny") {
      issues.push(`${name}: "${d}" must be "deny", got "${match.action}"`);
    }
  }

  // Ensure all profiles include security denials
  for (const denial of SECURITY_DENIALS) {
    const found = profile.bash.find((b) => b.pattern === denial.pattern);
    if (!found) {
      issues.push(`${name}: missing security denial "${denial.pattern}"`);
    } else if (found.action !== "deny") {
      issues.push(`${name}: security denial "${denial.pattern}" must be "deny", got "${found.action}"`);
    }
  }

  return issues;
}
