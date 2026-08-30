#!/usr/bin/env tsx
/**
 * Regenerate agent .md files from factory permission profiles.
 * This script reads the current agent files, extracts the body content,
 * and regenerates the YAML frontmatter with correct permission blocks.
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { PROFILES, AGENT_NAMES } from "../permissions/permission-profiles.js";
import { validateProfile } from "../permissions/permission-builder.js";

const AGENTS_DIR = join(import.meta.dirname, "../../agents/opencode");

// Validate all profiles first
const issues: string[] = [];
for (const name of AGENT_NAMES) {
  issues.push(...validateProfile(name, PROFILES[name]));
}
if (issues.length > 0) {
  console.error("Profile validation failed:");
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

// Build permission YAML for a profile
function buildPermissionYaml(profile: typeof PROFILES.tester): string {
  const lines: string[] = [];
  lines.push("permission:");
  lines.push(`  edit: ${profile.edit}`);
  lines.push("  bash:");
  for (const bp of profile.bash) {
    const escaped = bp.pattern.includes(":") || bp.pattern.includes("#")
      ? `"${bp.pattern}"`
      : bp.pattern;
    lines.push(`    "${escaped}": ${bp.action}`);
  }
  lines.push(`  todowrite: ${profile.todowrite}`);
  return lines.join("\n");
}

// Extract body content (after closing ---)
function extractBody(content: string): string {
  const match = content.match(/^(?:---\n[\s\S]*?\n---)([\s\S]*)$/);
  return match ? match[1] : content;
}

// Extract description and mode from existing frontmatter
function extractFrontmatter(content: string): { description: string; mode: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: "", mode: "all" };
  const fm = match[1];
  const descMatch = fm.match(/description:\s*(.+)/);
  const modeMatch = fm.match(/mode:\s*(\w+)/);
  return {
    description: descMatch ? descMatch[1].trim() : "",
    mode: modeMatch ? modeMatch[1].trim() : "all"
  };
}

// Regenerate each agent file
const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
let updated = 0;

for (const file of files) {
  const name = file.replace(".md", "");
  const profile = PROFILES[name];
  if (!profile) {
    console.warn(`  SKIP: no profile for "${name}"`);
    continue;
  }

  const filePath = join(AGENTS_DIR, file);
  const content = readFileSync(filePath, "utf-8");
  const { description, mode } = extractFrontmatter(content);
  const body = extractBody(content);

  const permYaml = buildPermissionYaml(profile);
  const newContent = `---\ndescription: ${description}\nmode: ${mode}\n${permYaml}\n---${body}`;

  writeFileSync(filePath, newContent, "utf-8");
  console.log(`  UPD:  ${file}`);
  updated++;
}

console.log(`\nDone: ${updated} files regenerated`);
