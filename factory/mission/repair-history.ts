import { z } from "zod";

/**
 * Repair memory — persistent per-mission repair ledger with repeat
 * detection and bounded-escalation.
 *
 * After each repair iteration store: failure, evidence, diagnosis, repair
 * attempted, repair result, regression result. If the same failure repeats,
 * do NOT blindly re-apply the same repair — escalate to BLOCKED/NEEDS_HUMAN
 * once the bounded budget is exhausted.
 *
 * Persistence goes through MissionState (the single persistence system)
 * via exportState()/importState() below.
 */

export const RepairRecordSchema = z.object({
  id: z.string().min(1).max(100),
  delegationId: z.string().min(1).max(100),
  failure: z.string().min(1).max(2000),
  evidence: z.string().max(2000),
  diagnosis: z.string().max(2000),
  repairAttempted: z.string().min(1).max(2000),
  repairResult: z.enum(["fixed", "failed"]),
  regressionResult: z.string().max(2000).optional(),
  createdAt: z.string(),
});

export interface RepairRecord {
  id: string;
  delegationId: string;
  failure: string;
  evidence: string;
  diagnosis: string;
  repairAttempted: string;
  repairResult: "fixed" | "failed";
  regressionResult?: string;
  createdAt: string;
}

export type RepairMemoryDecision =
  | { action: "proceed"; reason: string }
  | { action: "retry-different"; reason: string; priorRepairs: string[] }
  | { action: "blocked"; reason: string };

function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 300);
}

export class RepairHistory {
  private records: RepairRecord[] = [];
  constructor(private readonly maxAttempts: number = 3) {}

  record(input: Omit<RepairRecord, "id" | "createdAt">): RepairRecord {
    const rec: RepairRecord = {
      ...input,
      id: `rep-${Math.random().toString(36).slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };
    this.records.push(rec);
    return rec;
  }

  forDelegation(delegationId: string): RepairRecord[] {
    return this.records.filter((r) => r.delegationId === delegationId);
  }

  count(): number {
    return this.records.length;
  }

  /**
   * Export all records as plain data for persistence through MissionState.
   * Deterministic order (insertion order).
   */
  exportState(): RepairRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  /**
   * Restore records previously exported with exportState(). Invalid
   * entries are skipped (never crash resume on one bad record).
   */
  importState(list: unknown): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;
    if (!Array.isArray(list)) return { imported, skipped };
    for (const item of list.slice(0, 500)) {
      const parsed = RepairRecordSchema.safeParse(item);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      // Avoid duplicating records that are already present (same id).
      if (this.records.some((r) => r.id === parsed.data.id)) {
        skipped++;
        continue;
      }
      this.records.push(parsed.data);
      imported++;
    }
    return { imported, skipped };
  }

  /**
   * Decide what to do about a new failure for a delegation:
   * - budget exhausted → blocked (NEEDS_HUMAN)
   * - same failure + same repair seen before → retry-different
   * - otherwise → proceed
   */
  decide(delegationId: string, failure: string, repairPlanned: string): RepairMemoryDecision {
    const prior = this.forDelegation(delegationId);
    if (prior.length >= this.maxAttempts) {
      return {
        action: "blocked",
        reason: `BLOCKED/NEEDS_HUMAN: repair budget exhausted (${prior.length}/${this.maxAttempts}) for ${delegationId}`,
      };
    }
    const key = normalize(failure);
    const sameFailure = prior.filter((r) => normalize(r.failure) === key);
    if (sameFailure.length > 0) {
      const sameRepair = sameFailure.some((r) => normalize(r.repairAttempted) === normalize(repairPlanned));
      if (sameRepair) {
        return {
          action: "retry-different",
          reason: `same failure already repaired with "${repairPlanned.slice(0, 120)}" — must try a different diagnosis`,
          priorRepairs: sameFailure.map((r) => r.repairAttempted),
        };
      }
      return {
        action: "retry-different",
        reason: `failure repeated ${sameFailure.length + 1}x — escalate diagnosis before re-applying`,
        priorRepairs: sameFailure.map((r) => r.repairAttempted),
      };
    }
    return { action: "proceed", reason: "first occurrence of this failure" };
  }
}
