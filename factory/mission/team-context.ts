import type {
  AgentRole,
  AgentResult,
  Delegation,
  Mission,
} from "./mission.js";
import type { ArtifactStore } from "./artifact-store.js";

// ── Team Context Types ─────────────────────────────────────────

export interface TeamContextConfig {
  maxContextChars?: number;
  maxDelegationSummaryChars?: number;
  maxArtifactSectionChars?: number;
  maxFailureSectionChars?: number;
  maxDependencySectionChars?: number;
  includeFullMemoryForRoles?: AgentRole[];
}

const DEFAULT_CONFIG: Required<TeamContextConfig> = {
  maxContextChars: 6000,
  maxDelegationSummaryChars: 250,
  maxArtifactSectionChars: 2000,
  maxFailureSectionChars: 1500,
  maxDependencySectionChars: 2000,
  // Manager gets the full picture for coordination.
  includeFullMemoryForRoles: ["Manager"],
};

// ── Context Selectors ──────────────────────────────────────────

export interface DelegationRecord {
  id: string;
  title: string;
  role?: AgentRole;
  status: string;
  resultSummary?: string;
  errorSummary?: string;
}

export interface FailureRecord {
  delegationId: string;
  title: string;
  role?: AgentRole;
  reason: string;
  attempt: number;
}

export interface ContextSection {
  title: string;
  body: string;
  truncated: boolean;
}

export interface TeamContext {
  role: AgentRole;
  missionGoal: string;
  yourTask: string;
  sections: ContextSection[];
  totalChars: number;
  truncated: boolean;
}

// ── Team Context Builder ───────────────────────────────────────

/**
 * Builds bounded, role-specific context for each agent.
 *
 * Different roles need different context:
 *   - Manager:    full mission overview
 *   - Researcher: prior research + related code
 *   - Developer:  architecture + research + dependencies
 *   - Designer:   design prior + mission constraints
 *   - QA:         implementation summary + changed files + validation results
 *   - Repair:     failure details + relevant code + previous repair attempts
 *   - Architect:  codebase overview + dependency analysis
 */
export class TeamContextBuilder {
  private readonly config: Required<TeamContextConfig>;

