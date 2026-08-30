import {
  Mission,
  ExecutionPlan,
  Delegation,
  AgentResult,
  AuditResult,
  RepairPlan,
  MissionStatus,
  DelegationStatus,
  createAuditResult,
  createRepairPlan,
  AcceptanceCriteriaResult,
} from "./mission.js";
import { MissionState } from "./state.js";
import { MissionEventSink } from "./mission.js";
import { MissionEventPublisher, createMissionEventPublisher, MissionEventTypes } from "./events.js";
import { runGoal } from "../pipeline/pipeline-runner.js";

export interface FactoryExecutionAdapter {
  runDelegation(delegation: Delegation, mission: Mission, config: { baseDir: string; project: string; fromStep?: string }): Promise<AgentResult>;
}

export interface Auditor {
  audit(delegation: Delegation, result: AgentResult, mission: Mission, plan: ExecutionPlan): Promise<AuditResult>;
}

export interface OrchestratorConfig {
  maxRepairs: number;
  baseDir: string;
  project: string;
  factoryAdapter: FactoryExecutionAdapter;
  auditor: Auditor;
  eventSink: MissionEventSink;
  missionState: MissionState;
}

const DEFAULT_MAX_REPAIRS = 3;

export class MissionOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly publisher: MissionEventPublisher;
  private currentMission: Mission | null = null;
  private currentPlan: ExecutionPlan | null = null;
  private isRunning = false;

  constructor(config: OrchestratorConfig) {
    this.config = {
      maxRepairs: config.maxRepairs ?? DEFAULT_MAX_REPAIRS,
      baseDir: config.baseDir,
      project: config.project,
      factoryAdapter: config.factoryAdapter,
      auditor: config.auditor,
      eventSink: config.eventSink,
      missionState: config.missionState,
    };
    this.publisher = createMissionEventPublisher(this.config.eventSink);
  }

  async executeMission(mission: Mission, plan: ExecutionPlan): Promise<Mission> {
    this.currentMission = mission;
    this.currentPlan = plan;
    this.isRunning = true;

    await this.config.missionState.startMission();

    try {
      const sortedDelegations = this.topologicalSort(plan.delegations);

      for (let i = 0; i < sortedDelegations.length; i++) {
        if (!this.isRunning) break;

        const delegation = sortedDelegations[i];
        await this.config.missionState.updateDelegationIndex(i);

        const canRun = this.canRunDelegation(delegation);
        if (!canRun) {
          await this.config.missionState.completeDelegation(delegation.id, "blocked", undefined, "Dependencies not met");
          continue;
        }

        await this.executeDelegation(delegation);

        if (!this.isRunning) break;

        const auditResult = await this.auditDelegation(delegation);

        if (auditResult.status === "FAIL") {
          const repaired = await this.repairDelegation(delegation, auditResult);
          if (!repaired) {
            await this.config.missionState.completeMission("failed");
            this.currentMission = { ...this.currentMission!, status: "failed" };
            return this.currentMission;
          }

          const reauditResult = await this.auditDelegation(delegation);
          if (reauditResult.status === "FAIL") {
            await this.config.missionState.completeMission("failed");
            this.currentMission = { ...this.currentMission!, status: "failed" };
            return this.currentMission;
          }
        }
      }

      await this.config.missionState.completeMission("completed");
      this.currentMission = { ...this.currentMission!, status: "completed" };
      return this.currentMission;
    } finally {
      this.isRunning = false;
    }
  }

  async executeDelegation(delegation: Delegation): Promise<AgentResult> {
    await this.config.missionState.startDelegation(delegation.id, "");
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.DELEGATION_STARTED,
      payload: { delegationId: delegation.id, title: delegation.title },
    });

    const startTime = Date.now();
    let agentResult: AgentResult;

    try {
      await this.config.factoryAdapter.runDelegation(delegation, this.currentMission!, {
        baseDir: this.config.baseDir,
        project: this.config.project,
        fromStep: delegation.stepIds?.[0],
      });

      const updatedDelegation = this.config.missionState.getDelegation(delegation.id);
      const pipelineId = updatedDelegation?.pipelineId;

      agentResult = {
        delegationId: delegation.id,
        pipelineId,
        status: updatedDelegation?.status === "passed" ? "passed" : "failed",
        output: updatedDelegation?.result ?? "",
        error: updatedDelegation?.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      agentResult = {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }

    const finalStatus: DelegationStatus = agentResult.status === "passed" ? "passed" : "failed";
    await this.config.missionState.completeDelegation(delegation.id, finalStatus, agentResult.output, agentResult.error);

    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.DELEGATION_COMPLETED,
      payload: {
        delegationId: delegation.id,
        status: finalStatus,
        result: agentResult.output,
        error: agentResult.error,
      },
    });

    return agentResult;
  }

  async auditDelegation(delegation: Delegation): Promise<AuditResult> {
    await this.config.missionState.startAudit(delegation.id);
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.MISSION_AUDITING,
      payload: { delegationId: delegation.id },
    });

    const agentResult = await this.getAgentResult(delegation.id);
    const auditResult = await this.config.auditor.audit(delegation, agentResult, this.currentMission!, this.currentPlan!);

    if (auditResult.status === "PASS") {
      await this.config.missionState.recordAuditPassed(delegation.id, auditResult);
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.MISSION_AUDIT_PASSED,
        payload: { delegationId: delegation.id, auditResult },
      });
    } else {
      await this.config.missionState.recordAuditFailed(delegation.id, auditResult);
      this.publisher.publish({
        missionId: delegation.missionId,
        type: MissionEventTypes.MISSION_AUDIT_FAILED,
        payload: { delegationId: delegation.id, auditResult },
      });
    }

    return auditResult;
  }

  async repairDelegation(delegation: Delegation, auditResult: AuditResult): Promise<boolean> {
    const repairPlan = createRepairPlan(
      delegation.id,
      auditResult.recommendedRepair?.description ?? `Fix issues in ${delegation.title}`,
      auditResult.recommendedRepair?.focusAreas ?? ["Unknown"],
      this.config.maxRepairs
    );

    await this.config.missionState.startRepair(delegation.id, repairPlan);
    this.publisher.publish({
      missionId: delegation.missionId,
      type: MissionEventTypes.MISSION_REPAIRING,
      payload: { delegationId: delegation.id, repairPlan },
    });

    for (let iteration = 1; iteration <= this.config.maxRepairs; iteration++) {
      if (!this.isRunning) return false;

      await this.config.missionState.incrementRepairIteration(delegation.id);

      const repairDelegation = this.createRepairDelegation(delegation, repairPlan, iteration);

      await this.config.missionState.addDelegation(repairDelegation);
      await this.config.missionState.startDelegation(repairDelegation.id, "");
      const repairConfig = {
        baseDir: this.config.baseDir,
        project: this.config.project,
      };

      try {
        await this.config.factoryAdapter.runDelegation(repairDelegation, this.currentMission!, repairConfig);
      } catch {
        // Continue to next iteration
      }

      const updatedRepairDelegation = this.config.missionState.getDelegation(repairDelegation.id);
      const repairResult: AgentResult = {
        delegationId: repairDelegation.id,
        pipelineId: updatedRepairDelegation?.pipelineId,
        status: updatedRepairDelegation?.status === "passed" ? "passed" : "failed",
        output: updatedRepairDelegation?.result ?? "",
        error: updatedRepairDelegation?.error,
        durationMs: 0,
      };

      if (repairResult.status === "passed") {
        await this.config.missionState.completeDelegation(repairDelegation.id, "passed", repairResult.output);
        await this.config.missionState.completeDelegation(delegation.id, "passed", repairResult.output);
        return true;
      }

      await this.config.missionState.completeDelegation(repairDelegation.id, "failed", repairResult.output, repairResult.error);
    }

    return false;
  }

  private createRepairDelegation(original: Delegation, repairPlan: RepairPlan, iteration: number): Delegation {
    return {
      ...original,
      id: `repair-${original.id}-${iteration}`,
      title: `[REPAIR ${iteration}/${repairPlan.maxIterations}] ${original.title}`,
      description: `${repairPlan.description}\n\nFOCUS AREAS:\n${repairPlan.focusAreas.map((a) => `- ${a}`).join("\n")}\n\nITERATION: ${iteration}/${repairPlan.maxIterations}`,
      stepIds: undefined,
      dependsOn: [],
      parallelizable: false,
      acceptanceCriteria: [...original.acceptanceCriteria, "Repair verified by auditor"],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
  }

  private async getAgentResult(delegationId: string): Promise<AgentResult> {
    const delegation = this.config.missionState.getDelegation(delegationId);
    if (!delegation) {
      return {
        delegationId,
        status: "failed",
        output: "",
        error: "Delegation not found",
        durationMs: 0,
      };
    }
    return {
      delegationId,
      pipelineId: delegation.pipelineId,
      status: delegation.status === "passed" ? "passed" : "failed",
      output: delegation.result ?? "",
      error: delegation.error,
      durationMs: 0,
    };
  }

  private canRunDelegation(delegation: Delegation): boolean {
    for (const depId of delegation.dependsOn) {
      const dep = this.config.missionState.getDelegation(depId);
      if (!dep || dep.status !== "passed") {
        return false;
      }
    }
    return true;
  }

  private topologicalSort(delegations: Delegation[]): Delegation[] {
    const map = new Map<string, Delegation>(delegations.map((d: Delegation) => [d.id, d]));
    const visited = new Set<string>();
    const result: Delegation[] = [];

    function visit(id: string): void {
      if (visited.has(id)) return;
      const dep = map.get(id);
      if (!dep) return;

      for (const depId of dep.dependsOn) {
        visit(depId);
      }

      visited.add(id);
      result.push(dep);
    }

    for (const dep of delegations) {
      visit(dep.id);
    }

    return result;
  }

  stop(): void {
    this.isRunning = false;
  }

  getCurrentMission(): Mission | null {
    return this.currentMission ? { ...this.currentMission } : null;
  }

  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan ? { ...this.currentPlan } : null;
  }
}

