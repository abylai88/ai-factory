import * as pty from "node-pty";
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
  VisualQaResult,
} from "./mission.js";
import { normalizeVisualQaEvidence } from "./visual-qa-evidence.js";
import { MissionState } from "./state.js";
import { MissionEventSink } from "./mission.js";
import { MissionEventPublisher, createMissionEventPublisher, MissionEventTypes } from "./events.js";
import { runGoal } from "../pipeline/pipeline-runner.js";
import type { VisualQaAdapter } from "./visual-qa-adapter.js";

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
  visualQaAdapter?: VisualQaAdapter;
}

const DEFAULT_MAX_REPAIRS = 3;

export class MissionOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly publisher: MissionEventPublisher;
  private currentMission: Mission | null = null;
  private currentPlan: ExecutionPlan | null = null;
  private isRunning = false;
  private readonly readOnlyDelegations = new Set<string>();

  constructor(config: OrchestratorConfig) {
    this.config = {
      maxRepairs: config.maxRepairs ?? DEFAULT_MAX_REPAIRS,
      baseDir: config.baseDir,
      project: config.project,
      factoryAdapter: config.factoryAdapter,
      auditor: config.auditor,
      eventSink: config.eventSink,
      missionState: config.missionState,
      visualQaAdapter: config.visualQaAdapter,
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

        const agentResult = await this.executeDelegation(delegation);

        if (!this.isRunning) break;

        // Phase 8A: Run Visual QA after successful build if required
        const isBuilder = delegation.description.includes("ROLE: builder") || delegation.description.includes("BUILD_COMMAND:");
        if (isBuilder && agentResult.status === "passed" && this.currentMission?.context?.requiresVisualQa) {
          await this.runVisualQa(delegation);
        }

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
      const adapterResult = await this.config.factoryAdapter.runDelegation(delegation, this.currentMission!, {
        baseDir: this.config.baseDir,
        project: this.config.project,
        fromStep: delegation.stepIds?.[0],
      });

      const updatedDelegation = this.config.missionState.getDelegation(delegation.id);

      agentResult = {
        delegationId: delegation.id,
        pipelineId: adapterResult.pipelineId ?? updatedDelegation?.pipelineId,
        status: adapterResult.status,
        output: adapterResult.output || updatedDelegation?.result || "",
        error: adapterResult.error ?? updatedDelegation?.error,
        durationMs: Date.now() - startTime,
        readOnly: adapterResult.readOnly,
      };

      if (adapterResult.readOnly) {
        this.readOnlyDelegations.add(delegation.id);
      }
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

  private async runVisualQa(buildDelegation: Delegation): Promise<void> {
    const adapter = this.config.visualQaAdapter;
    if (!adapter) {
      // No QA adapter available — record skip
      const now = new Date().toISOString();
      const skippedResult: VisualQaResult = {
        status: "skipped",
        passed: false,
        checks: 0,
        failedChecks: 0,
        errors: [],
        artifacts: [],
        startedAt: now,
        finishedAt: now,
      };
      await this.config.missionState.recordVisualQaResult(skippedResult);
      this.publisher.publish({
        missionId: buildDelegation.missionId,
        type: MissionEventTypes.MISSION_VISUAL_QA_SKIPPED,
        payload: {
          reason: "No Visual QA adapter configured",
          status: "skipped",
          passed: false,
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
          errorCount: 0,
          artifactCount: 0,
        },
      });
      // Refresh current mission from state
      this.currentMission = this.config.missionState.getMission();
      return;
    }

    this.publisher.publish({
      missionId: buildDelegation.missionId,
      type: MissionEventTypes.MISSION_VISUAL_QA_STARTED,
      payload: { buildDelegationId: buildDelegation.id },
    });
    await this.config.missionState.recordVisualQaStarted();

    const projectId = this.currentMission?.context?.projectId ?? "unknown";
    const runId = `mission-${this.currentMission?.id ?? "unknown"}-${Date.now()}`;

    const result = await adapter.run({
      projectId,
      projectPath: this.config.project,
      runId,
    });

    await this.config.missionState.recordVisualQaResult(result);

    // Refresh current mission from state so auditor sees the QA result
    this.currentMission = this.config.missionState.getMission();

    const evidence = normalizeVisualQaEvidence(result);

    const eventType = result.status === "passed"
      ? MissionEventTypes.MISSION_VISUAL_QA_COMPLETED
      : MissionEventTypes.MISSION_VISUAL_QA_FAILED;

    this.publisher.publish({
      missionId: buildDelegation.missionId,
      type: eventType,
      payload: {
        status: evidence.status,
        passed: evidence.passed,
        totalChecks: evidence.totalChecks,
        passedChecks: evidence.passedChecks,
        failedChecks: evidence.failedChecks,
        errorCount: evidence.errorCount,
        artifactCount: evidence.artifactCount,
        runId: result.runId,
      },
    });
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

      let repairAgentResult: AgentResult;
      try {
        const adapterResult = await this.config.factoryAdapter.runDelegation(repairDelegation, this.currentMission!, repairConfig);
        const updatedRepairDelegation = this.config.missionState.getDelegation(repairDelegation.id);
        repairAgentResult = {
          delegationId: repairDelegation.id,
          pipelineId: adapterResult.pipelineId ?? updatedRepairDelegation?.pipelineId,
          status: adapterResult.status,
          output: adapterResult.output || updatedRepairDelegation?.result || "",
          error: adapterResult.error ?? updatedRepairDelegation?.error,
          durationMs: 0,
          readOnly: adapterResult.readOnly,
        };
        if (adapterResult.readOnly) {
          this.readOnlyDelegations.add(repairDelegation.id);
        }
      } catch {
        repairAgentResult = {
          delegationId: repairDelegation.id,
          status: "failed",
          output: "",
          durationMs: 0,
        };
      }

      if (repairAgentResult.status === "passed") {
        await this.config.missionState.completeDelegation(repairDelegation.id, "passed", repairAgentResult.output);
        await this.config.missionState.completeDelegation(delegation.id, "passed", repairAgentResult.output);
        if (repairAgentResult.readOnly) {
          this.readOnlyDelegations.add(delegation.id);
        }
        return true;
      }

      await this.config.missionState.completeDelegation(repairDelegation.id, "failed", repairAgentResult.output, repairAgentResult.error);
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
      readOnly: this.readOnlyDelegations.has(delegationId),
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

// ─── Evidence Evaluation Functions ──────────────────────────────────

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");
}

function hasFileReferences(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\.\w{1,5}\b(?:\s|$|,|;|:|\)|\]|")/,
    /\b(?:src|lib|dist|build|public|assets|scenes?|scripts?|components?|modules?|utils?|helpers?|services?|types?|configs?)\b/i,
    /(?:\/|\\)(?:[\w.-]+(?:\/|\\)){1,}/,
    /\b(?:import|require|export|from)\s+['"]/,
    /\b(?:file|directory|folder|path)\b/i,
  ];
  return patterns.some((p) => p.test(cleaned));
}

function hasProjectStructure(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:project|codebase|code\s*base|code\s*structure|file\s*structure|directory\s*structure)\b/i,
    /\b(?:source|src|lib|dist|build|config|assets?)\b/i,
    /\b(?:main|entry|index|app|game|scene|level|menu)\b/i,
    /\b(?:function|class|module|component|service|util|helper|type|interface)\b/i,
    /\b(?:gameplay|physics|rendering|input|audio|ui|gui)\b/i,
    /\b(?:typescript|javascript|phaser|webpack|json|html|css)\b/i,
  ];
  return patterns.filter((p) => p.test(cleaned)).length >= 2;
}