  constructor(config?: TeamContextConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build a bounded context for an agent.
   */
  buildAgentContext(input: {
    mission: Mission;
    delegation: Delegation;
    role: AgentRole;
    delegations: DelegationRecord[];
    failures: FailureRecord[];
    artifactStore?: ArtifactStore;
    memoryContext?: string;
  }): TeamContext {
    const sections: ContextSection[] = [];

    // 1. Mission goal + agent task
    sections.push({
      title: "MISSION GOAL",
      body: this.truncate(input.mission.goal, 500),
      truncated: input.mission.goal.length > 500,
    });

    sections.push({
      title: "YOUR ROLE",
      body: input.role,
      truncated: false,
    });

    sections.push({
      title: "YOUR TASK",
      body: this.truncate(input.delegation.title, 500),
      truncated: input.delegation.title.length > 500,
    });

    // 2. Dependencies section (for the role-specific framing)
    const depSection = this.buildDependencySection(input.delegation, input.delegations, input.role);
    if (depSection) sections.push(depSection);

    // 3. Artifacts section
    if (input.artifactStore) {
      const artifactSection = this.buildArtifactSection(input.delegation, input.artifactStore, input.role);
      if (artifactSection) sections.push(artifactSection);
    }

    // 4. Failures section (mostly for repair, but useful for QA too)
    const failureSection = this.buildFailureSection(input.failures, input.role);
    if (failureSection) sections.push(failureSection);

    // 5. Full memory for Manager role
    if (this.config.includeFullMemoryForRoles.includes(input.role) && input.memoryContext) {
      sections.push({
        title: "FULL MISSION MEMORY",
        body: this.truncate(input.memoryContext, this.config.maxContextChars - this.totalLength(sections)),
        truncated: (input.memoryContext?.length ?? 0) > this.config.maxContextChars,
      });
    }

    // Enforce total size budget
    const bounded = this.enforceBounds(sections, this.config.maxContextChars);

    return {
      role: input.role,
      missionGoal: input.mission.goal,
      yourTask: input.delegation.title,
      sections: bounded,
      totalChars: this.totalLength(bounded),
      truncated: bounded.some((s) => s.truncated),
    };
  }

  /**
   * Select relevant delegations to include based on role.
   */
  selectRelevantDelegations(input: {
    role: AgentRole;
    currentDelegation: Delegation;
    allDelegations: DelegationRecord[];
    max?: number;
  }): DelegationRecord[] {
    const { role, currentDelegation, allDelegations } = input;
    const max = input.max ?? 5;
    const depIds = new Set(currentDelegation.dependsOn);

    // 1. Always include direct dependencies
    const directDeps = allDelegations.filter((d) => depIds.has(d.id));

    // 2. Then prioritize by role relevance
    const rolePriority: Record<AgentRole, AgentRole[]> = {
      Manager: ["Manager", "Researcher", "Developer", "QA"],
      Researcher: ["Researcher", "Architect"],
      Developer: ["Architect", "Developer", "Researcher", "QA"],
      Designer: ["Designer", "Researcher", "Manager"],
      QA: ["Developer", "QA", "Architect"],
      Repair: ["Developer", "Repair", "QA"],
      Architect: ["Architect", "Developer", "Researcher"],
    };

    const relevantRoles = rolePriority[role] ?? ["Developer"];
    const other = allDelegations
      .filter((d) => !depIds.has(d.id) && d.id !== currentDelegation.id)
      .filter((d) => d.role && relevantRoles.includes(d.role))
      .slice(0, max - directDeps.length);

    return [...directDeps, ...other].slice(0, max);
  }

  /**
   * Select relevant artifacts based on role.
   */
  selectRelevantArtifacts(input: {
    role: AgentRole;
    delegation: Delegation;
    artifactStore: ArtifactStore;
    max?: number;
  }): ReturnType<ArtifactStore["getArtifactsForMission"]> {
    const { role, delegation, artifactStore } = input;
    const max = input.max ?? 10;

    // Priority by role
    const roleTypePriority: Record<AgentRole, ("file" | "research" | "design" | "code" | "test" | "report")[]> = {
      Manager: ["report", "research", "design"],
      Researcher: ["research", "report", "file"],
      Developer: ["code", "file", "design", "research"],
      Designer: ["design", "file", "report"],
      QA: ["code", "test", "file", "report"],
      Repair: ["code", "test", "file", "report"],
      Architect: ["code", "design", "file", "research"],
    };

    const priority = roleTypePriority[role] ?? ["file", "code"];
    const depIds = new Set(delegation.dependsOn);

    const all = artifactStore.getArtifactsForMission();
    const fromDeps = all.filter((a) => depIds.has(a.delegationId));
    const fromMission = all.filter((a) => !depIds.has(a.delegationId));

    const sorted: typeof all = [];
    for (const t of priority) {
      for (const a of fromMission) {
        if (a.type === t) sorted.push(a);
      }
    }
    // Add from dependencies first
    return [...fromDeps, ...sorted].slice(0, max);
  }

  /**
   * Select relevant failures based on role.
   */
  selectRelevantFailures(input: {
    role: AgentRole;
    delegation: Delegation;
    failures: FailureRecord[];
    max?: number;
  }): FailureRecord[] {
    const { role, delegation, failures } = input;
    const max = input.max ?? 3;

    // Repair role: prioritize own role and Developer failures
    if (role === "Repair") {
      return failures
        .filter((f) => f.delegationId === delegation.id || f.role === "Developer" || f.role === "Repair")
        .slice(0, max);
    }

    // QA: any failure relevant to testing
    if (role === "QA") {
      return failures
        .filter((f) => f.role !== "QA" && f.role !== "Manager")
        .slice(0, max);
    }

    // Manager: see everything
    if (role === "Manager") {
      return failures.slice(0, max);
    }

    // Architect: see all for technical analysis
    if (role === "Architect") {
      return failures.slice(0, max);
    }

    // Researcher: research-related failures
    if (role === "Researcher") {
      return failures.filter((f) => f.role === "Researcher" || f.role === "Developer").slice(0, max);
    }

    // Developer/Designer: failures in their own chain
    return failures
      .filter((f) => f.delegationId === delegation.id || f.role === role)
      .slice(0, max);
  }

  // ── Private helpers ─────────────────────────────────────────

  private buildDependencySection(
    delegation: Delegation,
    delegations: DelegationRecord[],
    role: AgentRole,
  ): ContextSection | null {
    const depIds = delegation.dependsOn;
    if (depIds.length === 0) {
      return {
        title: "DEPENDENCIES COMPLETED",
        body: "(none — this is a starting delegation)",
        truncated: false,
      };
    }
    const deps = delegations.filter((d) => depIds.includes(d.id));
    if (deps.length === 0) {
      return null;
    }
    const lines: string[] = [];
    for (const dep of deps) {
      const rolePart = dep.role ? `[${dep.role}]` : "";
      const statusPart = `[${dep.status}]`;
      lines.push(`  ${rolePart} ${dep.title} ${statusPart}`);
      if (dep.resultSummary) {
        lines.push(`    ${this.truncate(dep.resultSummary, this.config.maxDelegationSummaryChars)}`);
      }
      if (dep.errorSummary) {
        lines.push(`    Error: ${this.truncate(dep.errorSummary, 200)}`);
      }
    }
    return {
      title: "DEPENDENCIES COMPLETED",
      body: lines.join("\n"),
      truncated: false,
    };
  }

  private buildArtifactSection(
    delegation: Delegation,
    artifactStore: ArtifactStore,
    role: AgentRole,
  ): ContextSection | null {
    const relevant = this.selectRelevantArtifacts({ role, delegation, artifactStore });
    if (relevant.length === 0) {
      return null;
    }
    const grouped = new Map<string, typeof relevant>();
    for (const a of relevant) {
      const list = grouped.get(a.type) ?? [];
      list.push(a);
      grouped.set(a.type, list);
    }
    const lines: string[] = [];
    for (const [type, items] of grouped.entries()) {
      lines.push(`  ${this.formatTypeLabel(type)}:`);
      for (const item of items) {
        const pathPart = item.path ? ` (${item.path})` : "";
        const rolePart = `[${item.createdByRole}]`;
        lines.push(`    - ${item.title}${pathPart} ${rolePart}`);
        if (item.summary) {
          lines.push(`      ${item.summary}`);
        }
      }
    }
    return {
      title: "AVAILABLE ARTIFACTS",
      body: lines.join("\n"),
      truncated: false,
    };
  }

  private buildFailureSection(
    failures: FailureRecord[],
    role: AgentRole,
  ): ContextSection | null {
    const relevant = this.selectRelevantFailures({
      role,
      delegation: { id: "", title: "", description: "", missionId: "", objectiveId: "", pipelineType: "engineering" as const, dependsOn: [], parallelizable: false, acceptanceCriteria: [], status: "queued" as const, createdAt: "" },
      failures,
    });
    if (relevant.length === 0) {
      return null;
    }
    const lines: string[] = [];
    for (const f of relevant) {
      const rolePart = f.role ? `[${f.role}]` : "";
      lines.push(`  ${rolePart} ${f.title} (attempt ${f.attempt})`);
      lines.push(`    ${f.reason}`);
    }
    return {
      title: "PREVIOUS FAILURES",
      body: lines.join("\n"),
      truncated: false,
    };
  }

  private formatTypeLabel(type: string): string {
    switch (type) {
      case "file":
        return "Files";
      case "research":
        return "Research";
      case "design":
        return "Design";
      case "code":
        return "Code";
      case "test":
        return "Tests";
      case "report":
        return "Reports";
      default:
        return type;
    }
  }

  private totalLength(sections: ContextSection[]): number {
    return sections.reduce((sum, s) => sum + s.body.length, 0);
  }

  private enforceBounds(sections: ContextSection[], maxChars: number): ContextSection[] {
    const result: ContextSection[] = [];
    let used = 0;
    for (const s of sections) {
      const remaining = maxChars - used;
      if (remaining <= 0) {
        result.push({ ...s, body: "(omitted — context budget exhausted)", truncated: true });
        continue;
      }
      if (s.body.length <= remaining) {
        result.push(s);
        used += s.body.length;
      } else {
        const trimmed = s.body.slice(0, Math.max(0, remaining - 50));
        result.push({
          ...s,
          body: trimmed + "\n... (truncated)",
          truncated: true,
        });
        used += remaining;
      }
    }
    return result;
  }

  private truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 3) + "...";
  }
}

// ── Factory ────────────────────────────────────────────────────

export function createTeamContextBuilder(config?: TeamContextConfig): TeamContextBuilder {
  return new TeamContextBuilder(config);
}
