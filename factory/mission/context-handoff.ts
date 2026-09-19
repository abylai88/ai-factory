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
      : title === "QA FINDINGS" ? "qa" : "acceptance";
    sections.push(`--- ${title} ---\n${clip(body, BUDGETS[key] ?? 600)}`);
  }
  return sections.join("\n\n");
}