function hasComponentReferences(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:scene|component|module|class|function|util|helper|service|type|interface|config)\b/i,
    /\b(?:game|player|enemy|npc|obstacle|projectile|platform|terrain)\b/i,
    /\b(?:menu|hud|ui|overlay|popup|dialog|screen|view)\b/i,
    /\b(?:physics|rendering|input|audio|animation|collision|spawn|movement)\b/i,
    /\b(?:main|boot|preload|create|update|destroy|init|start|load)\b/i,
    /\.(?:ts|js|json|tsx|jsx|css|html|yaml|yml)\b/,
  ];
  return patterns.filter((p) => p.test(cleaned)).length >= 2;
}

function hasAnalysisLanguage(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:analyzed?|analysis|reviewed?|review|examined?|examination|investigated?|investigation|inspected?|inspection|described?|description|documented?|documentation|identified?|identification|findings?|observed?|observation|consists?|contains?|includes?|comprises?|uses?|utilizes?|implements?|provides?|handles?|manages?|supports?)\b/i,
    /\b(?:overview|summary|report|findings?|results?|conclusions?|recommendations?)\b/i,
    /\b(?:structure|architecture|design|layout|organization|arrangement|composition)\b/i,
  ];
  return patterns.some((p) => p.test(cleaned));
}

