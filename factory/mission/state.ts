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
} from "./mission.js";

export interface MissionSnapshot {
  mission: Mission;
  plan: ExecutionPlan | null;
  delegations: Delegation[];
  auditResults: Record<string, AuditResult>;
  repairPlans: Record<string, RepairPlan>;
  currentDelegationIndex: number;
  updatedAt: string;
}

const MISSION_EVENT_SCHEMA = z.object({
  id: z.string(),
  occurredAt: z.string(),
  missionId: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const SNAPSHOT_SCHEMA = z.object({
  mission: MissionSchema,
  plan: ExecutionPlanSchema.nullable(),
  delegations: z.array(DelegationSchema),
  auditResults: z.record(z.string(), AuditResultSchema),
  repairPlans: z.record(z.string(), RepairPlanSchema),
  currentDelegationIndex: z.number().int().nonnegative(),
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

  private mission: Mission;
  private plan: ExecutionPlan | null = null;
  private delegations: Delegation[] = [];
  private auditResults: Record<string, AuditResult> = {};
  private repairPlans: Record<string, RepairPlan> = {};

  constructor(baseDir: string, missionId: string) {
    const sanitized = sanitizeMissionId(missionId);
    this.missionsDir = path.join(baseDir, "outputs", "missions");
    this.missionId = sanitized;
    this.jsonlPath = path.join(this.missionsDir, `${sanitized}.jsonl`);
    this.snapshotPath = path.join(this.missionsDir, `${sanitized}.state.json`);

    this.mission = {
      id: sanitized,
      goal: `mission-${sanitized}`,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentDelegationIndex: 0,
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(this.missionsDir, { recursive: true });

    try {
      await this.loadFromSnapshot();
    } catch {
      await this.loadFromJsonl();
    }
  }

  private async loadFromSnapshot(): Promise<void> {
    const data = await fs.readFile(this.snapshotPath, "utf8");
    const parsed = JSON.parse(data);
    const validated = SNAPSHOT_SCHEMA.parse(parsed) as MissionSnapshot;

    this.mission = validated.mission;
    this.plan = validated.plan;
    this.delegations = validated.delegations;
    this.auditResults = validated.auditResults;
    this.repairPlans = validated.repairPlans;
  }

  private async loadFromJsonl(): Promise<void> {
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
    const fullEvent = {
      id: `evt-${randomUUID().slice(0, 8)}`,
      occurredAt: new Date().toISOString(),
      ...event,
    };

    await fs.appendFile(this.jsonlPath, JSON.stringify(fullEvent) + "\n", "utf8");
    this.applyEvent(fullEvent);
    await this.saveSnapshot();
  }

  async saveSnapshot(): Promise<void> {
    const snapshot: MissionSnapshot = {
      mission: this.mission,
      plan: this.plan,
      delegations: this.delegations,
      auditResults: this.auditResults,
      repairPlans: this.repairPlans,
      currentDelegationIndex: this.mission.currentDelegationIndex,
      updatedAt: new Date().toISOString(),
    };

    const validated = SNAPSHOT_SCHEMA.parse(snapshot);
    await fs.writeFile(this.snapshotPath, JSON.stringify(validated, null, 2), "utf8");
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
  }

  async approveMission(): Promise<void> {
    this.mission.status = "approved";
    await this.appendEvent({ missionId: this.missionId, type: "mission.approved", payload: {} });
  }

  async startMission(): Promise<void> {
    this.mission.status = "running";
    await this.appendEvent({ missionId: this.missionId, type: "mission.started", payload: {} });
  }

  async updateDelegationIndex(index: number): Promise<void> {
    this.mission.currentDelegationIndex = index;
    await this.saveSnapshot();
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