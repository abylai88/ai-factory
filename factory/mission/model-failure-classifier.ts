import type { AgentResult } from "./mission.js";

const MODEL_KEYWORDS = [
  "provider", "timeout", "unavailable", "rate limit", "authentication",
  "api key", "context limit", "model", "service unavailable", "network",
  "econnrefused", "econnreset", "503", "502", "429", "401", "403",
  "overloaded", "capacity",
];

const CODE_KEYWORDS = ["typescript", "compilation", "lint", "test failed", "assertion", "syntax error"];

/**
 * Determine if a failure is a model/provider failure (eligible for model fallback)
 * vs a code/task failure (should go to triage/repair).
 */
export function isModelProviderFailure(result: AgentResult): boolean {
  if (result.status !== "failed" || !result.error) return false;
  const err = result.error.toLowerCase();
  const hasModelKeyword = MODEL_KEYWORDS.some(k => err.includes(k));
  const hasCodeKeyword = CODE_KEYWORDS.some(k => err.includes(k));
  return hasModelKeyword && !hasCodeKeyword;
}