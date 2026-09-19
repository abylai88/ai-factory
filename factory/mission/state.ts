import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  Mission,
  MissionSchema,
  ExecutionPlan,
  ExecutionPlanSchema,
  Delegation,
  DelegationSchema,
  AuditResult,
  AuditResultSchema,
  RepairPlan,
  RepairPlanSchema,
  MissionEvent,
  MissionStatus,
  DelegationStatus,
  VisualQaResult,
  VisualQaResultSchema,
  VisualQaEvidence,
  Diagnosis,
  DiagnosisSchema,
  DiagnosisRepairPlan,
  DiagnosisRepairPlanSchema,
} from "./mission.js";
import { normalizeVisualQaEvidence } from "./visual-qa-evidence.js";
import {
  PERSISTED_SNAPSHOT_VERSION,
  DecisionRecordSchema,
  MAX_DECISIONS,
  ReadinessEvidenceSchema,
  migrateSnapshot,
  sanitizeForPersistence,
  SnapshotVersionError,
  type DecisionRecord,
  type DecisionCategory,
  type ReadinessEvidence,
} from "./persisted-memory.js";
import { MissionArtifactSchema, type MissionArtifact } from "./artifact-store.js";
import { RepairRecordSchema, type RepairRecord } from "./repair-history.js";

export interface SupervisorDecisionRecord {
  id: string;
  type: string;
  reason: string;
  context: string;
  failureCount: number;
  recoveryCount: number;
  escalationLevel: number;
  result?: string;
}

export interface EscalationEventRecord {
  delegationId: string;
  reason: string;
}

export interface MissionSnapshot {
  version: number;
  mission: Mission;
  plan: ExecutionPlan | null;
  delegations: Delegation[];
  auditResults: Record<string, AuditResult>;
  repairPlans: Record<string, RepairPlan>;
  currentDelegationIndex: number;
  diagnosis: Diagnosis | null;
  diagnosisRepairPlan: DiagnosisRepairPlan | null;
  repairCycleCount: number;
  /** Persisted artifact metadata (summaries only — never file contents). */
  artifacts: MissionArtifact[];
  /** Persisted key decisions (structured summaries — never raw chatter). */
  decisions: DecisionRecord[];
  /** Persisted repair ledger (survives restart for repeat detection). */
  repairRecords: RepairRecord[];
  supervisorDecisions: SupervisorDecisionRecord[];
  escalationEvents: EscalationEventRecord[];
  readinessEvidence: ReadinessEvidence | null;
  updatedAt: string;
}

/** How the current in-memory state was loaded (observability, Hermes). */
export interface PersistenceInfo {
  snapshotVersion: number | null;
  migratedFrom: number | null;
  degraded: boolean;
  notes: string[];
  usedBackup: boolean;
}

