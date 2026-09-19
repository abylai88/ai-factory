import { z } from "zod";

/**
 * Multi-stage QA hierarchy (8 levels).
 *
 * A higher-level PASS requires the required lower-level evidence —
 * "build passed → game passed" is rejected by construction.
 */

export const QA_LEVELS = [
  "static-build",
  "structural",
  "studio-readiness",
  "runtime",
  "gameplay-assertions",
  "visual",
  "regression",
  "final-review",
] as const;
export type QaLevel = (typeof QA_LEVELS)[number];

export const QaLevelResultSchema = z.object({
  level: z.enum(QA_LEVELS),
  status: z.enum(["passed", "failed", "skipped", "blocked"]),
  evidence: z.string().min(1),
  checkedAt: z.string(),
});
export type QaLevelResult = z.infer<typeof QaLevelResultSchema>;

export const QaHierarchyResultSchema = z.object({
  levels: z.array(QaLevelResultSchema).length(8),
  overall: z.enum(["passed", "failed", "blocked"]),
  summary: z.string(),
});
export type QaHierarchyResult = z.infer<typeof QaHierarchyResultSchema>;

/** Levels that must PASS (not skip) before a higher level may PASS. */
const REQUIRED_BELOW: Record<QaLevel, QaLevel[]> = {
  "static-build": [],
  "structural": ["static-build"],
  "studio-readiness": ["static-build", "structural"],
  "runtime": ["static-build", "structural", "studio-readiness"],
  "gameplay-assertions": ["static-build", "structural", "studio-readiness", "runtime"],
  "visual": ["static-build", "structural", "studio-readiness", "runtime"],
  "regression": ["static-build", "structural", "runtime", "gameplay-assertions"],
  "final-review": ["static-build", "structural", "runtime", "gameplay-assertions", "regression"],
};

export function evaluateQaHierarchy(levels: QaLevelResult[]): QaHierarchyResult {
  const byLevel = new Map<QaLevel, QaLevelResult>(levels.map((l) => [l.level, l]));
  const full: QaLevelResult[] = QA_LEVELS.map(
    (level) =>
      byLevel.get(level) ?? {
        level,
        status: "blocked" as const,
        evidence: "no evidence recorded",
        checkedAt: new Date().toISOString(),
      },
  );
  const lookup = new Map<QaLevel, QaLevelResult>(full.map((l) => [l.level, l]));
  const violations: string[] = [];

  for (const level of full) {
    if (level.status !== "passed") continue;
    for (const req of REQUIRED_BELOW[level.level]) {
      if (lookup.get(req)?.status !== "passed") {
        violations.push(`${level.level} claims PASS but requires ${req} PASS`);
      }
    }
  }
  // Honesty rules: runtime/visual PASS needs real evidence keywords.
  const runtime = lookup.get("runtime")!;
  if (runtime.status === "passed" && !/runtime|playtest|log|assert/i.test(runtime.evidence)) {
    violations.push("runtime PASS requires runtime evidence (playtest/logs/assertions), not static validation");
  }
  const visual = lookup.get("visual")!;
  if (visual.status === "passed" && !/screenshot|visual|viewport|image/i.test(visual.evidence)) {
    violations.push("visual PASS requires real visual evidence (screenshot/viewport)");
  }
  const failed = full.filter((l) => l.status === "failed" || l.status === "blocked");
  const overall = violations.length > 0 || failed.length > 0 ? "failed" as const : "passed" as const;
  return {
    levels: full as QaHierarchyResult["levels"],
    overall,
    summary: violations.length > 0
      ? `QA hierarchy REJECTED: ${violations.join("; ")}`
      : overall === "passed"
        ? "QA hierarchy passed: all 8 levels evidenced"
        : `QA hierarchy failed at: ${failed.map((f) => f.level).join(", ")}`,
  };
}

export function qaLevelResult(level: QaLevel, status: QaLevelResult["status"], evidence: string): QaLevelResult {
  return { level, status, evidence, checkedAt: new Date().toISOString() };
}
