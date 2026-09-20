import { scrubEphemeralIds } from "../mission/readiness-evidence.js";

/**
 * Player-facing UI evidence for quality review (bounded StarterGui
 * inspection over the EXISTING Studio bridge read surface).
 *
 * Collects, in order:
 *  1. `game.StarterGui` subtree (depth ≤ 3 — never a whole-DataModel walk)
 *  2. Properties for a bounded subset of ScreenGui / Frame / TextLabel /
 *     TextButton nodes (visible/hidden state where the bridge reports it)
 *
 * Produces a `uiInventory` summary string the UX critic consumes as
 * evidence. Honest `unavailable` when Studio is not connected — never
 * an invented hierarchy.
 */

export interface UiEvidenceBridge {
  callTool(
    toolName: string,
    params?: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    message: string;
    stdout?: string;
    data?: unknown;
  }>;
}

export interface StarterGuiEvidenceOptions {
  maxDepth?: number;
  /** Max nodes whose properties are read (bounded). */
  maxNodes?: number;
}

export interface StarterGuiEvidence {
  status: "captured" | "unavailable";
  /** Bounded UI inventory summary for the UX critic. */
  uiInventory: string;
  /** Node paths inspected (canonical, bounded). */
  nodes: string[];
  detail: string;
}

const UI_CLASSES = ["ScreenGui", "Frame", "ScrollingFrame", "TextLabel", "TextButton", "ImageButton", "ImageLabel", "UIListLayout", "UIPadding"];

function textOf(data: unknown, stdout: string | undefined): string {
  if (typeof stdout === "string" && stdout.trim()) return stdout;
  try {
    return JSON.stringify(data ?? "").slice(0, 4000);
  } catch {
    return "";
  }
}

function extractUiNodes(structureText: string): string[] {
  const nodes: string[] = [];
  // Match canonical StarterGui paths; bounded and de-duplicated.
  const re = /game\.StarterGui\.[A-Za-z0-9_][A-Za-z0-9 _.()-]{0,120}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(structureText)) !== null && nodes.length < 40) {
    const p = m[0].trim();
    if (!nodes.includes(p)) nodes.push(p);
  }
  return nodes.slice(0, 40);
}

function summarizeProperties(nodePath: string, propsText: string): string {
  const bits: string[] = [nodePath];
  const t = propsText.slice(0, 800);
  const pick = (name: string): string | undefined => {
    const m = t.match(new RegExp(`"${name}"\\s*:\\s*("[^"]{0,80}"|[A-Za-z0-9._-]+)`));
    return m?.[1];
  };
  const cls = pick("className") ?? pick("ClassName");
  const visible = pick("Visible");
  const text = pick("Text");
  const name = pick("Name");
  const extra = [cls ?? name, visible != null ? `Visible=${visible}` : "", text != null ? `Text=${text}` : ""]
    .filter(Boolean)
    .join(" ");
  return extra ? `${nodePath} (${extra.slice(0, 160)})` : nodePath;
}

/**
 * Bounded, read-only StarterGui inspection. Never writes, never walks
 * the whole DataModel, never starts a playtest.
 */
export async function collectStarterGuiEvidence(
  bridge: UiEvidenceBridge | undefined,
  opts: StarterGuiEvidenceOptions = {},
): Promise<StarterGuiEvidence> {
  const maxDepth = Math.max(1, Math.min(3, opts.maxDepth ?? 3));
  const maxNodes = Math.max(1, Math.min(12, opts.maxNodes ?? 8));
  const empty: StarterGuiEvidence = {
    status: "unavailable",
    uiInventory: "",
    nodes: [],
    detail: "UI_UNAVAILABLE",
  };
  if (!bridge) {
    return { ...empty, detail: "UI_UNAVAILABLE: no Studio bridge provided" };
  }
  let structureText: string;
  try {
    const structure = await bridge.callTool("get_project_structure", {
      path: "game.StarterGui",
      maxDepth,
    });
    if (!structure.ok) {
      return {
        ...empty,
        detail: `UI_UNAVAILABLE: ${scrubEphemeralIds(structure.message).slice(0, 300)}`,
      };
    }
    structureText = scrubEphemeralIds(textOf(structure.data, structure.stdout)).slice(0, 4000);
  } catch (e) {
    return {
      ...empty,
      detail: `UI_UNAVAILABLE: StarterGui read threw (${String(e instanceof Error ? e.message : e).slice(0, 200)})`,
    };
  }
  if (!structureText.trim()) {
    return { ...empty, detail: "UI_UNAVAILABLE: empty StarterGui structure response" };
  }
  const nodes = extractUiNodes(structureText);
  const lines: string[] = [`StarterGui subtree (depth ${maxDepth}):`];
  const uiClassHits = UI_CLASSES.filter((c) => new RegExp(c, "i").test(structureText));
  lines.push(
    uiClassHits.length > 0
      ? `UI classes observed: ${uiClassHits.join(", ")}`
      : "UI classes observed: none recognized in StarterGui summary",
  );
  const inspected: string[] = [];
  for (const node of nodes.slice(0, maxNodes)) {
    try {
      // Factory bridge contract: TOOL_MAP exposes `get_properties` (with
      // `{ path }`), which maps internally onto MCP `get_instance_properties`.
      const props = await bridge.callTool("get_properties", { path: node });
      if (props.ok) {
        inspected.push(node);
        lines.push(`- ${summarizeProperties(node, scrubEphemeralIds(textOf(props.data, props.stdout)))}`);
      } else {
        lines.push(`- ${node} (properties unreadable: ${scrubEphemeralIds(props.message).slice(0, 120)})`);
      }
    } catch {
      lines.push(`- ${node} (properties read threw; skipped)`);
    }
  }
  if (nodes.length > maxNodes) {
    lines.push(`… ${nodes.length - maxNodes} more node(s) omitted (bounded inspection)`);
  }
  const uiInventory = lines.join("\n").slice(0, 2000);
  return {
    status: "captured",
    uiInventory,
    nodes: inspected,
    detail: `StarterGui evidence: ${inspected.length}/${nodes.length} node(s) inspected`,
  };
}
