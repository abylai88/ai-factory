import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createMission,
  Mission,
  ExecutionPlan,
  Delegation,
  AuditResult,
  RepairPlan,
  MissionStatus,
  DelegationStatus,
  MissionEvent,
  MissionEventSink,
} from "../../../factory/mission/mission.js";
import { MissionState, MissionSnapshot } from "../../../factory/mission/state.js";
import { InMemoryEventSink } from "../../../factory/mission/events.js";
import { Planner, createPlanner } from "../../../factory/mission/planner.js";
import { ProjectProvisioner } from "../../../factory/mission/project-provisioner.js";
import type { EventBus } from "./events.js";

export interface MissionServiceConfig {
  factoryRoot: string;
  eventBus: EventBus;
}

export interface MissionListItem {
  id: string;
  goal: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  planId?: string;
  currentDelegationIndex: number;
  delegationCount: number;
  repairCount: number;
}

export interface MissionDetail {
  mission: Mission;
  plan: ExecutionPlan | null;
  delegations: Delegation[];
  auditResults: Record<string, AuditResult>;
  repairPlans: Record<string, RepairPlan>;
  recentEvents: MissionEvent[];
}

const ALLOWED_TEMPLATES = ["yagames-phaser-template"] as const;

export class MissionService {
  private readonly factoryRoot: string;
  private readonly eventBus: EventBus;
  private readonly missionsDir: string;
  private readonly provisioner: ProjectProvisioner;
  private readonly runningMissions = new Map<string, MissionState>();
  private readonly eventSinks = new Map<string, InMemoryEventSink>();

  constructor(config: MissionServiceConfig) {
    this.factoryRoot = config.factoryRoot;
    this.eventBus = config.eventBus;
    this.missionsDir = path.join(this.factoryRoot, "outputs", "missions");
    this.provisioner = new ProjectProvisioner({
      baseDir: config.factoryRoot,
      templatesDir: path.join(config.factoryRoot, "templates"),
      projectsDir: path.join(config.factoryRoot, "projects"),
      allowedTemplateIds: ALLOWED_TEMPLATES,
    });
  }

