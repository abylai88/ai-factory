import type { AgentRole } from "./mission.js";

// ── Agent Capability ───────────────────────────────────────────

export interface AgentCapability {
  role: AgentRole;
  name: string;
  description: string;
  capabilities: string[];
  preferredTaskTypes: string[];
  canReview: boolean;
  canSpawnSubtasks: boolean;
  preferredModel?: string;
  fallbackModels?: string[];
  maxConcurrency?: number;
}

// ── Reviewer Routing ───────────────────────────────────────────

export interface ReviewerRoute {
  primary: AgentRole;
  alternates: AgentRole[];
}

// ── Agent Registry ─────────────────────────────────────────────

const DEFAULT_REGISTRY: AgentCapability[] = [
  {
    role: "Manager",
    name: "Mission Manager",
    description: "Coordinates teams, prioritizes work, reviews research and design output.",
    capabilities: [
      "planning",
      "coordination",
      "delegation",
      "prioritization",
      "mission oversight",
    ],
    preferredTaskTypes: ["planning", "review-research", "review-design", "coordination"],
    canReview: true,
    canSpawnSubtasks: true,
    preferredModel: "anthropic/claude-3-haiku",
    fallbackModels: ["openai/gpt-4o-mini"],
    maxConcurrency: 1,
  },
  {
    role: "Researcher",
    name: "Research Specialist",
    description: "Performs web, market, and code research and writes structured reports.",
    capabilities: [
      "web research",
      "market research",
      "competitor analysis",
      "documentation research",
      "codebase analysis",
    ],
    preferredTaskTypes: ["research", "analysis", "investigation"],
    canReview: false,
    canSpawnSubtasks: false,
    preferredModel: "anthropic/claude-3-haiku",
    fallbackModels: ["openai/gpt-4o-mini"],
    maxConcurrency: 3,
  },
  {
    role: "Developer",
    name: "Implementation Developer",
    description: "Implements, debugs, integrates, and refactors code.",
    capabilities: [
      "implementation",
      "debugging",
      "integration",
      "refactoring",
      "build operations",
    ],
    preferredTaskTypes: [
      "code",
      "build",
      "implementation",
      "fix",
      "refactor",
      "integration",
    ],
    canReview: true,
    canSpawnSubtasks: false,
    preferredModel: "anthropic/claude-3-5-sonnet",
    fallbackModels: ["openai/gpt-4o", "anthropic/claude-3-haiku"],
    maxConcurrency: 2,
  },
  {
    role: "Designer",
    name: "Design Specialist",
    description: "Creates UI, UX, visual assets, and game design plans.",
    capabilities: [
      "UI design",
      "UX design",
      "visual assets",
      "game design",
      "interaction design",
    ],
    preferredTaskTypes: ["design", "ui", "ux", "visual", "interaction"],
    canReview: false,
    canSpawnSubtasks: false,
    preferredModel: "anthropic/claude-3-5-sonnet",
    fallbackModels: ["openai/gpt-4o"],
    maxConcurrency: 2,
  },
  {
    role: "QA",
    name: "Quality Assurance",
    description: "Tests, reproduces bugs, runs regression analysis, and reviews implementation work.",
    capabilities: [
      "testing",
      "bug reproduction",
      "regression analysis",
      "test planning",
      "review-implementation",
    ],
    preferredTaskTypes: ["qa", "testing", "review-implementation", "regression"],
    canReview: true,
    canSpawnSubtasks: false,
    preferredModel: "openai/gpt-4o",
    fallbackModels: ["anthropic/claude-3-5-sonnet", "anthropic/claude-3-haiku"],
    maxConcurrency: 3,
  },
  {
    role: "Repair",
    name: "Targeted Repair Agent",
    description: "Performs targeted fixes for known issues with bounded scope.",
    capabilities: [
      "targeted fixes",
      "validation repair",
      "patch generation",
      "scope-limited changes",
    ],
    preferredTaskTypes: ["repair", "fix", "patch"],
    canReview: false,
    canSpawnSubtasks: false,
    preferredModel: "anthropic/claude-3-5-sonnet",
    fallbackModels: ["openai/gpt-4o"],
    maxConcurrency: 2,
  },
  {
    role: "Architect",
    name: "System Architect",
    description: "Designs architecture, analyzes dependencies, and creates technical designs.",
    capabilities: [
      "architecture",
      "dependency analysis",
      "technical design",
      "system review",
    ],
    preferredTaskTypes: ["architect", "design-system", "review-architecture", "analysis"],
    canReview: true,
    canSpawnSubtasks: false,
    preferredModel: "anthropic/claude-3-5-sonnet",
    fallbackModels: ["openai/gpt-4o"],
    maxConcurrency: 1,
  },
];

