import type { AgentRole } from "./mission.js";
import type { FailureCategory } from "./failure-triage.js";

/**
 * Specialist delegation — the company org chart.
 *
 * The core AgentRole enum (7 roles) stays the authority for Mission state.
 * Specialists are the fine-grained production roles the Director/Manager
 * delegates to; each maps onto a core role + tool profile so no second
 * factory or second permission system is introduced.
 */

export const SPECIALIST_ROLES = [
  "researcher",
  "market",
  "competitor",
  "director",
  "architect",
  "programmer",
  "gameplay",
  "visual",
  "ui",
  "content",
  "qa",
  "reviewer",
  "monetization",
] as const;
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

export interface HandoffContract {
  specialist: SpecialistRole;
  receives: string[];
  produces: string[];
  mustNot: string[];
}

export const HANDOFF_CONTRACTS: Record<SpecialistRole, HandoffContract> = {
  researcher: {
    specialist: "researcher",
    receives: ["research questions", "mission goal"],
    produces: ["structured pattern summary (fast feedback + visible progression, never copied maps/UI)"],
    mustNot: ["modify project source", "redefine game direction"],
  },
  market: {
    specialist: "market",
    receives: ["research questions", "market signals"],
    produces: ["audience + retention + monetization benchmarks"],
    mustNot: ["modify project source"],
  },
  competitor: {
    specialist: "competitor",
    receives: ["research questions", "comparable titles"],
    produces: ["mechanic/UX/retention patterns as design signals, not copies"],
    mustNot: ["copy competitor structure", "modify project source"],
  },
  director: {
    specialist: "director",
    receives: ["goal", "research summary", "constraints"],
    produces: ["vision, core loop, priorities, scene/UI/content/QA plans, milestones, acceptance criteria"],
    mustNot: ["personally implement everything"],
  },
  architect: {
    specialist: "architect",
    receives: ["director vision", "constraints"],
    produces: ["technical plan: module boundaries, server/client placement, persistence, risks"],
    mustNot: ["redefine core direction without evidence"],
  },
  programmer: {
    specialist: "programmer",
    receives: ["architecture", "systems/APIs", "bugs", "relevant design"],
    produces: ["working systems via tool layer"],
    mustNot: ["redefine core direction", "use unrestricted shell"],
  },
  gameplay: {
    specialist: "gameplay",
    receives: ["architecture", "tuning spec"],
    produces: ["tuned mechanics + feedback systems"],
    mustNot: ["redefine core direction"],
  },
  visual: {
    specialist: "visual",
    receives: ["visual direction", "scene requirements", "design intent", "scene constraints"],
    produces: ["world presentation via scene tools"],
    mustNot: ["touch scripts via scene tools", "edit under Players"],
  },
  ui: {
    specialist: "ui",
    receives: ["interaction requirements", "layout intent", "state requirements"],
    produces: ["HUD/menus with correct state updates"],
    mustNot: ["fake state updates"],
  },
  content: {
    specialist: "content",
    receives: ["design intent", "balance targets"],
    produces: ["data-driven levels/configs"],
    mustNot: ["hardcode secrets"],
  },
  qa: {
    specialist: "qa",
    receives: ["acceptance criteria", "runtime assertions", "failure history"],
    produces: ["structured multi-stage QA results with evidence"],
    mustNot: ["claim PASS from static validation alone", "claim visual PASS without screenshots"],
  },
  reviewer: {
    specialist: "reviewer",
    receives: ["acceptance criteria", "artifacts", "QA findings"],
    produces: ["verdict: release / release-with-fixes / block"],
    mustNot: ["approve without evidence"],
  },
  monetization: {
    specialist: "monetization",
    receives: ["audience", "retention signals"],
    produces: ["Roblox-native monetization plan (passes/products) or web equivalent"],
    mustNot: ["gate the core loop pay-to-win"],
  },
};

const SPECIALIST_TO_CORE: Record<SpecialistRole, AgentRole> = {
  researcher: "Researcher",
  market: "Researcher",
  competitor: "Researcher",
  director: "Manager",
  architect: "Architect",
  programmer: "Developer",
  gameplay: "Developer",
  visual: "Designer",
  ui: "Designer",
  content: "Developer",
  qa: "QA",
  reviewer: "QA",
  monetization: "Designer",
};

export function coreRoleForSpecialist(s: SpecialistRole): AgentRole {
  return SPECIALIST_TO_CORE[s];
}

export function isSpecialistRole(value: string): value is SpecialistRole {
  return (SPECIALIST_ROLES as readonly string[]).includes(value);
}

/**
 * Failure → specialist routing. Precise counterpart to the generic
 * failure-triage targetRole: keeps "send everything to programmer" from
 * happening by naming the owning specialist first.
 */
export function routeFailureToSpecialist(category: FailureCategory): SpecialistRole {
  switch (category) {
    case "syntax_error":
    case "type_error":
      return "programmer";
    case "test_failure":
      return "qa";
    case "dependency_missing":
      return "researcher";
    case "build_config":
      return "architect";
    case "roblox_structure":
      return "programmer";
    case "roblox_runtime":
      return "gameplay";
    case "visual_regression":
      return "visual";
    case "quality_visual":
      return "visual";
    case "quality_ux":
      return "ui";
    case "quality_gameplay":
      return "gameplay";
    case "quality_technical":
      return "programmer";
    case "quality_content":
      return "content";
    case "tool_unavailable":
      return "director";
    default:
      return "programmer";
  }
}

/** UI-specific failures detected from message text override the category route. */
export function routeFailureTextToSpecialist(message: string): SpecialistRole | null {
  const t = (message ?? "").toLowerCase();
  if (/upgrade ?gui|hud|menu|button.*missing|ui.*missing|screen ?gui/.test(t)) return "ui";
  if (/datastore|persist|save.*fail|game ?pass|developer ?product|monetiz/.test(t)) return "monetization";
  if (/balance|level.*data|content.*missing|config.*missing/.test(t)) return "content";
  return null;
}

// ── Quality finding → specialist ownership (Phase 5) ─────────────
// Every quality finding has an explicit owner. Visual → visual, UI/UX →
// ui, gameplay/pacing/feedback → gameplay, content/coherence → content,
// technical → architect/programmer/builder per existing ownership.
// Never routes everything to programmer.

export type QualityCriticDimension = "visual" | "ux" | "gameplay" | "technical";

export function routeQualityFindingToSpecialist(input: {
  dimension: QualityCriticDimension;
  proposedOwner?: string;
  requirementId?: string;
  evidenceText?: string;
}): SpecialistRole {
  const proposed = (input.proposedOwner ?? "").toLowerCase().trim();
  if (proposed && isSpecialistRole(proposed)) {
    // Explicit critic owner wins when it names a real specialist.
    return proposed;
  }
  const req = (input.requirementId ?? "").toLowerCase();
  const text = `${req} ${(input.evidenceText ?? "").toLowerCase()}`;
  // Content/coherence signals override dimension defaults.
  if (/placeholder|filler|terminology|copy|fantasy|debug.*ui|cheat|test.*control/.test(text)) return "content";
  // Monetization signals keep their owner.
  if (/datastore|persist|game.?pass|developer.?product|monetiz/.test(text)) return "monetization";
  // Technical sub-routing per existing ownership.
  if (input.dimension === "technical") {
    if (/architect|module.*boundar|build.*config|deterministic|asset.*safety|blueprint/.test(text)) return "architect";
    return "programmer";
  }
  switch (input.dimension) {
    case "visual": return "visual";
    case "ux": return "ui";
    case "gameplay": return "gameplay";
    default: return "programmer";
  }
}