const MISSION_EVENT_SCHEMA = z.object({
  id: z.string(),
  occurredAt: z.string(),
  missionId: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const SNAPSHOT_SCHEMA = z.object({
  version: z.number().int().nonnegative().optional(),
  mission: MissionSchema,
  plan: ExecutionPlanSchema.nullable(),
  delegations: z.array(DelegationSchema),
  auditResults: z.record(z.string(), AuditResultSchema),
  repairPlans: z.record(z.string(), RepairPlanSchema),
  currentDelegationIndex: z.number().int().nonnegative(),
  diagnosis: DiagnosisSchema.nullable().optional(),
  diagnosisRepairPlan: DiagnosisRepairPlanSchema.nullable().optional(),
  repairCycleCount: z.number().int().nonnegative().optional(),
  artifacts: z.array(MissionArtifactSchema).optional(),
  decisions: z.array(DecisionRecordSchema).optional(),
  repairRecords: z.array(RepairRecordSchema).optional(),
  supervisorDecisions: z.array(z.object({
    id: z.string(),
    type: z.string(),
    reason: z.string(),
    context: z.string(),
    failureCount: z.number(),
    recoveryCount: z.number(),
    escalationLevel: z.number(),
    result: z.string().optional(),
  })).optional(),
  escalationEvents: z.array(z.object({
    delegationId: z.string(),
    reason: z.string(),
  })).optional(),
  readinessEvidence: ReadinessEvidenceSchema.nullable().optional(),
  updatedAt: z.string(),
});

function sanitizeMissionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export class MissionState {
  private readonly missionsDir: string;
  private readonly missionId: string;
  private readonly jsonlPath: string;
  private readonly snapshotPath: string;
  private readonly snapshotTmpPath: string;
  private readonly snapshotBakPath: string;
  private readonly lockPath: string;
  private readonly disableLock: boolean;
  private lockFd: fs.FileHandle | null = null;
  private persistenceInfo: PersistenceInfo = {
    snapshotVersion: null,
    migratedFrom: null,
    degraded: false,
    notes: [],
    usedBackup: false,
  };
  /**
   * In-process write mutex: parallel delegations complete concurrently,
   * so snapshot writes must be serialized. Without this, two overlapping
   * saveSnapshot calls race on the temp file and one rename fails with
   * ENOENT (or a stale snapshot overwrites a newer one).
   */
  private writeQueue: Promise<void> = Promise.resolve();
  private snapshotTmpCounter = 0;

  private mission: Mission;
  private plan: ExecutionPlan | null = null;
  private delegations: Delegation[] = [];
  private auditResults: Record<string, AuditResult> = {};
  private repairPlans: Record<string, RepairPlan> = {};
  private diagnosis: Diagnosis | null = null;
  private diagnosisRepairPlan: DiagnosisRepairPlan | null = null;
  private repairCycleCount = 0;
  private artifacts: MissionArtifact[] = [];
  private decisions: DecisionRecord[] = [];
  private repairRecords: RepairRecord[] = [];
  private readinessEvidence: ReadinessEvidence | null = null;
  private supervisorDecisions: SupervisorDecisionRecord[] = [];
  private escalationEvents: EscalationEventRecord[] = [];

  constructor(baseDir: string, missionId: string, options?: { disableLock?: boolean }) {
    const sanitized = sanitizeMissionId(missionId);
    this.missionsDir = path.join(baseDir, "outputs", "missions");
    this.missionId = sanitized;
    this.jsonlPath = path.join(this.missionsDir, `${sanitized}.jsonl`);
    this.snapshotPath = path.join(this.missionsDir, `${sanitized}.state.json`);
    this.snapshotTmpPath = path.join(this.missionsDir, `${sanitized}.state.json.tmp`);
    this.snapshotBakPath = path.join(this.missionsDir, `${sanitized}.state.json.bak`);
    this.lockPath = path.join(this.missionsDir, `${sanitized}.lock`);
    this.disableLock = options?.disableLock ?? (process.env.MISSION_DISABLE_LOCK === "true");

    this.mission = {
      id: sanitized,
      goal: `mission-${sanitized}`,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentDelegationIndex: 0,
      repairCycleCount: 0,
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(this.missionsDir, { recursive: true });

    if (!this.disableLock) {
      // Acquire exclusive lock to prevent concurrent mission execution
      await this._acquireLock();
    }

    let snapshotLoaded = false;
    let snapshotTime: string | null = null;

    try {
      await this.loadFromSnapshot();
      snapshotLoaded = true;
      snapshotTime = this.mission.updatedAt;
    } catch (err) {
      // A newer-than-supported snapshot version is a hard BLOCKED: never
      // fall back to JSONL replay (which would overwrite newer data).
      if (err instanceof SnapshotVersionError) throw err;
      // No valid snapshot, will do full JSONL replay
    }

    // Always replay JSONL events after snapshot time (if snapshot loaded) or from start
    await this.loadFromJsonl(snapshotLoaded ? snapshotTime : null);
  }

  private async _acquireLock(): Promise<void> {
    // Use O_EXCL flag to create lock file exclusively
    // This prevents concurrent processes from running the same mission
    try {
      this.lockFd = await fs.open(this.lockPath, "wx");
      // Write PID to lock file for debugging
      await this.lockFd.write(`${process.pid}\n`);
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "EEXIST") {
        // Lock file exists - another process owns this mission
        const existingPid = await fs.readFile(this.lockPath, "utf8").catch(() => "unknown");
        throw new Error(`Mission ${this.missionId} is already running (PID: ${existingPid.trim()}). Cannot start concurrent execution.`);
      }
      throw err;
    }
  }

  /**
   * Release the mission lock. Call this when the mission is no longer needed
   * to allow other processes to acquire the lock.
   */
  async releaseLock(): Promise<void> {
    await this._releaseLock();
  }

  private async _releaseLock(): Promise<void> {
    if (this.disableLock) return;
    if (this.lockFd !== null) {
      try {
        await this.lockFd.close();
      } catch {
        // Ignore close errors
      }
      this.lockFd = null;
      try {
        await fs.unlink(this.lockPath);
      } catch {
        // Ignore unlink errors
      }
    }
  }

  private applySnapshotData(validated: z.infer<typeof SNAPSHOT_SCHEMA>): void {
    this.mission = validated.mission;
    this.plan = validated.plan;
    this.delegations = validated.delegations;
    this.auditResults = validated.auditResults;
    this.repairPlans = validated.repairPlans;
    this.diagnosis = validated.diagnosis ?? null;
    this.diagnosisRepairPlan = validated.diagnosisRepairPlan ?? null;
    this.repairCycleCount = validated.repairCycleCount ?? 0;
    this.artifacts = validated.artifacts ?? [];
    this.decisions = validated.decisions ?? [];
    this.repairRecords = validated.repairRecords ?? [];
    this.supervisorDecisions = validated.supervisorDecisions ?? [];
    this.escalationEvents = validated.escalationEvents ?? [];
    this.readinessEvidence = validated.readinessEvidence ?? null;
  }

  private async loadFromSnapshot(): Promise<void> {
    // Primary snapshot first, last-known-good backup second. A newer-than-
    // supported version is a hard BLOCKED (never silently discard data).
    const candidates: Array<{ file: string; backup: boolean }> = [
      { file: this.snapshotPath, backup: false },
      { file: this.snapshotBakPath, backup: true },
    ];
    let lastError: unknown = null;
    for (const { file, backup } of candidates) {
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch (err) {
        lastError = err;
        continue;
      }
      let migrated: ReturnType<typeof migrateSnapshot>;
      try {
        migrated = migrateSnapshot(parsedJson);
      } catch (err) {
        if (err instanceof SnapshotVersionError) throw err;
        lastError = err;
        continue;
      }
      const validated = SNAPSHOT_SCHEMA.safeParse(migrated.data);
      if (!validated.success) {
        lastError = validated.error;
        continue;
      }
      this.applySnapshotData(validated.data);
      this.persistenceInfo = {
        snapshotVersion: PERSISTED_SNAPSHOT_VERSION,
        migratedFrom: migrated.migratedFrom,
        degraded: migrated.degraded,
        notes: migrated.notes,
        usedBackup: backup,
      };
      return;
    }
    throw lastError ?? new Error("No snapshot found");
  }

  private async loadFromJsonl(afterTime: string | null = null): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.jsonlPath, "utf8");
    } catch {
      return;
    }

    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        // Skip events that occurred before or at the snapshot time
        if (afterTime && event.occurredAt && event.occurredAt <= afterTime) {
          continue;
        }
        this.applyEvent(event);
      } catch {
        continue;
      }
    }

    await this.saveSnapshot();
  }

  private applyEvent(event: unknown): void {
    const parsed = MISSION_EVENT_SCHEMA.safeParse(event);
    if (!parsed.success) return;

    const { type, payload } = parsed.data;

    switch (type) {
      case "mission.created":
        this.mission = { ...this.mission, ...payload } as Mission;
        break;
      case "mission.planned":
        this.plan = payload as ExecutionPlan;
        this.mission.planId = this.plan.id;
        this.mission.status = "planned";
        break;
      case "mission.approved":
        this.mission.status = "approved";
        break;
      case "mission.started":
        this.mission.status = "running";
        break;
      case "delegation.created":
        this.delegations.push(payload as Delegation);
        break;
      case "delegation.started":
        this.updateDelegation(payload.delegationId as string, {
          status: "running",
          startedAt: new Date().toISOString(),
          pipelineId: payload.pipelineId as string | undefined,
        });
        break;
      case "delegation.completed":
        this.updateDelegation(payload.delegationId as string, {
          status: payload.status as DelegationStatus,
          finishedAt: new Date().toISOString(),
          result: payload.result as string | undefined,
          error: payload.error as string | undefined,
        });
        break;
      case "mission.auditing":
        this.mission.status = "auditing";
        break;
      case "mission.audit.passed":
        this.auditResults[payload.delegationId as string] = payload.auditResult as AuditResult;
        this.mission.status = "running";
        break;
      case "mission.audit.failed":
        this.auditResults[payload.delegationId as string] = payload.auditResult as AuditResult;
        this.mission.status = "repairing";
        break;
      case "mission.repairing":
        this.repairPlans[payload.delegationId as string] = payload.repairPlan as RepairPlan;
        this.mission.status = "repairing";
        break;
      case "mission.completed":
        this.mission.status = "completed";
        break;
      case "mission.failed":
        this.mission.status = "failed";
        break;
      case "mission.visual_qa.started":
        this.mission.status = "auditing";
        break;
      case "mission.visual_qa.completed":
      case "mission.visual_qa.failed":
        if (payload.visualQa) {
          this.mission.visualQa = payload.visualQa as VisualQaResult;
        }
        if (payload.visualQaEvidence) {
          this.mission.visualQaEvidence = payload.visualQaEvidence as VisualQaEvidence;
        }
        break;
      case "mission.visual_qa.skipped":
        if (payload.visualQa) {
          this.mission.visualQa = payload.visualQa as VisualQaResult;
        }
        if (payload.visualQaEvidence) {
          this.mission.visualQaEvidence = payload.visualQaEvidence as VisualQaEvidence;
        }
        break;
      case "mission.diagnosis.started":
        this.mission.status = "diagnosis-planned";
        break;
      case "mission.diagnosis.completed":
        if (payload.diagnosis) {
          this.diagnosis = payload.diagnosis as Diagnosis;
          this.mission.diagnosis = payload.diagnosis as Diagnosis;
        }
        if (payload.repairPlan) {
          this.diagnosisRepairPlan = payload.repairPlan as DiagnosisRepairPlan;
          this.mission.diagnosisRepairPlan = payload.repairPlan as DiagnosisRepairPlan;
        }
        this.mission.status = "diagnosis-planned";
        break;
      case "mission.repair.started":
        this.mission.status = "repairing";
        this.repairCycleCount = (payload.cycle as number) ?? this.repairCycleCount;
        this.mission.repairCycleCount = this.repairCycleCount;
        break;
      case "mission.repair.completed":
        this.mission.status = "running";
        this.repairCycleCount = (payload.cycle as number) ?? this.repairCycleCount;
        this.mission.repairCycleCount = this.repairCycleCount;
        if (payload.changedFiles) {
          (this.mission as any).repairExecutionResult = {
            status: payload.status,
            changedFiles: payload.changedFiles,
            actionsCompleted: payload.actionsCompleted,
            actionsFailed: payload.actionsFailed,
          };
        }
        break;
      case "mission.repair.failed":
        this.mission.status = "repairing";
        this.repairCycleCount = (payload.cycle as number) ?? this.repairCycleCount;
        this.mission.repairCycleCount = this.repairCycleCount;
        break;
      case "mission.supervisor.decision":
        // Persist supervisor decision for audit trail
        if (!this.supervisorDecisions) this.supervisorDecisions = [];
        this.supervisorDecisions.push({
          id: String(payload.delegationId),
          type: String(payload.decisionType),
          reason: String(payload.reason),
          context: String(payload.context),
          failureCount: Number(payload.failureCount),
          recoveryCount: Number(payload.recoveryCount),
          escalationLevel: Number(payload.escalationLevel),
          result: String(payload.result),
        });
        break;

      case "delegation.escalated":
        // Persist escalation event for audit trail
        if (!this.escalationEvents) this.escalationEvents = [];
        this.escalationEvents.push({
          delegationId: String(payload.delegationId),
          reason: String(payload.reason),
        });
        break;

      case "mission.resumed":
        // Mission was resumed — update status to running
        this.mission.status = "running";
        break;

      case "mission.artifact.registered":
        if (payload.artifact) {
          const parsed = MissionArtifactSchema.safeParse(payload.artifact);
          if (parsed.success && !this.artifacts.some((a) => a.id === parsed.data.id)) {
            this.artifacts.push(parsed.data);
          }
        }
        break;

      case "mission.decision.recorded":
        if (payload.decision) {
          const parsed = DecisionRecordSchema.safeParse(payload.decision);
          if (parsed.success && !this.decisions.some((d) => d.id === parsed.data.id)) {
            this.decisions.push(parsed.data);
          }
        }
        break;

      case "mission.repair.recorded":
        if (payload.repairRecord) {
          const parsed = RepairRecordSchema.safeParse(payload.repairRecord);
          if (parsed.success && !this.repairRecords.some((r) => r.id === parsed.data.id)) {
            this.repairRecords.push(parsed.data);
          }
        }
        break;

      case "mission.readiness.recorded":
        if (payload.readiness) {
          const parsed = ReadinessEvidenceSchema.safeParse(payload.readiness);
          if (parsed.success) {
            this.readinessEvidence = parsed.data;
          }
        }
        break;
    }

    this.mission.updatedAt = new Date().toISOString();
  }

  private updateDelegation(delegationId: string, patch: Partial<Delegation>): void {
    const idx = this.delegations.findIndex((d) => d.id === delegationId);
    if (idx >= 0) {
      this.delegations[idx] = { ...this.delegations[idx], ...patch };
    }
  }

  async appendEvent(event: Omit<MissionEvent, "id" | "occurredAt">): Promise<void> {
    return this.withWriteLock(async () => {
      const fullEvent = {
        id: `evt-${randomUUID().slice(0, 8)}`,
        occurredAt: new Date().toISOString(),
        ...event,
      };

      await fs.appendFile(this.jsonlPath, JSON.stringify(fullEvent) + "\n", "utf8");
      this.applyEvent(fullEvent);
      await this.saveSnapshotUnsafe();
    });
  }

  private async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async saveSnapshot(): Promise<void> {
    return this.withWriteLock(() => this.saveSnapshotUnsafe());
  }

  private async saveSnapshotUnsafe(): Promise<void> {
    // Sanitize secrets/ephemeral ids out of the free-text memory fields.
    // Core mission/delegation state passes through byte-identical (only
    // object keys are filtered, never string values).
    const snapshot: MissionSnapshot = {
      version: PERSISTED_SNAPSHOT_VERSION,
      mission: this.mission,
      plan: this.plan,
      delegations: this.delegations,
      auditResults: this.auditResults,
      repairPlans: this.repairPlans,
      currentDelegationIndex: this.mission.currentDelegationIndex,
      diagnosis: this.diagnosis,
      diagnosisRepairPlan: this.diagnosisRepairPlan,
      repairCycleCount: this.repairCycleCount,
      artifacts: sanitizeForPersistence(this.artifacts) as MissionArtifact[],
      decisions: sanitizeForPersistence(this.decisions) as DecisionRecord[],
      repairRecords: sanitizeForPersistence(this.repairRecords) as RepairRecord[],
      supervisorDecisions: this.supervisorDecisions,
      escalationEvents: this.escalationEvents,
      readinessEvidence: this.readinessEvidence
        ? (sanitizeForPersistence(this.readinessEvidence) as ReadinessEvidence)
        : null,
      updatedAt: new Date().toISOString(),
    };

    const validated = SNAPSHOT_SCHEMA.parse(snapshot);

    // Atomic write: validate in memory → write temp file → rotate the
    // previous snapshot to .bak → rename temp into place. A crash mid-write
    // can only leave a stray .tmp (ignored on load); the last valid state
    // is never destroyed. The temp name is unique per write so overlapping
    // writers (separate processes with locks disabled, e.g. tests) cannot
    // steal each other's temp file.
    const payload = JSON.stringify(validated, null, 2);
    const tmpPath = `${this.snapshotTmpPath}.${process.pid}.${this.snapshotTmpCounter++}.tmp`;
    await fs.writeFile(tmpPath, payload, "utf8");
    try {
      await fs.copyFile(this.snapshotPath, this.snapshotBakPath);
    } catch {
      // No previous snapshot yet — nothing to back up.
    }
    try {
      await fs.rename(tmpPath, this.snapshotPath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true });
      throw err;
    }
  }

  /** How the current state was loaded (version, migration, backup use). */
  getPersistenceInfo(): PersistenceInfo {
    return { ...this.persistenceInfo, notes: [...this.persistenceInfo.notes] };
  }

  getMission(): Mission {
    return { ...this.mission };
  }

  getPlan(): ExecutionPlan | null {
    return this.plan ? { ...this.plan } : null;
  }

  getDelegations(): Delegation[] {
    return this.delegations.map((d) => ({ ...d }));
  }

  getDelegation(id: string): Delegation | undefined {
    return this.delegations.find((d) => d.id === id) ? { ...this.delegations.find((d) => d.id === id)! } : undefined;
  }

  getPendingDelegations(): Delegation[] {
    return this.delegations.filter((d) => d.status === "queued");
  }

  getRunningDelegations(): Delegation[] {
    return this.delegations.filter((d) => d.status === "running");
  }

  getAuditResult(delegationId: string): AuditResult | undefined {
    return this.auditResults[delegationId] ? { ...this.auditResults[delegationId] } : undefined;
  }

  getRepairPlan(delegationId: string): RepairPlan | undefined {
    return this.repairPlans[delegationId] ? { ...this.repairPlans[delegationId] } : undefined;
  }

  getVisualQaResult(): VisualQaResult | undefined {
    return this.mission.visualQa ? { ...this.mission.visualQa } : undefined;
  }

  getVisualQaEvidence(): VisualQaEvidence | undefined {
    return this.mission.visualQaEvidence ? { ...this.mission.visualQaEvidence } : undefined;
  }

  getDiagnosis(): Diagnosis | null {
    return this.diagnosis ? { ...this.diagnosis } : null;
  }

  getDiagnosisRepairPlan(): DiagnosisRepairPlan | null {
    return this.diagnosisRepairPlan ? { ...this.diagnosisRepairPlan } : null;
  }

  getRepairCycleCount(): number {
    return this.repairCycleCount;
  }

  // ── Persisted memory: artifacts / decisions / repairs / readiness ──
  // These survive process restarts via the versioned atomic snapshot.
  // Snapshots are written on meaningful transitions only (registration,
  // decision, repair attempt, readiness change) — never per token/output.

  getArtifacts(): MissionArtifact[] {
    return this.artifacts.map((a) => ({ ...a }));
  }

  /**
   * Replace the persisted artifact set (e.g. after the orchestrator's
   * ArtifactStore registers new artifacts). Valid entries only; capped.
   */
  async syncArtifacts(list: MissionArtifact[]): Promise<{ imported: number; skipped: number }> {
    const valid: MissionArtifact[] = [];
    let skipped = 0;
    for (const item of list.slice(0, 100)) {
      const parsed = MissionArtifactSchema.safeParse(item);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      valid.push(parsed.data);
    }
    this.artifacts = valid;
    await this.saveSnapshot();
    return { imported: valid.length, skipped };
  }

  getDecisions(category?: DecisionCategory): DecisionRecord[] {
    const all = this.decisions.map((d) => ({ ...d }));
    return category ? all.filter((d) => d.category === category) : all;
  }

  async recordDecision(input: {
    category: DecisionCategory;
    title: string;
    detail: string;
    rationale?: string;
    alternatives?: string[];
    createdBy?: string;
  }): Promise<DecisionRecord> {
    const decision: DecisionRecord = {
      id: `dec-${randomUUID().slice(0, 8)}`,
      missionId: this.missionId,
      category: input.category,
      title: input.title.slice(0, 300),
      detail: input.detail.slice(0, 2000),
      rationale: input.rationale?.slice(0, 1000),
      alternatives: input.alternatives?.slice(0, 5).map((a) => a.slice(0, 300)),
      createdBy: input.createdBy?.slice(0, 100),
      createdAt: new Date().toISOString(),
    };
    const parsed = DecisionRecordSchema.parse(decision);
    this.decisions.push(parsed);
    // Bound: drop oldest, keep the most recent reasoning.
    while (this.decisions.length > MAX_DECISIONS) this.decisions.shift();
    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.decision.recorded",
      payload: { decision: parsed },
    });
    return parsed;
  }

  getRepairRecords(delegationId?: string): RepairRecord[] {
    const all = this.repairRecords.map((r) => ({ ...r }));
    return delegationId ? all.filter((r) => r.delegationId === delegationId) : all;
  }

  /**
   * Replace the persisted repair ledger (e.g. after the orchestrator's
   * RepairHistory records an attempt). Repeat detection therefore survives
   * restarts. Capped at 500 entries.
   */
  async syncRepairRecords(list: RepairRecord[]): Promise<{ imported: number; skipped: number }> {
    const valid: RepairRecord[] = [];
    let skipped = 0;
    for (const item of list.slice(0, 500)) {
      const parsed = RepairRecordSchema.safeParse(item);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      valid.push(parsed.data);
    }
    this.repairRecords = valid;
    await this.saveSnapshot();
    return { imported: valid.length, skipped };
  }

  getSupervisorDecisions(): SupervisorDecisionRecord[] {
    return this.supervisorDecisions.map((d) => ({ ...d }));
  }

  getEscalationEvents(): EscalationEventRecord[] {
    return this.escalationEvents.map((e) => ({ ...e }));
  }

  getReadinessEvidence(): ReadinessEvidence | null {
    return this.readinessEvidence ? { ...this.readinessEvidence } : null;
  }

  /**
   * Persist Roblox readiness evidence (summary only). Studio peer IDs,
   * live connections, and playtest handles are never stored — the schema
   * has no fields for them and the sanitizer strips them if smuggled in.
   */
  async recordReadinessEvidence(input: {
    projectDir: string;
    artifactPath?: string;
    artifactFresh?: boolean;
    evidence: string;
  }): Promise<ReadinessEvidence> {
    const readiness: ReadinessEvidence = {
      projectDir: input.projectDir.slice(0, 500),
      artifactPath: input.artifactPath?.slice(0, 500),
      artifactFresh: input.artifactFresh,
      evidence: input.evidence.slice(0, 1000),
      recordedAt: new Date().toISOString(),
      needsRevalidation: false,
    };
    const parsed = ReadinessEvidenceSchema.parse(readiness);
    this.readinessEvidence = parsed;
    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.readiness.recorded",
      payload: { readiness: parsed },
    });
    return parsed;
  }

  /**
   * Mark persisted readiness as stale (called on resume after a restart):
   * the artifact/decision summaries stay, but Studio liveness must be
   * revalidated rather than blindly reused.
   */
  async markReadinessStale(): Promise<void> {
    if (this.readinessEvidence) {
      this.readinessEvidence = { ...this.readinessEvidence, needsRevalidation: true };
      await this.saveSnapshot();
    }
  }

  /**
   * Secret-free status summary for external consumers (Hermes). Contains
   * counts, stages, and evidence references — never file contents, tokens,
   * or raw transcripts.
   */
  getStatusSummary(): {
    missionId: string;
    goal: string;
    status: string;
    project?: string;
    engine?: string;
    completedDelegations: number;
    totalDelegations: number;
    activeRole?: string;
    activeTask?: string;
    failureSummary?: string;
    repairAttempts: number;
    evidenceRefs: string[];
    updatedAt: string;
  } {
    const progress = this.getProgress();
    const running = this.delegations.find((d) => d.status === "running")
      ?? this.delegations.find((d) => d.status === "queued");
    const failed = [...this.delegations].reverse().find((d) => d.status === "failed");
    const evidenceRefs = this.artifacts
      .filter((a) => a.path)
      .map((a) => a.path as string)
      .slice(0, 10);
    return {
      missionId: this.mission.id,
      goal: this.mission.goal,
      status: this.mission.status,
      project: this.mission.context?.projectId,
      engine: this.mission.context?.engine,
      completedDelegations: progress.completed,
      totalDelegations: progress.total,
      activeRole: running?.role,
      activeTask: running?.title,
      failureSummary: failed?.error?.slice(0, 200) ?? this.mission.diagnosis?.summary.slice(0, 200),
      repairAttempts: this.repairRecords.length,
      evidenceRefs,
      updatedAt: this.mission.updatedAt,
    };
  }

  async setMission(mission: Mission): Promise<void> {
    this.mission = { ...mission };
    await this.appendEvent({ missionId: this.missionId, type: "mission.created", payload: this.mission });
  }

  async setPlan(plan: ExecutionPlan): Promise<void> {
    this.plan = { ...plan };
    this.mission.planId = plan.id;
    this.mission.status = "planned";
    await this.appendEvent({ missionId: this.missionId, type: "mission.planned", payload: this.plan });
  }

  async addDelegation(delegation: Delegation): Promise<void> {
    // Prevent duplicate delegation IDs
    const existing = this.delegations.find(d => d.id === delegation.id);
    if (existing) {
      throw new Error(`Delegation with ID ${delegation.id} already exists`);
    }
    await this.appendEvent({ missionId: this.missionId, type: "delegation.created", payload: delegation });
  }

  async startDelegation(delegationId: string, pipelineId: string): Promise<void> {
    this.updateDelegation(delegationId, { status: "running", startedAt: new Date().toISOString(), pipelineId });
    await this.appendEvent({ missionId: this.missionId, type: "delegation.started", payload: { delegationId, pipelineId } });
  }

  async completeDelegation(delegationId: string, status: DelegationStatus, result?: string, error?: string): Promise<void> {
    this.updateDelegation(delegationId, { status, finishedAt: new Date().toISOString(), result, error });
    await this.appendEvent({ missionId: this.missionId, type: "delegation.completed", payload: { delegationId, status, result, error } });
  }

  async startAudit(delegationId: string): Promise<void> {
    this.mission.status = "auditing";
    await this.appendEvent({ missionId: this.missionId, type: "mission.auditing", payload: { delegationId } });
  }

  async recordAuditPassed(delegationId: string, auditResult: AuditResult): Promise<void> {
    this.auditResults[delegationId] = { ...auditResult };
    this.mission.status = "running";
    await this.appendEvent({ missionId: this.missionId, type: "mission.audit.passed", payload: { delegationId, auditResult } });
  }

  async recordAuditFailed(delegationId: string, auditResult: AuditResult): Promise<void> {
    this.auditResults[delegationId] = { ...auditResult };
    this.mission.status = "repairing";
    await this.appendEvent({ missionId: this.missionId, type: "mission.audit.failed", payload: { delegationId, auditResult } });
  }

  async startRepair(delegationId: string, repairPlan: RepairPlan): Promise<void> {
    this.repairPlans[delegationId] = { ...repairPlan };
    this.mission.status = "repairing";
    await this.appendEvent({ missionId: this.missionId, type: "mission.repairing", payload: { delegationId, repairPlan } });
  }

  async incrementRepairIteration(delegationId: string): Promise<void> {
    if (this.repairPlans[delegationId]) {
      this.repairPlans[delegationId].iteration += 1;
      await this.saveSnapshot();
    }
  }

  async completeMission(status: "completed" | "failed"): Promise<void> {
    this.mission.status = status;
    await this.appendEvent({ missionId: this.missionId, type: status === "completed" ? "mission.completed" : "mission.failed", payload: {} });
    await this._releaseLock();
  }

  async approveMission(): Promise<void> {
    this.mission.status = "approved";
    await this.appendEvent({ missionId: this.missionId, type: "mission.approved", payload: {} });
  }

  async startMission(): Promise<void> {
    this.mission.status = "running";
    await this.appendEvent({ missionId: this.missionId, type: "mission.started", payload: {} });
  }

  async recordVisualQaStarted(): Promise<void> {
    this.mission.status = "auditing";
    await this.appendEvent({ missionId: this.missionId, type: "mission.visual_qa.started", payload: {} });
  }

  async recordVisualQaResult(visualQa: VisualQaResult): Promise<void> {
    this.mission.visualQa = { ...visualQa };
    this.mission.visualQaEvidence = normalizeVisualQaEvidence(visualQa);
    const eventType = visualQa.status === "passed"
      ? "mission.visual_qa.completed"
      : visualQa.status === "skipped"
        ? "mission.visual_qa.skipped"
        : "mission.visual_qa.failed";
    await this.appendEvent({ missionId: this.missionId, type: eventType, payload: { visualQa, visualQaEvidence: this.mission.visualQaEvidence } });
  }

  async updateDelegationIndex(index: number): Promise<void> {
    this.mission.currentDelegationIndex = index;
    await this.saveSnapshot();
  }

  async recordDiagnosisStarted(): Promise<void> {
    this.mission.status = "diagnosis-planned";
    await this.appendEvent({ missionId: this.missionId, type: "mission.diagnosis.started", payload: {} });
  }

  async recordDiagnosisCompleted(diagnosis: Diagnosis, repairPlan: DiagnosisRepairPlan): Promise<void> {
    this.diagnosis = { ...diagnosis };
    this.diagnosisRepairPlan = { ...repairPlan };
    this.mission.diagnosis = { ...diagnosis };
    this.mission.diagnosisRepairPlan = { ...repairPlan };
    this.mission.status = "diagnosis-planned";
    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.diagnosis.completed",
      payload: {
        diagnosisId: diagnosis.id,
        category: diagnosis.category,
        severity: diagnosis.severity,
        confidence: diagnosis.confidence,
        repairPlanId: repairPlan.id,
        actionCount: repairPlan.actions.length,
        diagnosis,
        repairPlan,
      },
    });
  }

  async recordRepairStarted(repairPlanId: string, cycle: number): Promise<void> {
    this.mission.status = "repairing";
    this.repairCycleCount = cycle;
    this.mission.repairCycleCount = cycle;
    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.repair.started",
      payload: { repairPlanId, cycle },
    });
  }

  async recordRepairCompleted(
    repairPlanId: string,
    cycle: number,
    result: {
      status: string;
      changedFiles: string[];
      actionsCompleted: number;
      actionsFailed: number;
    }
  ): Promise<void> {
    this.mission.status = "running";
    this.repairCycleCount = cycle;
    this.mission.repairCycleCount = cycle;
    (this.mission as any).repairExecutionResult = result;
    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.repair.completed",
      payload: { repairPlanId, cycle, ...result },
    });
  }

  async recordRepairFailed(repairPlanId: string, cycle: number, error: string): Promise<void> {
    this.mission.status = "repairing";
    this.repairCycleCount = cycle;
    this.mission.repairCycleCount = cycle;
    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.repair.failed",
      payload: { repairPlanId, cycle, error },
    });
  }

  /**
   * Prepare a failed/crashed mission for resume.
   * Only resets "running" delegations to "queued" (interrupted mid-execution).
   * Preserves all historical completion, failure, repair, and artifact information.
   * Returns the loaded mission and plan for use by the orchestrator.
   */
  async prepareForResume(): Promise<{ mission: Mission; plan: ExecutionPlan | null; delegations: Delegation[] }> {
    let resetCount = 0;
    for (const del of this.delegations) {
      if (del.status === "running") {
        // Only reset running delegations — they were interrupted mid-execution
        del.status = "queued";
        del.startedAt = undefined;
        del.pipelineId = undefined;
        // Do NOT clear error, result, or outputs — preserve history
        resetCount++;
      }
      // "failed", "blocked", "passed", "queued" all stay as-is
    }

    // Ephemeral Studio/MCP state is never trusted across a restart:
    // persisted readiness summaries stay, but liveness must be revalidated.
    if (this.readinessEvidence && !this.readinessEvidence.needsRevalidation) {
      this.readinessEvidence = { ...this.readinessEvidence, needsRevalidation: true };
    }

    // Set mission status to running for resume
    if (this.mission.status === "failed" || this.mission.status === "blocked" || this.mission.status === "cancelled" || this.mission.status === "running") {
      this.mission.status = "running";
    }

    await this.appendEvent({
      missionId: this.missionId,
      type: "mission.resumed" as any,
      payload: {
        resetDelegations: resetCount,
        previousStatus: this.mission.status,
      },
    });

    return {
      mission: { ...this.mission },
      plan: this.plan ? { ...this.plan } : null,
      delegations: this.delegations.map((d) => ({ ...d })),
    };
  }

  /**
   * Check if a delegation has a partially produced artifact on disk.
   * Used during resume to determine if a delegation should be repaired
   * rather than re-run from scratch.
   */
  hasDelegationArtifact(delegationId: string): boolean {
    const del = this.delegations.find((d) => d.id === delegationId);
    if (!del) return false;
    // Check if the delegation has outputs or a result with content
    if (del.outputs && del.outputs.length > 0) return true;
    if (del.result && del.result.length > 0) return true;
    return false;
  }

  /**
   * Get all delegations that are eligible for resume processing.
   * Returns delegations that are not in a terminal success state.
   */
  getResumableDelegations(): Delegation[] {
    return this.delegations.filter((d) => d.status !== "passed");
  }

  /**
   * Count repair/retry delegations for a given delegation.
   * Repair delegations are identified by the retryOf field.
   */
  getRepairAttemptCount(delegationId: string): number {
    return this.delegations.filter((d) => d.retryOf === delegationId).length;
  }

  /**
   * Determine if a delegation's repair budget is exhausted.
   * Checks both the repair plan iteration count and the total number of
   * repair delegations (from supervisor, peer review, and audit-driven repairs).
   */
  isBudgetExhausted(delegationId: string): boolean {
    const maxRepairs = this.mission.constraints?.maxRepairs ?? 3;

    // Check repair plan iteration (audit-driven repairs)
    const repairPlan = this.repairPlans[delegationId];
    if (repairPlan && repairPlan.iteration >= (repairPlan.maxIterations ?? maxRepairs)) {
      return true;
    }

    // Count all repair delegations (supervisor, peer review, triage-driven)
    const repairCount = this.getRepairAttemptCount(delegationId);
    if (repairCount >= maxRepairs) {
      return true;
    }

    return false;
  }

  /**
   * Build resume state from persisted delegation history.
   * Returns three categories:
   * - completed: delegations that passed (skip on resume)
   * - failed: permanently failed delegations with exhausted budget (skip on resume)
   * - resumable: delegations that can be retried (failed with budget remaining, queued, or
   *   running→queued from prepareForResume). Blocked delegations are included here so
   *   the orchestrator can re-evaluate their dependency status.
   *
   * Repair delegations (retryOf set) are always skipped — if the original is retried,
   * new repair delegations will be created.
   */
  getResumeState(): { completed: Set<string>; failed: Set<string>; resumable: Set<string> } {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const resumable = new Set<string>();

    for (const del of this.delegations) {
      if (del.status === "passed") {
        completed.add(del.id);
      } else if (del.retryOf) {
        // Repair/retry delegation — always skip on resume.
        // If the original delegation is retried, new repairs will be created.
        failed.add(del.id);
      } else if (del.status === "failed") {
        if (this.isBudgetExhausted(del.id)) {
          failed.add(del.id);
        } else {
          resumable.add(del.id);
        }
      } else if (del.status === "blocked") {
        // Blocked delegations go into resumable so the orchestrator can
        // re-evaluate their dependency status (deps may have been repaired).
        resumable.add(del.id);
      } else {
        // "queued" or "running" (after prepareForResume reset)
        resumable.add(del.id);
      }
    }

    return { completed, failed, resumable };
  }

  isTerminal(): boolean {
    return ["completed", "failed", "blocked", "cancelled"].includes(this.mission.status);
  }

  getProgress(): { completed: number; total: number } {
    const total = this.delegations.length;
    const completed = this.delegations.filter((d) => d.status === "passed").length;
    return { completed, total };
  }
}