export class DeterministicAuditor implements Auditor {
  async audit(delegation: Delegation, result: AgentResult, mission: Mission, plan: ExecutionPlan): Promise<AuditResult> {
    const findings: string[] = [];
    const acceptanceResults: AcceptanceCriteriaResult[] = [];

    if (result.status === "failed") {
      findings.push(`Delegation failed: ${result.error ?? "Unknown error"}`);
      for (const criterion of delegation.acceptanceCriteria) {
        acceptanceResults.push({ criterion, passed: false, evidence: result.error });
      }
      return createAuditResult(
        delegation.id,
        "FAIL",
        `Delegation "${delegation.title}" failed execution`,
        findings,
        acceptanceResults,
        {
          description: `Fix the failure in ${delegation.title}`,
          focusAreas: ["Error resolution", "Verify fix"],
        }
      );
    }

    for (const criterion of delegation.acceptanceCriteria) {
      const passed = this.checkCriterion(criterion, result.output);
      acceptanceResults.push({
        criterion,
        passed,
        evidence: passed ? "Output satisfies criterion" : "Output does not satisfy criterion",
      });
      if (!passed) {
        findings.push(`Acceptance criterion not met: ${criterion}`);
      }
    }

    const allPassed = acceptanceResults.every((r) => r.passed);

    if (allPassed) {
      return createAuditResult(
        delegation.id,
        "PASS",
        `Delegation "${delegation.title}" passed all acceptance criteria`,
        ["All criteria satisfied"],
        acceptanceResults
      );
    }

    return createAuditResult(
      delegation.id,
      "FAIL",
      `Delegation "${delegation.title}" failed ${findings.length} acceptance criteria`,
      findings,
      acceptanceResults,
      {
        description: `Address failing acceptance criteria for ${delegation.title}`,
        focusAreas: findings.map((f) => f.replace("Acceptance criterion not met: ", "")),
      }
    );
  }

  private checkCriterion(criterion: string, output: string): boolean {
    const lowerOutput = output.toLowerCase();
    const lowerCriterion = criterion.toLowerCase();

    const keywords = lowerCriterion
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    return keywords.some((k) => lowerOutput.includes(k));
  }
}

export class RealFactoryAdapter implements FactoryExecutionAdapter {
  async runDelegation(delegation: Delegation, mission: Mission, config: { baseDir: string; project: string; fromStep?: string }): Promise<AgentResult> {
    await runGoal(
      delegation.description,
      config.baseDir,
      config.project,
      {
        pipelineType: delegation.pipelineType,
        fromStep: config.fromStep,
        engine: mission.context?.engine,
        stack: mission.context?.stack,
        template: mission.context?.template,
        workspace: mission.context?.workspace,
      }
    );
    return {
      delegationId: delegation.id,
      status: "passed",
      output: "",
      durationMs: 0,
    };
  }
}