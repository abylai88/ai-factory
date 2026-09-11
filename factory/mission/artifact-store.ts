import { randomUUID } from "node:crypto";
import type { AgentRole, Delegation, Mission } from "./mission.js";

// MissionArtifact is a top-level artifact in the mission's artifact store.
// It shares the shape of DelegationArtifact but adds missionId so that
// the store can be queried by mission without a separate index.
export interface MissionArtifact {
  id: string;
  missionId: string;
  delegationId: string;
  type: "file" | "research" | "design" | "code" | "test" | "report";
  path?: string;
  title: string;
  summary: string;
  createdByRole: AgentRole;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ── Artifact Store ─────────────────────────────────────────────

export interface ArtifactStoreConfig {
  maxArtifactsPerMission?: number;
  maxSummaryChars?: number;
  maxContextChars?: number;
}

const DEFAULT_CONFIG: Required<ArtifactStoreConfig> = {
  maxArtifactsPerMission: 100,
  maxSummaryChars: 200,
  maxContextChars: 4000,
};

/**
 * Centralized store for artifacts produced by delegations.
 * Used for structured handoff between agents without copying file contents.
 */
export class ArtifactStore {
  private readonly missionId: string;
  private readonly artifacts: Map<string, MissionArtifact> = new Map();
  private readonly config: Required<ArtifactStoreConfig>;

  constructor(missionId: string, config?: ArtifactStoreConfig) {
    this.missionId = missionId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a new artifact.
   */
  registerArtifact(input: {
    delegationId: string;
    type: MissionArtifact["type"];
    title: string;
    summary: string;
    createdByRole: AgentRole;
    path?: string;
    metadata?: Record<string, unknown>;
  }): MissionArtifact {
    const existingCount = this.getArtifactsForMission().length;
    if (existingCount >= this.config.maxArtifactsPerMission) {
      const oldest = this.getArtifactsForMission()[0];
      if (oldest) {
        this.artifacts.delete(oldest.id);
      }
    }

    const summary = input.summary.length > this.config.maxSummaryChars
      ? input.summary.slice(0, this.config.maxSummaryChars - 3) + "..."
      : input.summary;

    const artifact: MissionArtifact = {
      id: `art-${randomUUID().slice(0, 8)}`,
      missionId: this.missionId,
      delegationId: input.delegationId,
      type: input.type,
      path: input.path,
      title: input.title,
      summary,
      createdByRole: input.createdByRole,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };

    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  /**
   * Get all artifacts for a mission.
   */
  getArtifactsForMission(): MissionArtifact[] {
    return Array.from(this.artifacts.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  /**
   * Get all artifacts produced by a specific delegation.
   */
  getArtifactsForDelegation(delegationId: string): MissionArtifact[] {
    return this.getArtifactsForMission().filter((a) => a.delegationId === delegationId);
  }

  /**
   * Get artifacts of a specific type.
   */
  getArtifactsByType(type: MissionArtifact["type"]): MissionArtifact[] {
    return this.getArtifactsForMission().filter((a) => a.type === type);
  }

  /**
   * Get artifacts needed by a delegation (i.e., produced by its dependencies).
   */
  getArtifactsNeededByDelegation(delegation: Delegation): MissionArtifact[] {
    const depIds = new Set(delegation.dependsOn);
    return this.getArtifactsForMission().filter((a) => depIds.has(a.delegationId));
  }

  /**
   * Build a bounded context string listing available artifacts grouped by type.
   * This is the structured handoff format used in agent prompts.
   */
  buildArtifactContext(options?: {
    delegation?: Delegation;
    types?: MissionArtifact["type"][];
    maxChars?: number;
  }): string {
    const maxChars = options?.maxChars ?? this.config.maxContextChars;
    let artifacts = this.getArtifactsForMission();

    if (options?.delegation) {
      const depIds = new Set(options.delegation.dependsOn);
      const fromDeps = artifacts.filter((a) => depIds.has(a.delegationId));
      const fromMission = artifacts.filter((a) => !depIds.has(a.delegationId));
      artifacts = [...fromDeps, ...fromMission];
    }

    if (options?.types) {
      const typeSet = new Set(options.types);
      artifacts = artifacts.filter((a) => typeSet.has(a.type));
    }

    if (artifacts.length === 0) {
      return "AVAILABLE ARTIFACTS\n(none)";
    }

    const grouped = new Map<MissionArtifact["type"], MissionArtifact[]>();
    for (const a of artifacts) {
      const list = grouped.get(a.type) ?? [];
      list.push(a);
      grouped.set(a.type, list);
    }

    const lines: string[] = ["AVAILABLE ARTIFACTS"];
    for (const [type, items] of grouped.entries()) {
      lines.push("");
      lines.push(this.formatTypeLabel(type) + ":");
      for (const item of items) {
        const pathPart = item.path ? ` (${item.path})` : "";
        const rolePart = `[${item.createdByRole}]`;
        lines.push(`  - ${item.title}${pathPart} ${rolePart}`);
        if (item.summary) {
          lines.push(`    ${item.summary}`);
        }
      }
    }

    let context = lines.join("\n");
    if (context.length > maxChars) {
      context = context.slice(0, maxChars - 50) + "\n\n... (truncated)";
    }
    return context;
  }

  /**
   * Attach artifacts to a delegation as outputs.
   * Returns the updated delegation.
   */
  attachToDelegation(delegation: Delegation): Delegation {
    const outputs = this.getArtifactsForDelegation(delegation.id);
    if (outputs.length === 0) return delegation;
    return { ...delegation, outputs };
  }

  /**
   * Clear all artifacts.
   */
  clear(): void {
    this.artifacts.clear();
  }

  /**
   * Count artifacts.
   */
  count(): number {
    return this.artifacts.size;
  }

  private formatTypeLabel(type: MissionArtifact["type"]): string {
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
}

// ── Singleton Helper for Mission ───────────────────────────────

/**
 * Create an ArtifactStore bound to a mission.
 */
export function createArtifactStore(mission: Mission, config?: ArtifactStoreConfig): ArtifactStore {
  return new ArtifactStore(mission.id, config);
}
