import type { ProductionBlueprint } from "./blueprint.js";
import { blueprintSliceForRole } from "./blueprint.js";

/**
 * Context handoff — shared Task/Artifact Context model.
 *
 * Composes the bounded, role-specific prompt block every specialist
 * receives: blueprint slice + research signals + prior decisions + project
 * state + known bugs + evidence + acceptance criteria. Never dumps the
 * whole conversation; every section is truncated to its budget.
 */

export interface HandoffInput {
  role: string;
  taskTitle: string;
  blueprint?: ProductionBlueprint;
  researchSummary?: string;
  decisions?: string[];
  priorResults?: Array<{ title: string; summary: string }>;
  projectState?: string;
  knownBugs?: string[];
  evidence?: string[];
  qaFindings?: string[];
  acceptanceCriteria?: string[];
  /** Director quality vision text (fantasy, pillars, quality bar). */
  directorQuality?: string;
  /** Role-relevant quality requirements (concrete requirement statements). */
  qualityRequirements?: string[];
  /** Previous critic findings relevant to this task. */
  qualityFindings?: string[];
  /** Explicit deliverables for this task. */
  deliverables?: string[];
  /** Explicit anti-patterns this role must avoid. */
  antiPatterns?: string[];
  /** How the output will be verified. */
  verificationRequirements?: string[];
}

