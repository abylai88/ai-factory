import { z } from "zod";

/**
 * Persisted mission memory — versioned schemas for everything that must
 * survive a process restart: key decisions, repair ledger entries, and
 * Roblox readiness evidence summaries.
 *
 * What is deliberately NEVER persisted here:
 * - MCP auth tokens, secrets, credentials, passwords, API keys
 * - ephemeral runtime identifiers (Studio peer/instance IDs, live MCP
 *   connection handles, running playtest handles, PIDs)
 * - huge raw agent transcripts (summaries only, bounded lengths)
 *
 * Persistence itself lives in MissionState (single persistence system);
 * this module only defines the shapes, bounds, sanitization, and the
 * snapshot version/migration logic.
 */

export const PERSISTED_SNAPSHOT_VERSION = 1;

// ── Decisions ────────────────────────────────────────────────

export const DecisionCategorySchema = z.enum([
  "architecture",
  "design",
  "platform",
  "core-loop",
  "implementation",
  "qa",
  "repair",
  "blueprint",
  "quality",
]);
export type DecisionCategory = z.infer<typeof DecisionCategorySchema>;

export const DecisionRecordSchema = z.object({
  id: z.string().min(1).max(100),
  missionId: z.string().min(1).max(100),
  category: DecisionCategorySchema,
  title: z.string().min(1).max(300),
  /** Structured summary — never raw model chatter. */
  detail: z.string().min(1).max(2000),
  rationale: z.string().max(1000).optional(),
  alternatives: z.array(z.string().max(300)).max(5).optional(),
  createdBy: z.string().max(100).optional(),
  createdAt: z.string(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

export const MAX_DECISIONS = 50;

// ── Roblox readiness evidence (persistent summary only) ──────

export const ReadinessEvidenceSchema = z.object({
  projectDir: z.string().max(500),
  /** Rojo artifact path (relative summary, e.g. "build.rbxlx"). */
  artifactPath: z.string().max(500).optional(),
  artifactFresh: z.boolean().optional(),
  /** Human-readable summary, e.g. "PLACE_READY (reused), load 1.2s". */
  evidence: z.string().max(1000),
  recordedAt: z.string(),
  /**
   * True when the evidence must be revalidated before reuse (always true
   * after a process restart — Studio peer IDs and live connections are
   * ephemeral and are never persisted).
   */
  needsRevalidation: z.boolean(),
});
export type ReadinessEvidence = z.infer<typeof ReadinessEvidenceSchema>;

// ── Quality findings (persistent summary only) ─────────────────
// Persisted through MissionState (the single persistence system):
// quality requirements snapshots, critic findings, accepted/rejected
// state, repair linkage, and verification outcome. Never: secrets,
// ephemeral Studio IDs, raw transcripts, or transient process handles.

export const QualityFindingRecordSchema = z.object({
  id: z.string().min(1).max(100),
  missionId: z.string().min(1).max(100),
  dimension: z.enum(["visual", "ux", "gameplay", "technical"]),
  severity: z.enum(["blocking", "major", "minor", "stretch"]),
  evidence: z.string().min(1).max(2000),
  affectedArea: z.string().max(500).default(""),
  violatedRequirement: z.string().min(1).max(200),
  why: z.string().min(1).max(1000),
  proposedOwner: z.string().min(1).max(50),
  repairObjective: z.string().min(1).max(1000),
  verificationRequirement: z.string().min(1).max(1000),
  /** Accepted, rejected (with rationale), or still open. */
  status: z.enum(["open", "accepted", "rejected", "fixed", "escalated"]).default("open"),
  /** Delegation/task ID that performed the repair (repair linkage). */
  repairDelegationId: z.string().max(100).optional(),
  /** Verification outcome after repair. */
  verificationOutcome: z.string().max(500).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QualityFindingRecord = z.infer<typeof QualityFindingRecordSchema>;

export const MAX_QUALITY_FINDINGS = 100;

// ── Quality stage status (persistent explicit stage) ───────────────
// The production quality stage (review → repair → re-review → gate) is
// an explicit mission stage. Only the status summary persists here —
// findings persist as QualityFindingRecords, repair links on the
// finding records, verification outcomes on the finding records.

export const QualityStageStatusSchema = z.enum([
  "not-started",
  "reviewing",
  "repairing",
  "re-reviewing",
  "passed",
  "blocked",
]);
export type QualityStageStatus = z.infer<typeof QualityStageStatusSchema>;

export const QualityStageRecordSchema = z.object({
  status: QualityStageStatusSchema,
  rounds: z.number().int().nonnegative(),
  summary: z.string().max(1000),
  productionPass: z.boolean(),
  updatedAt: z.string(),
});
export type QualityStageRecord = z.infer<typeof QualityStageRecordSchema>;

// ── Secret sanitization ──────────────────────────────────────

const SECRET_KEY_PATTERN = /token|secret|credential|password|passwd|apikey|api_key|api-key|auth|bearer|private_key|privatekey/i;

/**
 * Deep-strip secret-looking keys and ephemeral runtime identifiers from a
 * value before persistence. Returns a JSON-safe clone. Strings and numbers
 * pass through untouched (length bounds are enforced by the zod schemas) —
 * only object KEYS are filtered, so delegation results and other core
 * state are never truncated or altered.
 */
export function sanitizeForPersistence(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(sanitizeForPersistence);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      if (/^(instanceId|instance_id|peerId|peer_id|pid|processId|connectionId|playtestId)$/i.test(k)) continue;
      out[k.slice(0, 100)] = sanitizeForPersistence(v);
    }
    return out;
  }
  return value;
}

// ── Snapshot versioning / migration ──────────────────────────

export interface MigrationResult {
  data: Record<string, unknown>;
  migratedFrom: number | null;
  degraded: boolean;
  notes: string[];
}

export class SnapshotVersionError extends Error {
  constructor(
    message: string,
    public readonly foundVersion: unknown,
  ) {
    super(message);
    this.name = "SnapshotVersionError";
  }
}

/**
 * Migrate a parsed (but unvalidated) snapshot to the current version.
 *
 * - v0 (no `version` field): fill new memory fields with empty defaults.
 * - v1: pass through.
 * - future (version > CURRENT): throw SnapshotVersionError → caller must
 *   surface structured BLOCKED/NEEDS_HUMAN, never silently discard data.
 */
export function migrateSnapshot(parsed: unknown): MigrationResult {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SnapshotVersionError("Snapshot is not an object; refusing to migrate.", undefined);
  }
  const data = parsed as Record<string, unknown>;
  const notes: string[] = [];
  const rawVersion = data.version;

  if (rawVersion === undefined) {
    notes.push("v0 snapshot (no version field): defaulting artifacts/decisions/repairRecords to empty.");
    return {
      data: {
        ...data,
        version: PERSISTED_SNAPSHOT_VERSION,
        artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
        decisions: Array.isArray(data.decisions) ? data.decisions : [],
        repairRecords: Array.isArray(data.repairRecords) ? data.repairRecords : [],
        supervisorDecisions: Array.isArray(data.supervisorDecisions) ? data.supervisorDecisions : [],
        escalationEvents: Array.isArray(data.escalationEvents) ? data.escalationEvents : [],
        qualityFindings: Array.isArray(data.qualityFindings) ? data.qualityFindings : [],
        qualityStage: null,
      },
      migratedFrom: 0,
      degraded: false,
      notes,
    };
  }

  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
    throw new SnapshotVersionError(`Snapshot version is not an integer: ${String(rawVersion)}`, rawVersion);
  }

  if (rawVersion > PERSISTED_SNAPSHOT_VERSION) {
    throw new SnapshotVersionError(
      `BLOCKED/NEEDS_HUMAN: snapshot version ${rawVersion} is newer than supported v${PERSISTED_SNAPSHOT_VERSION}. Refusing to load rather than discarding data.`,
      rawVersion,
    );
  }

  // v1: ensure new fields exist even if a v1 writer omitted them.
  let degraded = false;
  for (const field of ["artifacts", "decisions", "repairRecords", "supervisorDecisions", "escalationEvents", "qualityFindings"] as const) {
    if (data[field] === undefined) {
      data[field] = [];
      degraded = true;
      notes.push(`v1 snapshot missing "${field}": defaulted to empty.`);
    }
  }
  if (data.qualityStage === undefined) {
    data.qualityStage = null;
    degraded = true;
    notes.push(`v1 snapshot missing "qualityStage": defaulted to null.`);
  }
  return { data, migratedFrom: rawVersion, degraded, notes };
}