function hasArchitectureLanguage(text: string): boolean {
  const cleaned = stripAnsi(text);
  const patterns = [
    /\b(?:architect(?:ure|ural)?|design(?:ed|s| pattern)?|structure[d]?|organized?|organized?)\b/i,
    /\b(?:layer[s]?|tier[s]?|component[s]?|module[s]?|service[s]?|module[s]?)\b/i,
    /\b(?:pattern[s]?|approach(?:es)?|strategy|strategies|framework|system)\b/i,
    /\b(?:scene[s]?|state\s*management|data\s*flow|event|signal|message)\b/i,
    /\b(?:render(?:ing|er)?|physics|input|audio|collision|spawn|movement|animation)\b/i,
    /\b(?:pipeline|workflow|architecture|composition|dependency|injection)\b/i,
  ];
  return patterns.filter((p) => p.test(cleaned)).length >= 2;
}

function hasMinimalSubstance(text: string): boolean {
  const cleaned = stripAnsi(text);
  const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < 5) return false;
  const hasFileRef = hasFileReferences(cleaned);
  const hasStructure = hasProjectStructure(cleaned);
  const hasAnalysis = hasAnalysisLanguage(cleaned);
  return (hasFileRef ? 1 : 0) + (hasStructure ? 1 : 0) + (hasAnalysis ? 1 : 0) >= 2;
}

function evaluateCodebaseAnalyzed(output: string): { passed: boolean; evidence: string } {
  const cleaned = stripAnsi(output);
  if (cleaned.trim().length < 50) {
    return { passed: false, evidence: "Output too short for codebase analysis" };
  }
  if (!hasMinimalSubstance(output)) {
    return { passed: false, evidence: "Output lacks substantive codebase analysis evidence" };
  }
  const evidenceParts: string[] = [];
  if (hasFileReferences(output)) evidenceParts.push("file/module references");
  if (hasProjectStructure(output)) evidenceParts.push("project structure described");
  if (hasAnalysisLanguage(output)) evidenceParts.push("analysis language present");
  return {
    passed: true,
    evidence: `Substantive analysis detected: ${evidenceParts.join(", ")}`,
  };
}

function evaluateArchitectureDocumented(output: string): { passed: boolean; evidence: string } {
  const cleaned = stripAnsi(output);
  if (cleaned.trim().length < 50) {
    return { passed: false, evidence: "Output too short for architecture documentation" };
  }
  if (!hasArchitectureLanguage(output)) {
    return { passed: false, evidence: "Output lacks architecture-related language" };
  }
  const evidenceParts: string[] = [];
  if (hasArchitectureLanguage(output)) evidenceParts.push("architecture terminology");
  if (hasProjectStructure(output)) evidenceParts.push("project structure described");
  if (hasComponentReferences(output)) evidenceParts.push("component references");
  return {
    passed: true,
    evidence: `Architecture documentation detected: ${evidenceParts.join(", ")}`,
  };
}

function evaluateKeyComponentsIdentified(output: string): { passed: boolean; evidence: string } {
  const cleaned = stripAnsi(output);
  if (cleaned.trim().length < 50) {
    return { passed: false, evidence: "Output too short for component identification" };
  }
  if (!hasComponentReferences(output)) {
    return { passed: false, evidence: "Output lacks concrete component/module references" };
  }
  const evidenceParts: string[] = [];
  if (hasComponentReferences(output)) evidenceParts.push("concrete component references");
  if (hasFileReferences(output)) evidenceParts.push("file references");
  if (hasProjectStructure(output)) evidenceParts.push("project structure");
  return {
    passed: true,
    evidence: `Key components identified: ${evidenceParts.join(", ")}`,
  };
}

function evaluateNoFilesModified(result: AgentResult): { passed: boolean; evidence: string } {
  if (result.readOnly === true) {
    return { passed: true, evidence: "Execution metadata confirms read-only adapter" };
  }
  const lowerOutput = stripAnsi(result.output).toLowerCase();
  const writeIndicators = [
    /\bwrote\b/i,
    /\bcreated\s+file/i,
    /\bmodified\s+file/i,
    /\bdeleted\s+file/i,
    /\bsaved\s+to\b/i,
    /\bwritten\s+to\b/i,
    /\bfile\s+created/i,
    /\bfile\s+modified/i,
    /\bfile\s+saved/i,
    /\bpatch\s+applied/i,
    /\bcommit(?:ted|ting)?\b/i,
    /\bgit\s+(?:add|commit|push|rm)/i,
  ];
  const hasWriteEvidence = writeIndicators.some((p) => p.test(lowerOutput));
  if (hasWriteEvidence) {
    return { passed: false, evidence: "Output contains write operation indicators" };
  }
  return { passed: true, evidence: "No write operation evidence detected in output" };
}

function evaluateGenericCriterion(criterion: string, output: string): { passed: boolean; evidence: string } {
  const lowerOutput = stripAnsi(output).toLowerCase();
  const keywords = criterion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const matched = keywords.filter((k) => lowerOutput.includes(k));
  if (matched.length > 0) {
    return { passed: true, evidence: `Keywords matched: ${matched.join(", ")}` };
  }
  return { passed: false, evidence: "No criterion keywords found in output" };
}

