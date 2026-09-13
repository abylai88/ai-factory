import type { AgentResult } from "./mission.js";

// Model/provider failure patterns - more specific to avoid false positives
const MODEL_PROVIDER_PATTERNS = [
  // Explicit provider errors
  /provider\s+(error|failure|unavailable|timeout)/i,
  /rate\s+limit\s+(exceeded|reached)/i,
  /authentication\s+(error|failed|invalid)/i,
  /api\s+key\s+(invalid|missing|expired)/i,
  /context\s+(limit|length)\s+(exceeded|reached)/i,
  /model\s+(unavailable|overloaded|not\s+found)/i,
  /service\s+unavailable/i,
  /upstream\s+(error|timeout)/i,
  // Network errors specific to API calls
  /econnrefused|econnreset|etimedout/i,
  // HTTP status codes as standalone patterns
  /\b(503|502|429|401|403)\b/i,
  // Explicit capacity/overload
  /(overloaded|capacity\s+exceeded|quota\s+exceeded)/i,
];

// Code/task failure patterns - things that indicate the code itself has issues
const CODE_FAILURE_PATTERNS = [
  /typescript/i,
  /compilation\s+(error|failed)/i,
  /lint\s+(error|failed)/i,
  /test\s+(failed|failure)/i,
  /assertion\s+(error|failed)/i,
  /syntax\s+error/i,
  /reference\s+error/i,
  /type\s+error/i,
  /module\s+not\s+found/i,
  /cannot\s+find\s+module/i,
  /import.*failed/i,
  /export.*failed/i,
];

/**
 * Determine if a failure is a model/provider failure (eligible for model fallback)
 * vs a code/task failure (should go to triage/repair).
 * Uses weighted pattern matching to reduce false positives.
 */
export function isModelProviderFailure(result: AgentResult): boolean {
  if (result.status !== "failed" || !result.error) return false;
  const err = result.error.toLowerCase();

  // Check for code failure patterns first - if present, likely not a model failure
  const hasCodeFailure = CODE_FAILURE_PATTERNS.some(pattern => pattern.test(err));
  if (hasCodeFailure) return false;

  // Check for model provider patterns
  const hasModelProviderPattern = MODEL_PROVIDER_PATTERNS.some(pattern => pattern.test(err));
  if (hasModelProviderPattern) return true;

  // Fallback: check for simple keywords but only if no code patterns matched
  const MODEL_KEYWORDS_FALLBACK = [
    "provider", "unavailable", "rate limit", "authentication",
    "api key", "context limit", "service unavailable", "network",
    "econnrefused", "econnreset", "503", "502", "429", "401", "403",
    "overloaded", "capacity",
  ];
  const CODE_KEYWORDS_FALLBACK = [
    "typescript", "compilation", "lint", "test failed", "assertion", "syntax error",
    "reference error", "type error", "module not found", "cannot find module",
  ];

  const hasModelKeyword = MODEL_KEYWORDS_FALLBACK.some(k => err.includes(k));
  const hasCodeKeyword = CODE_KEYWORDS_FALLBACK.some(k => err.includes(k));

  return hasModelKeyword && !hasCodeKeyword;
}