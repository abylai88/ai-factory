import type { AgentRole, Delegation, Mission } from "./mission.js";
import { AgentRegistry, getDefaultRegistry } from "./agent-registry.js";

// ── Model Route ────────────────────────────────────────────────

export interface ModelRoute {
  primary: string;
  fallbacks: string[];
  reason: string;
}

export type TaskComplexity = "simple" | "medium" | "complex" | "expert";

export interface ModelSelectionContext {
  delegation: Delegation;
  role: AgentRole;
  mission: Mission;
  isRepair?: boolean;
  isReview?: boolean;
  complexity?: TaskComplexity;
}

export interface ModelRouterConfig {
  registry?: AgentRegistry;
  // Override defaults for fine-grained control
  overrides?: Partial<Record<AgentRole, ModelRoute>>;
  // Maximum number of fallbacks to surface
  maxFallbacks?: number;
}

const COMPLEXITY_KEYWORDS: Record<TaskComplexity, string[]> = {
  simple: ["rename", "format", "typo", "comment", "small", "trivial"],
  medium: ["implement", "add feature", "refactor", "test"],
  complex: ["debug", "architect", "design system", "integration", "performance"],
  expert: ["critical bug", "production issue", "security", "race condition", "memory leak"],
};

// ── Model Router ───────────────────────────────────────────────

/**
 * Selects the best model for a delegation based on role, task complexity,
 * and fallback availability.
 */
export class ModelRouter {
  private readonly config: ModelRouterConfig;
  private readonly registry: AgentRegistry;

  constructor(config?: ModelRouterConfig) {
    this.config = { maxFallbacks: 3, ...config };
    this.registry = config?.registry ?? getDefaultRegistry();
  }

  /**
   * Choose a model route for a delegation.
   */
  chooseModel(ctx: ModelSelectionContext): ModelRoute {
    // 1. Check explicit override
    const override = this.config.overrides?.[ctx.role];
    if (override) {
      return this.applyContextAdjustments(override, ctx);
    }

    // 2. Derive from role
    const cap = this.registry.getCapabilities(ctx.role);
    const primary = cap?.preferredModel ?? this.defaultPrimary(ctx.role);
    const fallbacks = cap?.fallbackModels ?? this.defaultFallbacks(ctx.role);

    let reason = `Default model for role ${ctx.role}`;
    const route: ModelRoute = {
      primary,
      fallbacks: this.limitFallbacks(fallbacks),
      reason,
    };

    return this.applyContextAdjustments(route, ctx);
  }

  /**
   * Estimate task complexity from a description.
   */
  estimateComplexity(description: string): TaskComplexity {
    const desc = description.toLowerCase();
    for (const [complexity, keywords] of Object.entries(COMPLEXITY_KEYWORDS) as [TaskComplexity, string[]][]) {
      if (keywords.some((kw) => desc.includes(kw))) {
        return complexity;
      }
    }
    return "medium";
  }

  /**
   * Build a route with fallback chain across multiple roles.
   */
  buildFallbackChain(primaryRole: AgentRole, alternateRoles: AgentRole[] = []): ModelRoute {
    const primaryCap = this.registry.getCapabilities(primaryRole);
    const primary = primaryCap?.preferredModel ?? this.defaultPrimary(primaryRole);
    const all: string[] = [...(primaryCap?.fallbackModels ?? [])];

    for (const role of alternateRoles) {
      const cap = this.registry.getCapabilities(role);
      if (cap?.preferredModel && !all.includes(cap.preferredModel)) {
        all.push(cap.preferredModel);
      }
      if (cap?.fallbackModels) {
        for (const m of cap.fallbackModels) {
          if (!all.includes(m)) all.push(m);
        }
      }
    }

    return {
      primary,
      fallbacks: this.limitFallbacks(all),
      reason: `Chain from ${primaryRole}${alternateRoles.length ? " + " + alternateRoles.join(", ") : ""}`,
    };
  }

  /**
   * Return the next model to try in the chain.
   * Returns null if no more fallbacks are available.
   */
  nextFallback(route: ModelRoute, currentModel: string): string | null {
    if (route.primary === currentModel) {
      return route.fallbacks[0] ?? null;
    }
    const idx = route.fallbacks.indexOf(currentModel);
    if (idx === -1 || idx + 1 >= route.fallbacks.length) {
      return null;
    }
    return route.fallbacks[idx + 1];
  }

  // ── Private helpers ─────────────────────────────────────────

  private applyContextAdjustments(route: ModelRoute, ctx: ModelSelectionContext): ModelRoute {
    let reason = route.reason;

    if (ctx.isRepair) {
      reason += " (repair task — using coding-focused model)";
    }
    if (ctx.isReview) {
      reason += " (review task — using independent model)";
    }
    if (ctx.complexity === "expert" || ctx.complexity === "complex") {
      reason += ` (complexity: ${ctx.complexity})`;
    }

    return { ...route, reason };
  }

  private limitFallbacks(fallbacks: string[]): string[] {
    return fallbacks.slice(0, this.config.maxFallbacks ?? 3);
  }

  private defaultPrimary(role: AgentRole): string {
    switch (role) {
      case "Developer":
      case "Architect":
      case "Repair":
        return "anthropic/claude-3-5-sonnet";
      case "QA":
        return "openai/gpt-4o";
      case "Researcher":
      case "Manager":
        return "anthropic/claude-3-haiku";
      case "Designer":
        return "anthropic/claude-3-5-sonnet";
      default:
        return "anthropic/claude-3-haiku";
    }
  }

  private defaultFallbacks(role: AgentRole): string[] {
    switch (role) {
      case "Developer":
      case "Architect":
        return ["openai/gpt-4o", "anthropic/claude-3-haiku"];
      case "QA":
        return ["anthropic/claude-3-5-sonnet", "anthropic/claude-3-haiku"];
      case "Repair":
        return ["openai/gpt-4o"];
      case "Researcher":
      case "Manager":
        return ["openai/gpt-4o-mini"];
      case "Designer":
        return ["openai/gpt-4o"];
      default:
        return ["anthropic/claude-3-haiku"];
    }
  }
}

// ── Factory ────────────────────────────────────────────────────

export function createModelRouter(config?: ModelRouterConfig): ModelRouter {
  return new ModelRouter(config);
}