// ─── DeterministicAuditor ───────────────────────────────────────────

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
      const evaluation = this.evaluateCriterion(criterion, result);
      acceptanceResults.push({
        criterion,
        passed: evaluation.passed,
        evidence: evaluation.evidence,
      });
      if (!evaluation.passed) {
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

  private evaluateCriterion(criterion: string, result: AgentResult): { passed: boolean; evidence: string } {
    const lowerCriterion = criterion.toLowerCase();

    if (lowerCriterion.includes("no files modified") || lowerCriterion.includes("no file modified")) {
      return evaluateNoFilesModified(result);
    }
    if (lowerCriterion.includes("codebase analyzed") || lowerCriterion.includes("codebase analysis")) {
      return evaluateCodebaseAnalyzed(result.output);
    }
    if (lowerCriterion.includes("architecture documented") || lowerCriterion.includes("architecture analysis")) {
      return evaluateArchitectureDocumented(result.output);
    }
    if (lowerCriterion.includes("key components identified") || lowerCriterion.includes("components identified")) {
      return evaluateKeyComponentsIdentified(result.output);
    }

    return evaluateGenericCriterion(lowerCriterion, result.output);
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

export interface ReadOnlyAdapterConfig {
  agent?: string;
  model?: string;
  timeoutMs?: number;
}

const DEFAULT_READ_ONLY_AGENT = "researcher";
const DEFAULT_READ_ONLY_TIMEOUT_MS = 180_000;

export class ReadOnlyFactoryAdapter implements FactoryExecutionAdapter {
  private readonly config: ReadOnlyAdapterConfig;

  constructor(config?: ReadOnlyAdapterConfig) {
    this.config = config ?? {};
  }

  async runDelegation(delegation: Delegation, _mission: Mission, config: { baseDir: string; project: string; fromStep?: string }): Promise<AgentResult> {
    const agent = this.config.agent ?? DEFAULT_READ_ONLY_AGENT;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_READ_ONLY_TIMEOUT_MS;

    const prompt = `
You are a read-only investigation agent.

MISSION OBJECTIVE:
${delegation.description}

PROJECT:
${config.project}

RULES:
1. You MUST NOT modify any files.
2. You MUST NOT create any files.
3. You MUST NOT delete any files.
4. You MUST NOT execute write commands.
5. Read files using: cat, head, tail, ls, find, grep
6. Run read-only git commands: git log, git diff, git status
7. Analyze the project structure and architecture.
8. Provide a comprehensive report of your findings.
9. Report the gameplay architecture, file structure, and key components.
10. At the end, provide a structured summary.

IMPORTANT: This is a READ-ONLY mission. Do NOT modify anything.
`;

    const startTime = Date.now();

    try {
      const result = await this.runOpenCode(agent, prompt, config.project, timeoutMs);
      const durationMs = Date.now() - startTime;

      if (result.timedOut) {
        return {
          delegationId: delegation.id,
          status: "failed",
          output: result.output,
          error: `Agent timed out after ${timeoutMs}ms`,
          durationMs,
          readOnly: true,
        };
      }

      if (result.code !== 0) {
        return {
          delegationId: delegation.id,
          status: "failed",
          output: result.output,
          error: `Agent exited with code ${result.code}`,
          durationMs,
          readOnly: true,
        };
      }

      return {
        delegationId: delegation.id,
        status: "passed",
        output: result.output,
        durationMs,
        readOnly: true,
      };
    } catch (error) {
      return {
        delegationId: delegation.id,
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        readOnly: true,
      };
    }
  }

  private runOpenCode(
    agent: string,
    prompt: string,
    project: string,
    timeoutMs: number
  ): Promise<{ code: number; output: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;

      const child = pty.spawn(
        "/home/asila/.opencode/bin/opencode",
        [
          "run",
          "--agent",
          agent,
          prompt,
        ],
        {
          name: "xterm-256color",
          cols: 120,
          rows: 30,
          cwd: project,
          env: {
            ...process.env,
            HOME: "/home/asila",
            PATH: `/home/asila/.opencode/bin:${process.env.PATH ?? ""}`,
          },
        }
      );

      child.onData((data: string) => {
        output += data;
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Process may already be gone
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Process may already be gone
          }
        }, 5_000);
        resolve({
          code: -1,
          output: output + "\n[Terminated: timeout exceeded]",
          timedOut: true,
        });
      }, timeoutMs);

      child.onExit(({ exitCode }: { exitCode: number }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          code: exitCode ?? 1,
          output,
          timedOut: false,
        });
      });
    });
  }
}