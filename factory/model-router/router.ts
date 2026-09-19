export type AgentRole =
  | "orchestrator"
  | "research"
  | "game"
  | "engineering"
  | "qa"
  | "market"
  | "competitor"
  | "idea"
  | "director"
  | "gameplay"
  | "programmer"
  | "content"
  | "monetization"
  | "architect";

export interface ModelChoice {
  model: string;
  reason: string;
}

export type AttemptErrorType =
  | "success"
  | "timeout"
  | "rate_limit"
  | "upstream_error"
  | "process_error"
  | "payment_error"
  | "unknown";

export interface AttemptResult {
  status: "success" | "failed";
  errorType: AttemptErrorType;
  errorMessage: string;
  model: string;
  attempt: number;
  timedOut: boolean;
  retryable: boolean;
}

export function classifyError(output: string, exitCode: number): AttemptErrorType {
  const lower = output.toLowerCase();

  if (
    lower.includes("rate limit exceeded") ||
    lower.includes("429") ||
    lower.includes("too many requests")
  ) {
    return "rate_limit";
  }

  if (
    lower.includes("no payment method") ||
    lower.includes("creditserror") ||
    lower.includes("credit") ||
    lower.includes("billing") ||
    lower.includes("payment")
  ) {
    return "payment_error";
  }

  if (
    lower.includes("upstream error") ||
    lower.includes("upstream") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  ) {
    return "upstream_error";
  }

  if (exitCode !== 0) {
    return "process_error";
  }

  return "unknown";
}

export function isRetryableError(errorType: AttemptErrorType): boolean {
  switch (errorType) {
    case "rate_limit":
    case "timeout":
    case "upstream_error":
    case "process_error":
      return true;
    case "payment_error":
    case "success":
      return false;
    default:
      return false;
  }
}

const MODEL_POOL: Record<AgentRole, string[]> = {
  orchestrator: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  research: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  game: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  engineering: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  qa: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  market: [
    "opencode/muse-spark-1.3",
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  competitor: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  idea: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  director: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  gameplay: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  programmer: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  content: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  monetization: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ],

  architect: [
    "opencode/mimo-v2.5-free",
    "opencode/nemotron-3-ultra-free",
    "opencode/nemotron-3.5-lightning-free"
  ]
};

export function getModelsForRole(role: AgentRole): string[] {
  return MODEL_POOL[role] ?? MODEL_POOL.engineering;
}

export function chooseModel(
  role: AgentRole,
  failedModels: string[] = []
): ModelChoice {
  const available = getModelsForRole(role).filter(
    model => !failedModels.includes(model)
  );

  const model = available[0] ?? getModelsForRole(role)[0];

  return {
    model,
    reason: `Selected ${model} for ${role}`
  };
}

// ── Task-complexity routing ──────────────────────────────────────
// Cheap/free models wherever possible; stronger models where reasoning
// complexity matters. Pools are configurable via env (comma-separated
// model lists); retry/rotation behavior above is preserved.

export type TaskComplexity = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export function classifyTaskComplexity(task: string): TaskComplexity {
  const t = (task ?? "").toLowerCase();
  if (/major mission planning|conflict resolution|difficult repair|cross-agent/i.test(t)) return "VERY_HIGH";
  if (/architect|multi-agent planning|complex debug|runtime fail|cross-system/i.test(t)) return "HIGH";
  if (/implement|feature|ui work|scene change|content/i.test(t)) return "MEDIUM";
  return "LOW";
}

function envPool(name: string): string[] | null {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return null;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

export function chooseModelForComplexity(
  role: AgentRole,
  complexity: TaskComplexity,
  failedModels: string[] = [],
): ModelChoice {
  const override =
    complexity === "VERY_HIGH" ? envPool("AI_FACTORY_MODELS_VERY_HIGH")
    : complexity === "HIGH" ? envPool("AI_FACTORY_MODELS_HIGH")
    : complexity === "MEDIUM" ? envPool("AI_FACTORY_MODELS_MEDIUM")
    : envPool("AI_FACTORY_MODELS_LOW");
  if (override) {
    const avail = override.filter((m) => !failedModels.includes(m));
    const model = avail[0] ?? override[0];
    return { model, reason: `Selected ${model} for ${role} at ${complexity} (env pool)` };
  }
  // Default: reuse the role pool rotation (cheap/free first); HIGH+ prefers
  // the tail of the pool when a stronger fallback exists there.
  const pool = getModelsForRole(role);
  const ordered = complexity === "LOW" || complexity === "MEDIUM" ? pool : [...pool].reverse();
  const avail = ordered.filter((m) => !failedModels.includes(m));
  const model = avail[0] ?? pool[0];
  return { model, reason: `Selected ${model} for ${role} at ${complexity}` };
}
