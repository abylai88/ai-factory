import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Creator Store / asset-search layer with security constraints.
 *
 * Workflow: RESEARCH/ASSET SEARCH → inspect candidate → choose → insert →
 * configure → validate. Nothing is downloaded or executed blindly:
 *
 *   - search is metadata-only (no code execution)
 *   - insert requires an explicit allowlisted class + Studio connection
 *   - untrusted asset scripts are NEVER auto-trusted: inserted assets are
 *     quarantined for QA review (script sources listed, not executed)
 *   - hard constraints: no arbitrary URLs, no non-Roblox hosts, no
 *     executable payloads outside the Studio sandbox
 */

export interface AssetCandidate {
  id: string;
  name: string;
  creator: string;
  assetType: "model" | "mesh" | "image" | "audio" | "plugin" | "package";
  url: string;
  description?: string;
}

export interface AssetSearchResult {
  status: "PASS" | "BLOCKED";
  message: string;
  candidates: AssetCandidate[];
}

const ALLOWED_HOSTS = new Set(["create.roblox.com", "www.roblox.com", "roblox.com"]);

export function isAllowedAssetUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Metadata-only asset search. Without network/credentials this returns an
 * empty candidate list with guidance (BLOCKED-safe, never fake results).
 * A live Creator Store integration fills `candidates` via the Studio bridge
 * `asset_search` path when Studio is connected.
 */
export async function searchAssets(query: string, opts?: { limit?: number }): Promise<AssetSearchResult> {
  const q = (query ?? "").trim();
  if (!q) {
    return { status: "BLOCKED", message: "asset search requires a non-empty query", candidates: [] };
  }
  const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 25);
  void limit;
  // Offline-first: no fabricated assets. The Studio-connected path inserts
  // real Creator Store results; until then agents use procedural/game-system
  // generation instead of untrusted downloads.
  return {
    status: "PASS",
    message:
      "asset search (metadata-only): no live Creator Store connection in this environment — " +
      "prefer procedural generation or the reusable game-system library. " +
      "When Studio is connected, use the studio asset_search bridge tool for live results.",
    candidates: [],
  };
}

/** Validate an insert request before it reaches the Studio bridge. */
export function validateAssetInsert(args: {
  assetId: string;
  parent: string;
  assetType?: string;
}): { ok: boolean; reason?: string } {
  if (!/^\d{4,20}$/.test(args.assetId)) {
    return { ok: false, reason: "assetId must be a numeric Roblox asset id (4..20 digits)" };
  }
  if (!args.parent || args.parent.includes("..") || args.parent.length > 300) {
    return { ok: false, reason: "invalid parent path" };
  }
  const t = (args.assetType ?? "model").toLowerCase();
  if (!["model", "mesh", "image", "audio", "package"].includes(t)) {
    return { ok: false, reason: `asset type not insertable without review: ${args.assetType}` };
  }
  return { ok: true };
}

/** Record a quarantine note for an inserted asset (QA must review scripts). */
export async function writeAssetQuarantineNote(
  projectDir: string,
  assetId: string,
  parent: string
): Promise<string> {
  const dir = path.join(projectDir, "docs", "assets");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `insert-${assetId}.md`);
  const body = [
    `# Inserted asset ${assetId}`,
    ``,
    `- parent: \`${parent}\``,
    `- inserted: ${new Date().toISOString()}`,
    `- status: QUARANTINED — QA must review any scripts inside this asset before playtest.`,
    `- do NOT trust server scripts from untrusted assets with DataStore/economy authority.`,
    ``,
  ].join("\n");
  await fs.writeFile(file, body, "utf8");
  return path.relative(projectDir, file).replace(/\\/g, "/");
}