const BUDGETS: Record<string, number> = {
  blueprint: 1200,
  research: 800,
  decisions: 600,
  prior: 1200,
  project: 600,
  bugs: 600,
  evidence: 600,
  qa: 600,
  acceptance: 600,
  quality: 800,
  findings: 800,
  deliverables: 400,
  antipatterns: 400,
  verification: 400,
};

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n... (truncated)`;
}

export function buildRoleHandoff(input: HandoffInput): string {
  const sections: string[] = [];
  sections.push(`ROLE: ${input.role}`);
  sections.push(`TASK: ${clip(input.taskTitle, 400)}`);

  if (input.blueprint) {
    sections.push(`--- BLUEPRINT ---\n${clip(blueprintSliceForRole(input.blueprint, input.role), BUDGETS.blueprint)}`);
  }
  // Role-specific framing: each specialty sees its contract inputs first.
  const r = input.role.toLowerCase();
  const order: Array<[string, string | undefined]> = [];
  if (["programmer", "developer", "gameplay", "architect", "builder"].includes(r)) {
    order.push(["PRIOR RESULTS", input.priorResults?.map((p) => `- ${p.title}: ${p.summary}`).join("\n")]);
    order.push(["KNOWN BUGS", input.knownBugs?.map((b) => `- ${b}`).join("\n")]);
    order.push(["RESEARCH SIGNALS", input.researchSummary]);
  } else if (["visual", "designer", "ui", "content"].includes(r)) {
    order.push(["RESEARCH SIGNALS", input.researchSummary]);
    order.push(["PROJECT STATE", input.projectState]);
    order.push(["EVIDENCE", input.evidence?.map((e) => `- ${e}`).join("\n")]);
  } else if (["qa", "tester", "reviewer", "repair"].includes(r)) {
    order.push(["ACCEPTANCE CRITERIA", input.acceptanceCriteria?.map((c) => `- ${c}`).join("\n")]);
    order.push(["QA FINDINGS", input.qaFindings?.map((q) => `- ${q}`).join("\n")]);
    order.push(["KNOWN BUGS", input.knownBugs?.map((b) => `- ${b}`).join("\n")]);
    order.push(["EVIDENCE", input.evidence?.map((e) => `- ${e}`).join("\n")]);
  } else {
    order.push(["RESEARCH SIGNALS", input.researchSummary]);
    order.push(["PRIOR RESULTS", input.priorResults?.map((p) => `- ${p.title}: ${p.summary}`).join("\n")]);
  }
  order.push(["DECISIONS", input.decisions?.map((d) => `- ${d}`).join("\n")]);
  order.push(["PROJECT STATE", input.projectState]);
  order.push(["ACCEPTANCE CRITERIA", input.acceptanceCriteria?.map((c) => `- ${c}`).join("\n")]);
  // Quality contract: the implementation agent knows the bar BEFORE coding;
  // the repair agent knows the exact defect + expected evidence AFTER.
  order.push(["DIRECTOR QUALITY", input.directorQuality]);
  order.push(["QUALITY REQUIREMENTS", input.qualityRequirements?.map((q) => `- ${q}`).join("\n")]);
  order.push(["QUALITY FINDINGS", input.qualityFindings?.map((q) => `- ${q}`).join("\n")]);
  order.push(["DELIVERABLES", input.deliverables?.map((d) => `- ${d}`).join("\n")]);
  order.push(["ANTI-PATTERNS", input.antiPatterns?.map((a) => `- ${a}`).join("\n")]);
  order.push(["VERIFICATION", input.verificationRequirements?.map((v) => `- ${v}`).join("\n")]);

  const seen = new Set<string>();
  for (const [title, body] of order) {
    if (!body || !body.trim() || seen.has(title)) continue;
    seen.add(title);
    const key = title === "RESEARCH SIGNALS" ? "research"
      : title === "DECISIONS" ? "decisions"
      : title === "PRIOR RESULTS" ? "prior"
      : title === "PROJECT STATE" ? "project"
      : title === "KNOWN BUGS" ? "bugs"
      : title === "EVIDENCE" ? "evidence"
      : title === "DIRECTOR QUALITY" ? "quality"
      : title === "QUALITY REQUIREMENTS" ? "quality"
      : title === "QUALITY FINDINGS" ? "findings"
      : title === "DELIVERABLES" ? "deliverables"
      : title === "ANTI-PATTERNS" ? "antipatterns"
      : title === "VERIFICATION" ? "verification"
      : title === "QA FINDINGS" ? "qa" : "acceptance";
    sections.push(`--- ${title} ---\n${clip(body, BUDGETS[key] ?? 600)}`);
  }
  return sections.join("\n\n");
}

// ── Role quality briefs (Phase 9) ────────────────────────────
// Every execution role receives: relevant blueprint slice, director
// vision, quality requirements for its role, previous findings,
// evidence, explicit deliverables, explicit anti-patterns, and
// verification requirements — so weaker models still produce
// disciplined output without relying on "a smarter model".

const ROLE_QUALITY_REQUIREMENTS: Record<string, string[]> = {
  programmer: [
    "Server-authoritative state where applicable (no client-trusted currency)",
    "No known runtime errors from project code in a live session",
    "Spawn is safe (floor beneath spawn + SpawnLocation)",
  ],
  gameplay: [
    "Every player action produces visible feedback within 1s",
    "First-minute beats: spawn → collect → upgrade with next goal shown",
    "Progression tiers visibly faster than the last; no soft-locks",
  ],
  visual: [
    "Deliberate visual identity (palette + mood), never default graybox",
    "Composed map: spawn area + play field + landmarks, not an empty plate",
    "Key elements readable at a glance; no placeholder-feeling surfaces",
  ],
  ui: [
    "Primary action visually distinct from secondary navigation",
    "HUD always shows currency + next goal; no dead/unexplained UI",
    "Readable text, button states, discoverable core actions",
  ],
  content: [
    "No placeholder names, filler text, or debug UI in production",
    "Cohesive terminology supporting the game fantasy",
  ],
  architect: [
    "Module boundaries + server/client placement per blueprint",
    "Deterministic build via the platform toolchain; safe asset handling",
  ],
  qa: [
    "Functional PASS and quality PASS are separate verdicts with evidence",
    "Never claim visual PASS without screenshot/viewport evidence",
  ],
  reviewer: [
    "Approve only with evidence for every applicable dimension",
    "Stretch goals never block; unavailable evidence never becomes PASS",
  ],
};

const ROLE_ANTI_PATTERNS: Record<string, string[]> = {
  programmer: ["client-trusted currency", "dead controls", "unverified spawn safety"],
  gameplay: ["silent rewards", "dead first minute", "single forced path with no choice"],
  visual: ["empty gray baseplate", "arbitrary clashing colors", "meaningless decorative objects"],
  ui: ["giant text everywhere", "buttons without hierarchy", "hidden critical actions", "debug controls in production"],
  content: ["Test/Foo/Untitled names", "lorem ipsum / TODO copy", "disconnected progression copy"],
  architect: ["duplicated systems", "orphaned systems with no player purpose", "unvetted external fetches"],
  qa: ["static validation claimed as runtime PASS", "fabricated visual observations"],
  reviewer: ["approving without evidence", "converting unavailable into PASS"],
};

const ROLE_VERIFICATION: Record<string, string[]> = {
  programmer: ["Build exits 0 via platform toolchain", "Runtime logs clean in a live session"],
  gameplay: ["Runtime assertions pass per loop step", "First-minute checklist observed"],
  visual: ["Scene inspection lists composed layout", "Screenshot shows deliberate identity (when available)"],
  ui: ["UI hierarchy lists HUD + states", "Every control mapped to a behavior"],
  content: ["Content scan clean (no placeholders/debug UI)"],
  architect: ["Structural validation passes", "Module layout matches blueprint"],
  qa: ["Each verdict cites its evidence", "Gate semantics respected (no silent PASS)"],
  reviewer: ["Release verdict cites per-dimension evidence"],
};

function roleKey(role: string): string {
  const r = role.toLowerCase();
  if (["developer", "builder", "coder", "repair"].includes(r)) return "programmer";
  if (["designer"].includes(r)) return "visual";
  if (["tester"].includes(r)) return "qa";
  if (["manager", "director"].includes(r)) return "reviewer";
  if (ROLE_QUALITY_REQUIREMENTS[r]) return r;
  return "programmer";
}

export function qualityBriefForRole(role: string): {
  qualityRequirements: string[];
  antiPatterns: string[];
  verificationRequirements: string[];
} {
  const k = roleKey(role);
  return {
    qualityRequirements: ROLE_QUALITY_REQUIREMENTS[k] ?? ROLE_QUALITY_REQUIREMENTS.programmer!,
    antiPatterns: ROLE_ANTI_PATTERNS[k] ?? [],
    verificationRequirements: ROLE_VERIFICATION[k] ?? [],
  };
}