  async listMissions(): Promise<MissionListItem[]> {
    await fs.mkdir(this.missionsDir, { recursive: true });
    const files = await fs.readdir(this.missionsDir);
    const stateFiles = files.filter((f) => f.endsWith(".state.json"));

    const missions: MissionListItem[] = [];
    for (const file of stateFiles) {
      try {
        const data = await fs.readFile(path.join(this.missionsDir, file), "utf8");
        const snapshot = JSON.parse(data) as MissionSnapshot;
        const repairCount = Object.keys(snapshot.repairPlans).length;
        missions.push({
          id: snapshot.mission.id,
          goal: snapshot.mission.goal,
          status: snapshot.mission.status,
          createdAt: snapshot.mission.createdAt,
          updatedAt: snapshot.mission.updatedAt,
          planId: snapshot.mission.planId,
          currentDelegationIndex: snapshot.mission.currentDelegationIndex,
          delegationCount: snapshot.delegations.length,
          repairCount,
        });
      } catch {
        continue;
      }
    }

    return missions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getMission(missionId: string): Promise<MissionDetail | undefined> {
    if (!/^[A-Za-z0-9_-]+$/.test(missionId)) return undefined;

    const snapshotPath = path.join(this.missionsDir, `${missionId}.state.json`);
    try {
      await fs.access(snapshotPath);
    } catch {
      return undefined;
    }

    const state = new MissionState(this.factoryRoot, missionId);
    await state.init();

    const sink = this.eventSinks.get(missionId);
    const recentEvents = sink ? sink.recent().slice(0, 50) : [];

    return {
      mission: state.getMission(),
      plan: state.getPlan(),
      delegations: state.getDelegations(),
      auditResults: this.getAuditResults(state, missionId),
      repairPlans: this.getRepairPlans(state, missionId),
      recentEvents,
    };
  }

  private getAuditResults(state: MissionState, missionId: string): Record<string, AuditResult> {
    const delegations = state.getDelegations();
    const results: Record<string, AuditResult> = {};
    for (const del of delegations) {
      const auditResult = state.getAuditResult(del.id);
      if (auditResult) results[del.id] = auditResult;
    }
    return results;
  }

  private getRepairPlans(state: MissionState, missionId: string): Record<string, RepairPlan> {
    const delegations = state.getDelegations();
    const plans: Record<string, RepairPlan> = {};
    for (const del of delegations) {
      const repairPlan = state.getRepairPlan(del.id);
      if (repairPlan) plans[del.id] = repairPlan;
    }
    return plans;
  }

  async createMission(goal: string, projectId?: string): Promise<Mission> {
    if (!goal || goal.trim().length === 0) {
      throw new Error("Mission goal must be a non-empty string");
    }
    if (goal.length > 1000) {
      throw new Error("Mission goal must be 1000 characters or fewer");
    }

    if (projectId) {
      const projectPath = path.join(this.factoryRoot, "projects", projectId);
      const validation = await this.provisioner.validateProject(projectPath);
      if (!validation.valid) {
        throw new Error(`Project "${projectId}" is not found or invalid.`);
      }
    }

    const context = projectId ? { projectId } : undefined;
    const mission = createMission(goal.trim(), context);

    const state = new MissionState(this.factoryRoot, mission.id);
    await state.init();
    await state.setMission(mission);

    this.emitMissionEvent(mission.id, "mission.created", { mission });

    return mission;
  }

  async startMission(missionId: string): Promise<MissionDetail> {
    const snapshotPath = path.join(this.missionsDir, `${missionId}.state.json`);
    try {
      await fs.access(snapshotPath);
    } catch {
      throw new Error(`Mission "${missionId}" not found`);
    }

    const state = new MissionState(this.factoryRoot, missionId);
    await state.init();

    const mission = state.getMission();
    if (mission.status !== "draft" && mission.status !== "planned") {
      throw new Error(`Mission "${missionId}" cannot be started (status: ${mission.status})`);
    }

    const planner = createPlanner();
    let plan = state.getPlan();

    if (!plan) {
      plan = planner.decompose(mission);
      await state.setPlan(plan);
    }

    for (const del of plan.delegations) {
      const existing = state.getDelegation(del.id);
      if (!existing) {
        await state.addDelegation(del);
      }
    }

    if (mission.status === "draft") {
      await state.approveMission();
    }
    await state.startMission();

    const eventSink = new InMemoryEventSink();
    this.eventSinks.set(missionId, eventSink);
    this.runningMissions.set(missionId, state);

    this.bridgeMissionEvents(missionId, eventSink);

    return this.getMissionDetail(missionId, state, eventSink);
  }

  private bridgeMissionEvents(missionId: string, sink: InMemoryEventSink): void {
    sink.subscribe((event: MissionEvent) => {
      this.eventBus.publish({
        type: `mission.${event.type}` as never,
        severity: this.severityFor(event.type),
        payload: { missionId, ...event.payload },
      });
    });
  }

  private severityFor(type: MissionEvent["type"]): "info" | "warning" | "error" {
    if (type === "mission.failed" || type === "mission.audit.failed") return "error";
    if (type === "mission.repairing") return "warning";
    return "info";
  }

  private emitMissionEvent(missionId: string, type: string, payload: Record<string, unknown>): void {
    this.eventBus.publish({
      type: type as never,
      severity: type.includes("failed") ? "error" : "info",
      payload: { missionId, ...payload },
    });
  }

  private async getMissionDetail(missionId: string, state: MissionState, sink: InMemoryEventSink): Promise<MissionDetail> {
    const delegations = state.getDelegations();
    const auditResults: Record<string, AuditResult> = {};
    const repairPlans: Record<string, RepairPlan> = {};

    for (const del of delegations) {
      const audit = state.getAuditResult(del.id);
      if (audit) auditResults[del.id] = audit;
      const repair = state.getRepairPlan(del.id);
      if (repair) repairPlans[del.id] = repair;
    }

    return {
      mission: state.getMission(),
      plan: state.getPlan(),
      delegations,
      auditResults,
      repairPlans,
      recentEvents: sink.recent().slice(0, 50),
    };
  }
}