// ── Registry Class ─────────────────────────────────────────────

export class AgentRegistry {
  private readonly capabilities: Map<AgentRole, AgentCapability>;

  constructor(customCapabilities?: AgentCapability[]) {
    this.capabilities = new Map();
    const source = customCapabilities ?? DEFAULT_REGISTRY;
    for (const cap of source) {
      this.capabilities.set(cap.role, cap);
    }
  }

  getCapabilities(role: AgentRole): AgentCapability | undefined {
    return this.capabilities.get(role);
  }

  getAllCapabilities(): AgentCapability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * Find the best role for a task description using keyword matching.
   */
  findBestRoleForTask(taskDescription: string): AgentRole {
    const desc = taskDescription.toLowerCase();
    const scored: Array<{ role: AgentRole; score: number }> = [];

    for (const cap of this.capabilities.values()) {
      let score = 0;
      for (const capability of cap.capabilities) {
        if (desc.includes(capability.toLowerCase())) {
          score += 2;
        }
      }
      for (const taskType of cap.preferredTaskTypes) {
        if (desc.includes(taskType.toLowerCase())) {
          score += 3;
        }
      }
      if (score > 0) {
        scored.push({ role: cap.role, score });
      }
    }

    if (scored.length === 0) {
      return "Developer";
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0].role;
  }

  /**
   * Find the reviewer role for a given role.
   * Routing rules (from the spec):
   *   Developer work → QA or Architect
   *   Architect work → Developer
   *   Research work  → Manager
   *   Designer work  → QA or Manager
   *   Repair work    → QA
   *   QA work        → Architect
   *   Manager work   → Architect (oversight of orchestration is reviewed by Architect)
   */
  findReviewerRole(role: AgentRole): ReviewerRoute {
    switch (role) {
      case "Developer":
        return { primary: "QA", alternates: ["Architect"] };
      case "Repair":
        return { primary: "QA", alternates: ["Developer"] };
      case "Architect":
        return { primary: "Developer", alternates: ["QA"] };
      case "Researcher":
        return { primary: "Manager", alternates: ["Architect"] };
      case "Designer":
        return { primary: "QA", alternates: ["Manager"] };
      case "QA":
        return { primary: "Architect", alternates: ["Developer"] };
      case "Manager":
        return { primary: "Architect", alternates: ["Developer"] };
      default:
        return { primary: "Architect", alternates: [] };
    }
  }

  /**
   * Get fallback roles when a primary role is unavailable.
   * Always returns at least one fallback for a known role.
   */
  getFallbackRoles(role: AgentRole): AgentRole[] {
    switch (role) {
      case "Developer":
        return ["Repair", "Architect"];
      case "QA":
        return ["Architect", "Developer"];
      case "Architect":
        return ["Developer", "QA"];
      case "Researcher":
        return ["Manager"];
      case "Designer":
        return ["QA", "Manager"];
      case "Repair":
        return ["Developer", "Architect"];
      case "Manager":
        return ["Architect", "Developer"];
      default:
        return ["Developer"];
    }
  }

  /**
   * Check if a role can review work.
   */
  canReview(role: AgentRole): boolean {
    return this.capabilities.get(role)?.canReview ?? false;
  }

  /**
   * Check if a role can spawn subtasks.
   */
  canSpawnSubtasks(role: AgentRole): boolean {
    return this.capabilities.get(role)?.canSpawnSubtasks ?? false;
  }

  /**
   * Get the preferred model for a role.
   */
  getPreferredModel(role: AgentRole): string | undefined {
    return this.capabilities.get(role)?.preferredModel;
  }

  /**
   * Get fallback models for a role.
   */
  getFallbackModels(role: AgentRole): string[] {
    return this.capabilities.get(role)?.fallbackModels ?? [];
  }

  /**
   * Get the maximum concurrent delegations for a role.
   */
  getMaxConcurrency(role: AgentRole): number {
    return this.capabilities.get(role)?.maxConcurrency ?? 1;
  }
}

// ── Singleton ──────────────────────────────────────────────────

let _defaultRegistry: AgentRegistry | null = null;

export function getDefaultRegistry(): AgentRegistry {
  if (!_defaultRegistry) {
    _defaultRegistry = new AgentRegistry();
  }
  return _defaultRegistry;
}

export function resetDefaultRegistry(): void {
  _defaultRegistry = null;
}
