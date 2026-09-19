import type { StudioBridgeClient, StudioCallResult } from "./bridge.js";
import type { ToolDefinition } from "../tools/types.js";
import { checkClassName, checkInstanceName, checkNoShellMeta } from "../tools/safety.js";

/**
 * Roblox Scene Editing Tool Layer.
 *
 * A permission-controlled, evidence-backed layer on top of the Studio bridge
 * (HTTP or MCP). Every mutation is a bounded, validated, guarded Luau chunk
 * executed on the *edit* DataModel peer (native `get_project_structure` /
 * `get_instance_properties` remain the read-back source of truth, so a
 * "success" is never claimed without reading the resulting state).
 *
 * Contrast with the legacy `studio.create/modify/delete` stubs in tools.ts:
 * those map to native MCP tools that do not exist in the Chrrxs surface
 * (create_instance/clone_instance/move_instance/delete_instance are absent),
 * so the scene layer implements them deterministically here.
 *
 * Safety contract:
 *   - PROTECTED_SCENE_ROOTS may never be destroyed/moved/renamed/reparented.
 *   - No instance may be created/moved/cloned under the Players subtree.
 *   - Scripts (Script/LocalScript/ModuleScript) are code, not scenery:
 *     scene.destroy refuses them; use script editing flows instead.
 *   - Every path is canonicalized, validated segment-wise, and stripped of
 *     shell meta before reaching Luau. Every embedded string is escaped,
 *     control characters rejected, and batch sizes bounded.
 *   - scene.destroy requires an explicit `confirm: true`.
 *   - Evidence: before/after structure + properties are always captured and
 *     returned so callers (and repair routing) can verify what changed.
 *
 * Failures are structured: caller errors are ok=false + infra=false (FAIL at
 * the registry layer), unreachable Studio is infra=true (BLOCKED). A
 * mutation that ran but could not be read back is reported as ok=false with
 * an honest "readback failed" message — never as success.
 */

// ── Constants ─────────────────────────────────────────────────────

/** Top-level containers that scene editing must never restructure. */
export const PROTECTED_SCENE_ROOTS = [
  "Workspace",
  "Players",
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterGui",
  "StarterPlayer",
  "Lighting",
  "SoundService",
  "MaterialService",
  "Chat",
  "Teams",
  "Terrain",
] as const;

/** Classes that are code, not scenery. */
const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);

/** Roblox property → value-shape hint for conservative typing. */
const PROPERTY_TYPE_HINTS: Record<string, string> = {
  Size: "vec3",
  Position: "vec3",
  Velocity: "vec3",
  AngularVelocity: "vec3",
  Rotation: "vec3",
  Orientation: "vec3",
  PivotOffset: "cframe",
  CFrame: "cframe",
  Color: "color3",
  BaseColor: "color3",
  BackgroundColor3: "color3",
  TextColor3: "color3",
  BorderColor3: "color3",
  AnchorPoint: "vec2",
  Anchored: "bool",
  CanCollide: "bool",
  CanQuery: "bool",
  CanTouch: "bool",
  CastShadow: "bool",
  Locked: "bool",
  Neutral: "bool",
  Massless: "bool",
  Transparency: "number",
  Reflectance: "number",
  Shiny: "number",
  Roughness: "number",
  SizeInPixels: "vec2",
  WorldPosition: "vec3",
  Material: "enum",
  SurfaceType: "enum",
  OverlayTexture: "string",
  Texture: "string",
};

const MAX_PROPERTIES_PER_CALL = 25;
const MAX_PLAN_SEGMENTS = 64;

// ── Types ─────────────────────────────────────────────────────────

export interface ScenePath {
  segments: string[];
  path: string;
}

export interface SceneEvidence {
  beforeProperties?: Record<string, string>;
  afterProperties?: Record<string, string>;
  beforeStructure?: unknown;
  afterStructure?: unknown;
  parentBefore?: unknown;
  parentAfter?: unknown;
  structure?: unknown;
}

export interface SceneOpData {
  op: string;
  path?: string;
  parentPath?: string;
  newParent?: string;
  newName?: string;
  className?: string;
  createdPath?: string;
  confirm?: boolean;
  evidence: SceneEvidence;
  [k: string]: unknown;
}

export interface SceneResult extends StudioCallResult {
  data?: SceneOpData;
}

export type SceneOp =
  | "inspect"
  | "plan"
  | "create"
  | "clone"
  | "set"
  | "move"
  | "rename"
  | "destroy"
  | "part"
  | "spawn"
  | "folder"
  | "model"
  | "attachment"
  | "ui";

// ── Tool definitions (registered from builtin.ts) ─────────────────

const READ_ROLES = [
  "programmer",
  "builder",
  "visual",
  "ui",
  "qa",
  "tester",
  "researcher",
  "director",
  "designer",
  "gameplay",
  "architect",
  "monetization",
  "content",
  "reviewer",
] as const;

const EDIT_ROLES = ["visual", "ui", "programmer", "builder"] as const;

export const SCENE_TOOL_DEFS: ToolDefinition[] = [
  { id: "scene.inspect", name: "Inspect scene instance", description: "Read an instance's subtree/properties (read-only, canonical paths).", capability: "inspect_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...READ_ROLES], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
  { id: "scene.plan", name: "Plan scene edit", description: "Preview + validate a scene mutation WITHOUT executing it (read-only).", capability: "inspect_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...READ_ROLES], timeoutMs: 30_000, retry: { maxRetries: 1, backoffMs: 500 }, dangerous: false, requiresStudio: true },
  { id: "scene.create", name: "Create scene instance", description: "Create an allowlisted instance under a parent (evidence-backed).", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.clone", name: "Clone scene instance", description: "Deep-clone an instance to a new parent.", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.set", name: "Set scene properties", description: "Set validated properties on a scene instance (typed values).", capability: "modify_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.move", name: "Move scene instance", description: "Reparent an instance to a new container.", capability: "modify_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.rename", name: "Rename scene instance", description: "Rename an instance (not a protected root).", capability: "modify_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.destroy", name: "Destroy scene instance", description: "Destroy a non-protected, non-script instance (requires confirm:true).", capability: "delete_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["visual", "programmer"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.part", name: "Create part", description: "Create a Part (typed scene.create shortcut).", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.spawn", name: "Create spawn", description: "Create a SpawnLocation (typed scene.create shortcut).", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.folder", name: "Create folder", description: "Create a Folder (typed scene.create shortcut).", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.model", name: "Create model", description: "Create a Model (typed scene.create shortcut).", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.attachment", name: "Create attachment", description: "Create an Attachment (typed scene.create shortcut).", capability: "create_instance", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: [...EDIT_ROLES], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
  { id: "scene.ui", name: "Create UI element", description: "Create a ScreenGui/UI element (typed scene.create shortcut).", capability: "create_ui", platform: "roblox", executionMethod: "studio-bridge", allowedRoles: ["ui", "visual"], timeoutMs: 30_000, retry: { maxRetries: 0, backoffMs: 0 }, dangerous: true, requiresStudio: true },
];

// ── Validation helpers ────────────────────────────────────────────

function failScene(message: string): SceneResult {
  return { ok: false, infra: false, message, stdout: "", stderr: message };
}

function infraScene(message: string): SceneResult {
  return { ok: false, infra: true, message, stdout: "", stderr: message };
}

function okScene(message: string, data: SceneOpData, extra: { stdout?: string } = {}): SceneResult {
  return { ok: true, infra: false, message, stdout: extra.stdout ?? JSON.stringify(data), stderr: "", data };
}

/** Canonicalize + validate a scene path into dot-separated segments. */
export function resolveScenePath(p: unknown): { error: string; path?: undefined; segments?: undefined } | ScenePath {
  if (typeof p !== "string" || p.length === 0) return { error: "scene path must be a non-empty string" };
  if (p.length > 500) return { error: "scene path too long (max 500 chars)" };
  if (p.includes("..") || /[;&|`$<>\n\r]/.test(p)) return { error: `invalid scene path: ${p}` };
  const raw = p.trim().replace(/^game\./, "");
  const segments = raw.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return { error: `empty scene path: ${p}` };
  if (segments.length > MAX_PLAN_SEGMENTS) return { error: `scene path too deep (max ${MAX_PLAN_SEGMENTS} segments)` };
  for (const s of segments) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9 _()-]{0,63}$/.test(s)) {
      return { error: `invalid scene path segment: "${s}"` };
    }
  }
  return { segments, path: `game.${segments.join(".")}` };
}

function parentOf(segments: string[]): string[] {
  return segments.slice(0, -1);
}

/** Guard: protected roots may not be destroyed/moved/renamed/reparented. */
export function protectedSceneReason(segments: string[], op: SceneOp): string | null {
  const name = segments[0];
  if (op === "destroy" || op === "move" || op === "rename") {
    if (segments.length <= 1 && (name === "game" || (PROTECTED_SCENE_ROOTS as readonly string[]).includes(name))) {
      return `protected scene root: cannot ${op} "${segments.join(".") || name}"`;
    }
  }
  return null;
}

/** Guard: the Players subtree is runtime-owned, never authored scenery. */
function playersGuard(newParentSegments: string[]): string | null {
  if (newParentSegments[0] === "Players") {
    return "scene editing is not allowed under the Players subtree (authored UI belongs in StarterGui/StarterPlayer)";
  }
  if (newParentSegments.length === 1 && (PROTECTED_SCENE_ROOTS as readonly string[]).includes(newParentSegments[0])) {
    return null;
  }
  return null;
}

function sameUnder(target: string[], parent: string[]): boolean {
  if (parent.length <= target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (parent[i] !== target[i]) return false;
  }
  return true;
}

type ScenePropValue = { key: string; typed: "primitive" | "vec3" | "color3" | "vec2" | "cframe" | "enum"; value: number | boolean | string | number[] };

/** Validate + type a property value using conservative hints. */
export function classifySceneValue(key: string, v: unknown): { error: string } | { value: ScenePropValue } {
  if (key === "Parent" || key === "ClassName") return { error: `property "${key}" is managed by the scene layer (use move/create)` };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { error: `property "${key}" is not a finite number` };
    return { value: { key, typed: "primitive", value: v } };
  }
  if (typeof v === "boolean") return { value: { key, typed: "primitive", value: v } };
  if (typeof v === "string") {
    if (v.length > 500) return { error: `property "${key}" string too long (max 500 chars)` };
    return { value: { key, typed: "primitive", value: v } };
  }
  if (Array.isArray(v)) {
    const hint = PROPERTY_TYPE_HINTS[key];
    const nums = v as unknown[];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return { error: `property "${key}" array must contain only finite numbers` };
    }
    const arr = nums as number[];
    if (arr.length === 3 && (hint === "vec3" || hint === "color3")) {
      if (hint === "color3" && arr.some((n) => n < 0 || n > 1)) {
        return { error: `property "${key}" Color3 channels must be in 0..1` };
      }
      return { value: { key, typed: hint, value: arr } };
    }
    if (arr.length === 2 && hint === "vec2") return { value: { key, typed: "vec2", value: arr } };
    if (arr.length === 12 && hint === "cframe") return { value: { key, typed: "cframe", value: arr } };
    return { error: `property "${key}" array shape not supported (hint "${hint ?? "none"}")` };
  }
  return { error: `property "${key}" has unsupported value type (${typeof v})` };
}

export function validateSceneProperties(props: unknown): { error: string } | { values: ScenePropValue[] } {
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return { error: "properties must be a non-empty object" };
  }
  const entries = Object.entries(props as Record<string, unknown>);
  if (entries.length === 0) return { error: "properties must be a non-empty object" };
  if (entries.length > MAX_PROPERTIES_PER_CALL) {
    return { error: `too many properties (max ${MAX_PROPERTIES_PER_CALL} per call)` };
  }
  const values: ScenePropValue[] = [];
  for (const [k, v] of entries) {
    const meta = checkNoShellMeta(k, "property name");
    if (!meta.ok) return { error: meta.reason! };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return { error: `invalid property name: "${k}"` };
    const c = classifySceneValue(k, v);
    if ("error" in c) return { error: c.error };
    values.push(c.value);
  }
  return { values };
}

// ── Luau emission ─────────────────────────────────────────────────

/** Escape a string as a double-quoted Luau literal. Rejects control chars. */
export function emitLuauString(s: string): string | null {
  if (s.length > 200) return null;
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) return null;
    else out += ch;
  }
  return out + '"';
}

function emitLuauValue(v: ScenePropValue): string | null {
  if (v.typed === "primitive") {
    if (typeof v.value === "boolean") return v.value ? "true" : "false";
    if (typeof v.value === "number") return String(v.value);
    return emitLuauString(v.value as string);
  }
  const arr = v.value as number[];
  if (v.typed === "vec3") return `Vector3.new(${arr.join(", ")})`;
  if (v.typed === "color3") return `Color3.new(${arr[0]}, ${arr[1]}, ${arr[2]})`;
  if (v.typed === "vec2") return `Vector2.new(${arr[0]}, ${arr[1]})`;
  if (v.typed === "cframe") return `CFrame.new(${arr.join(", ")})`;
  return null; // enum unsupported via Luau
}

function emitSegments(segments: string[]): string {
  return `{${segments.map((s) => emitLuauString(s) ?? `"?"`).join(", ")}}`;
}

/**
 * Build a guarded Luau mutation chunk. Wraps the mutation in a logger and
 * returns machine-readable JSON via HttpService.
 */
function sceneChunk(opts: {
  segments: string[];
  op: SceneOp;
  resultFields: string;
  body: string[];
  guards?: string[];
  prelude?: string[];
}): string {
  const segLines = emitSegments(opts.segments);
  const lines: string[] = [
    `local Http = game:GetService("HttpService")`,
    `local function resolve(root, segs)`,
    `  local cur = root`,
    `  for _, s in ipairs(segs) do`,
    `    local next = cur:FindFirstChild(s)`,
    `    if not next then return nil end`,
    `    cur = next`,
    `  end`,
    `  return cur`,
    `end`,
    `local segs = ${segLines}`,
    `local target = resolve(game, segs)`,
    `if not target then`,
    `  return Http:JSONEncode({ ok = false, error = "scene target not found: game." .. table.concat(segs, ".") })`,
    `end`,
    ...(opts.guards ?? []),
    ...(opts.prelude ?? []),
    `local ok, res = pcall(function()`,
    ...opts.body,
    `  return true`,
    `end)`,
    `if not ok then`,
    `  return Http:JSONEncode({ ok = false, error = tostring(res) })`,
    `end`,
    `return Http:JSONEncode({ ok = true, op = ${emitLuauString(opts.op) ?? "nil"}, ${opts.resultFields} })`,
  ];
  return lines.join("\n");
}

// ── Bridge read utilities ─────────────────────────────────────────

interface ReadPropsOutcome {
  ok: boolean;
  infra: boolean;
  message: string;
  properties?: Record<string, string>;
  className?: string;
  instancePath?: string;
}

async function readProperties(bridge: StudioBridgeClient, path: string): Promise<ReadPropsOutcome> {
  const r = await bridge.callTool("get_properties", { path });
  if (r.infra) return { ok: false, infra: true, message: r.message };
  if (!r.ok) return { ok: false, infra: false, message: r.message };
  const data = r.data as Record<string, unknown> | undefined;
  const sc = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const structured = (sc.structuredContent && typeof sc.structuredContent === "object" ? (sc.structuredContent as Record<string, unknown>) : sc);
  const props = (structured.properties as Record<string, unknown> | undefined) ?? {};
  const stringProps: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) stringProps[k] = String(v);
  return {
    ok: true,
    infra: false,
    message: "properties read",
    properties: stringProps,
    className: typeof structured.className === "string" ? structured.className : undefined,
    instancePath: typeof structured.instancePath === "string" ? structured.instancePath : undefined,
  };
}

interface StructureNode {
  path?: string;
  name?: string;
  className?: string;
  children?: StructureNode[];
}

interface ReadStructureOutcome {
  ok: boolean;
  infra: boolean;
  message: string;
  node?: StructureNode;
}

async function readStructure(bridge: StudioBridgeClient, path: string, depth = 1): Promise<ReadStructureOutcome> {
  const r = await bridge.callTool("get_datamodel", { path, depth });
  if (r.infra) return { ok: false, infra: true, message: r.message };
  if (!r.ok) return { ok: false, infra: false, message: r.message };
  let node: StructureNode | undefined;
  const data = r.data as Record<string, unknown> | undefined;
  const maybe = data?.structuredContent ?? data;
  if (maybe && typeof maybe === "object" && ("name" in maybe || "children" in maybe)) {
    node = maybe as StructureNode;
  } else if (typeof r.stdout === "string") {
    try {
      const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
      node = (parsed.structuredContent ?? parsed) as StructureNode;
    } catch {
      /* no structured readback */
    }
  }
  if (!node || node.name == null) {
    return { ok: false, infra: false, message: `read-back could not locate instance at "${path}"` };
  }
  return { ok: true, infra: false, message: "structure read", node };
}

function findChild(node: StructureNode | undefined, name: string): StructureNode | undefined {
  if (!node?.children) return undefined;
  return node.children.find((c) => c.name === name);
}

// ── Op implementations ────────────────────────────────────────────

export async function sceneInspect(
  bridge: StudioBridgeClient,
  args: { path?: string; depth?: number }
): Promise<SceneResult> {
  const resolved = resolveScenePath(args.path ?? "game");
  if ("error" in resolved) return failScene(resolved.error);
  if (args.depth != null && (!Number.isInteger(args.depth) || args.depth < 0 || args.depth > 6)) {
    return failScene("depth must be an integer 0..6");
  }
  const r = await bridge.callTool("get_datamodel", { path: resolved.path, depth: args.depth ?? 2 });
  if (r.infra) return infraScene(r.message);
  if (!r.ok) return failScene(r.message);
  const data = r.data as Record<string, unknown> | undefined;
  const maybe = data?.structuredContent ?? data;
  const node = maybe && typeof maybe === "object" && "name" in maybe ? (maybe as StructureNode) : undefined;
  return okScene("scene inspected", {
    op: "inspect",
    path: resolved.path,
    evidence: node ? { structure: node } : {},
  }, { stdout: r.stdout });
}

export async function scenePlan(
  bridge: StudioBridgeClient,
  args: { op: SceneOp; path: string; newParent?: string; newName?: string; confirm?: boolean }
): Promise<SceneResult> {
  const op = args.op ?? "create";
  if (!["create", "clone", "set", "move", "rename", "destroy", "part", "spawn", "folder", "model", "attachment", "ui"].includes(op)) {
    return failScene(`scene.plan does not support op "${op}"`);
  }
  if (op === "destroy" && args.confirm !== true) {
    return failScene("scene.destroy requires confirm:true; preview it with scene.plan first");
  }
  const resolved = resolveScenePath(args.path);
  if ("error" in resolved) return failScene(resolved.error);
  const protectedReason = protectedSceneReason(resolved.segments, op);
  if (protectedReason) return failScene(protectedReason);
  if ((op === "move" || op === "clone") && args.newParent) {
    const np = resolveScenePath(args.newParent);
    if ("error" in np) return failScene(np.error);
    if (np.segments[0] === "Players") return failScene(playersGuard(np.segments)!);
  }
  const before = await readProperties(bridge, resolved.path);
  if (before.infra) return infraScene(before.message);
  if (!before.ok) return failScene(`plan target not readable at "${resolved.path}": ${before.message}`);
  let willChange = true;
  if (op === "rename" && args.newName == null) return failScene("scene.rename requires newName");
  if (op === "destroy" && SCRIPT_CLASSES.has(before.className ?? "")) {
    return failScene(`scene.destroy refuses script instances (${before.className}); use script editing flows instead`);
  }
  return okScene(`scene.plan: simulated "${op}" on "${resolved.path}" (${before.className ?? "instance"}), would change state`, {
    op: "plan",
    path: resolved.path,
    newParent: args.newParent,
    newName: args.newName,
    className: before.className,
    willChange,
    evidence: { beforeProperties: before.properties },
  });
}

export async function sceneCreate(
  bridge: StudioBridgeClient,
  args: { className: string; name: string; parent: string; properties?: Record<string, unknown> }
): Promise<SceneResult> {
  const cc = checkClassName(args.className);
  if (!cc.ok) return failScene(cc.reason!);
  const nc = checkInstanceName(args.name);
  if (!nc.ok) return failScene(nc.reason!);
  const parent = resolveScenePath(args.parent);
  if ("error" in parent) return failScene(parent.error);
  if (parent.segments[0] === "Players") return failScene(playersGuard(parent.segments)!);
  let values: { values: { key: string; typed: string; value: number | boolean | string | number[] }[] } | { error: string } | undefined;
  if (args.properties != null) {
    values = validateSceneProperties(args.properties);
    if ("error" in values) return failScene(values.error);
  }
  const parentBefore = await readStructure(bridge, parent.path, 2);
  if (parentBefore.infra) return infraScene(parentBefore.message);
  if (!parentBefore.ok) return failScene(`parent not readable before create: ${parentBefore.message}`);

  const propLines: string[] = [];
  if (values && "values" in values) {
    for (const v of values.values) {
      const luau = emitLuauValue(v as never);
      if (luau == null) return failScene(`property "${v.key}" cannot be emitted as Luau`);
      propLines.push(`inst.${v.key} = ${luau}`);
    }
  }
  const body = [
    `local inst = Instance.new(${emitLuauString(args.className) ?? "nil"})`,
    `if not inst then error("unsupported class") end`,
    `inst.Name = ${emitLuauString(args.name) ?? "nil"}`,
    ...propLines,
    `inst.Parent = target`,
    `createdName = inst.Name`,
  ];
  const chunk = sceneChunk({
    segments: parent.segments,
    op: "create",
    guards: [playersGuardLines(parent.segments, "parent").join("\n")],
    prelude: [`local createdName`],
    body,
    resultFields: `createdPath = "game." .. table.concat(segs, ".") .. "." .. createdName, className = ${emitLuauString(args.className) ?? "nil"}`,
  });
  const exec = await bridge.callTool("eval_luau", { source: chunk, peer: "edit" });
  if (exec.infra) return infraScene(exec.message);
  if (!exec.ok) return failScene(exec.message);
  const outcome = parseChunkEnvelope(exec.stdout);
  const chunkErr = chunkOutcomeError(outcome);
  if (chunkErr) return failScene(`scene.create failed in Luau: ${chunkErr}`);
  const createdPath = extractCreatedPath(exec.stdout, parent.segments);
  if (!createdPath) return failScene("scene op executed but read-back could not determine the created path");

  // Read-back verification: re-read parent structure, locate the new child.
  const parentAfter = await readStructure(bridge, parent.path, 3);
  if (parentAfter.infra) return infraScene(parentAfter.message);
  const lastSeg = createdPath.split(".").pop() ?? args.name;
  const child = parentAfter.ok ? findChild(parentAfter.node, lastSeg) : undefined;
  const afterProps = await readProperties(bridge, createdPath);
  if (!parentAfter.ok || !child || !afterProps.ok || afterProps.properties?.["Name"] !== lastSeg) {
    return failScene(`scene.create executed but read-back could not confirm "${lastSeg}" under "${parent.path}" (parent read-back gave ${parentAfter.message})`);
  }
  return okScene(`scene.create succeeded: ${args.className} "${createdPath}"`, {
    op: "create",
    path: parent.path,
    parentPath: parent.path,
    className: args.className,
    createdPath,
    evidence: { parentBefore: parentBefore.node, parentAfter: parentAfter.node, afterProperties: afterProps.properties },
  });
}

export async function sceneClone(
  bridge: StudioBridgeClient,
  args: { path: string; newName?: string; newParent: string }
): Promise<SceneResult> {
  const resolved = resolveScenePath(args.path);
  if ("error" in resolved) return failScene(resolved.error);
  const protectedReason = protectedSceneReason(resolved.segments, "clone");
  if (protectedReason) return failScene(protectedReason);
  const parentSeg = parentOf(resolved.segments);
  if (parentSeg.length === 0) return failScene("cannot clone a top-level container");
  const newParent = resolveScenePath(args.newParent);
  if ("error" in newParent) return failScene(newParent.error);
  if (newParent.segments[0] === "Players") return failScene(playersGuard(newParent.segments)!);
  if (sameUnder(resolved.segments, newParent.segments)) {
    return failScene("scene.clone newParent may not be a descendant of the target");
  }
  if (args.newName != null) {
    const nc = checkInstanceName(args.newName);
    if (!nc.ok) return failScene(nc.reason!);
  }

  const before = await readProperties(bridge, resolved.path);
  if (before.infra) return infraScene(before.message);
  if (!before.ok) return failScene(`clone target not readable: ${before.message}`);
  if (SCRIPT_CLASSES.has(before.className ?? "")) {
    return failScene(`scene.clone refuses script instances (${before.className}); use script flows instead`);
  }
  const parentBefore = await readStructure(bridge, parentSeg.join(".") ? `game.${parentSeg.join(".")}` : "game", 2);
  if (parentBefore.infra) return infraScene(parentBefore.message);

  const cloneName = args.newName ?? resolved.segments[resolved.segments.length - 1];
  const body = [
    `local clone = target:Clone()`,
    `clone.Name = ${emitLuauString(cloneName) ?? "nil"}`,
    `clone.Parent = resolve(game, ${emitSegments(newParent.segments)})`,
    `createdName = clone.Name`,
  ];
  const chunk = sceneChunk({
    segments: resolved.segments,
    op: "clone",
    guards: [playersGuardLines(newParent.segments, "newParent").join("\n")],
    prelude: [`local createdName`],
    body,
    resultFields: `createdPath = "game." .. table.concat(${emitSegments(newParent.segments)}, ".") .. "." .. createdName, className = ${emitLuauString(before.className ?? "") ?? "nil"}`,
  });
  const exec = await bridge.callTool("eval_luau", { source: chunk, peer: "edit" });
  if (exec.infra) return infraScene(exec.message);
  if (!exec.ok) return failScene(exec.message);
  const cloneOutcome = parseChunkEnvelope(exec.stdout);
  const cloneErr = chunkOutcomeError(cloneOutcome);
  if (cloneErr) return failScene(`scene.clone failed in Luau: ${cloneErr}`);
  const createdPath = extractCreatedPath(exec.stdout, newParent.segments);
  if (!createdPath) return failScene("scene clone executed but read-back could not determine the cloned path");

  const parentAfter = await readStructure(bridge, newParent.path, 3);
  if (parentAfter.infra) return infraScene(parentAfter.message);
  const lastSeg = createdPath.split(".").pop() ?? cloneName;
  const child = parentAfter.ok ? findChild(parentAfter.node, lastSeg) : undefined;
  const afterProps = await readProperties(bridge, createdPath);
  if (!parentAfter.ok || !child || !afterProps.ok) {
    return failScene(`scene.clone executed but read-back could not confirm "${createdPath}" (${parentAfter.message})`);
  }
  return okScene(`scene.clone succeeded: ${createdPath}`, {
    op: "clone",
    path: resolved.path,
    newParent: newParent.path,
    className: before.className,
    createdPath,
    evidence: { beforeProperties: before.properties, parentBefore: parentBefore.node, parentAfter: parentAfter.node, afterProperties: afterProps.properties },
  });
}

export async function sceneSet(
  bridge: StudioBridgeClient,
  args: { path: string; properties: Record<string, unknown> }
): Promise<SceneResult> {
  const resolved = resolveScenePath(args.path);
  if ("error" in resolved) return failScene(resolved.error);
  if (resolved.segments.length <= 1 && (PROTECTED_SCENE_ROOTS as readonly string[]).includes(resolved.segments[0])) {
    return failScene(`protected scene root: cannot scene.set on "${resolved.segments[0]}"`);
  }
  const props = validateSceneProperties(args.properties);
  if ("error" in props) return failScene(props.error);

  const before = await readProperties(bridge, resolved.path);
  if (before.infra) return infraScene(before.message);
  if (!before.ok) return failScene(`set target not readable: ${before.message}`);

  // Prefer the native set_properties surface when every value is a JSON
  // primitive; fall back to validated Luau emission for vector/color types.
  const allPrimitive = props.values.every((v) => v.typed === "primitive");
  let exec: StudioCallResult;
  if (allPrimitive) {
    const prim: Record<string, unknown> = {};
    for (const v of props.values) prim[v.key] = v.value;
    exec = await bridge.callTool("set_properties", { path: resolved.path, properties: prim });
  } else {
    const propLines = [];
    for (const v of props.values) {
      const luau = emitLuauValue(v as never);
      if (luau == null) return failScene(`property "${v.key}" cannot be emitted as Luau`);
      propLines.push(`target.${v.key} = ${luau}`);
    }
    const chunk = sceneChunk({
      segments: resolved.segments,
      op: "set",
      body: propLines,
      resultFields: `path = "game." .. table.concat(segs, ".")`,
    });
    exec = await bridge.callTool("eval_luau", { source: chunk, peer: "edit" });
  }
  if (exec.infra) return infraScene(exec.message);
  if (!exec.ok) return failScene(exec.message);

  const after = await readProperties(bridge, resolved.path);
  if (after.infra) return infraScene(after.message);
  if (!after.ok) return failScene(`scene.set executed but read-back failed: ${after.message}`);
  const setOutcome = exec.stdout ? parseChunkEnvelope(exec.stdout) : undefined;
  const setErr = chunkOutcomeError(setOutcome);
  if (setErr) return failScene(`scene.set failed in Luau: ${setErr}`);
  const changed = props.values.some((v) => after.properties![v.key] !== before.properties?.[v.key] && after.properties![v.key] !== undefined);
  if (!changed) {
    return failScene(`scene.set executed but read-back shows no change on "${resolved.path}"`);
  }
  return okScene(`scene.set succeeded on "${resolved.path}"`, {
    op: "set",
    path: resolved.path,
    className: before.className,
    evidence: { beforeProperties: before.properties, afterProperties: after.properties },
  });
}

export async function sceneMove(
  bridge: StudioBridgeClient,
  args: { path: string; newParent: string }
): Promise<SceneResult> {
  const resolved = resolveScenePath(args.path);
  if ("error" in resolved) return failScene(resolved.error);
  const protectedReason = protectedSceneReason(resolved.segments, "move");
  if (protectedReason) return failScene(protectedReason);
  const newParent = resolveScenePath(args.newParent);
  if ("error" in newParent) return failScene(newParent.error);
  if (newParent.segments[0] === "Players") return failScene(playersGuard(newParent.segments)!);
  if (sameUnder(resolved.segments, newParent.segments)) {
    return failScene("scene.move newParent may not be a descendant of the target");
  }

  const before = await readProperties(bridge, resolved.path);
  if (before.infra) return infraScene(before.message);
  if (!before.ok) return failScene(`move target not readable: ${before.message}`);
  const parentPath = parentOf(resolved.segments).length ? `game.${parentOf(resolved.segments).join(".")}` : "game";
  const parentBefore = await readStructure(bridge, parentPath, 2);
  if (parentBefore.infra) return infraScene(parentBefore.message);
  const newParentBefore = await readStructure(bridge, newParent.path, 2);
  if (newParentBefore.infra) return infraScene(newParentBefore.message);

  const chunk = sceneChunk({
    segments: resolved.segments,
    op: "move",
    guards: [playersGuardLines(newParent.segments, "newParent").join("\n")],
    body: [`target.Parent = resolve(game, ${emitSegments(newParent.segments)})`],
    resultFields: `path = "game." .. table.concat(segs, "."), newParent = "game." .. table.concat(${emitSegments(newParent.segments)}, ".")`,
  });
  const exec = await bridge.callTool("eval_luau", { source: chunk, peer: "edit" });
  if (exec.infra) return infraScene(exec.message);
  if (!exec.ok) return failScene(exec.message);
  const moveOutcome = parseChunkEnvelope(exec.stdout);
  const moveErr = chunkOutcomeError(moveOutcome);
  if (moveErr) return failScene(`scene.move failed in Luau: ${moveErr}`);

  const parentAfter = await readStructure(bridge, parentPath, 3);
  if (parentAfter.infra) return infraScene(parentAfter.message);
  const newParentAfter = await readStructure(bridge, newParent.path, 3);
  if (newParentAfter.infra) return infraScene(newParentAfter.message);
  const movedName = resolved.segments[resolved.segments.length - 1];
  const stillInOld = Boolean(findChild(parentAfter.node, movedName));
  const inNew = Boolean(findChild(newParentAfter.node, movedName));
  if (stillInOld || !inNew) {
    return failScene(`scene.move executed but read-back does not confirm move: old=${!stillInOld}, new=${inNew}`);
  }
  const after = await readProperties(bridge, `game.${newParent.segments.join(".")}.${movedName}`);
  return okScene(`scene.move succeeded: moved "${movedName}" into "${newParent.path}"`, {
    op: "move",
    path: resolved.path,
    newParent: newParent.path,
    className: before.className,
    evidence: { parentBefore: newParentBefore.node, parentAfter: newParentAfter.node, beforeProperties: before.properties, afterProperties: after.ok ? after.properties : undefined },
  });
}

export async function sceneRename(
  bridge: StudioBridgeClient,
  args: { path: string; newName: string }
): Promise<SceneResult> {
  const resolved = resolveScenePath(args.path);
  if ("error" in resolved) return failScene(resolved.error);
  const protectedReason = protectedSceneReason(resolved.segments, "rename");
  if (protectedReason) return failScene(protectedReason);
  const nc = checkInstanceName(args.newName);
  if (!nc.ok) return failScene(nc.reason!);

  const before = await readProperties(bridge, resolved.path);
  if (before.infra) return infraScene(before.message);
  if (!before.ok) return failScene(`rename target not readable: ${before.message}`);

  const chunk = sceneChunk({
    segments: resolved.segments,
    op: "rename",
    body: [`target.Name = ${emitLuauString(args.newName) ?? "nil"}`],
    resultFields: `path = "game." .. table.concat(segs, ".")`,
  });
  const exec = await bridge.callTool("eval_luau", { source: chunk, peer: "edit" });
  if (exec.infra) return infraScene(exec.message);
  if (!exec.ok) return failScene(exec.message);
  const renameOutcome = parseChunkEnvelope(exec.stdout);
  const renameErr = chunkOutcomeError(renameOutcome);
  if (renameErr) return failScene(`scene.rename failed in Luau: ${renameErr}`);

  const newPathSegs = [...resolved.segments.slice(0, -1), args.newName];
  const after = await readProperties(bridge, `game.${newPathSegs.join(".")}`);
  if (after.infra) return infraScene(after.message);
  if (!after.ok) return failScene(`scene.rename executed but read-back failed at new path: ${after.message}`);
  if (after.properties?.["Name"] !== args.newName) {
    return failScene(`scene.rename executed but read-back Name is "${after.properties?.["Name"]}" (expected "${args.newName}")`);
  }
  return okScene(`scene.rename succeeded: "${resolved.path}" -> "${args.newName}"`, {
    op: "rename",
    path: resolved.path,
    newName: args.newName,
    className: before.className,
    evidence: { beforeProperties: before.properties, afterProperties: after.properties },
  });
}

export async function sceneDestroy(
  bridge: StudioBridgeClient,
  args: { path: string; confirm?: boolean }
): Promise<SceneResult> {
  if (args.confirm !== true) {
    return failScene("scene.destroy requires confirm:true (destructive; run scene.plan to preview first)");
  }
  const resolved = resolveScenePath(args.path);
  if ("error" in resolved) return failScene(resolved.error);
  const protectedReason = protectedSceneReason(resolved.segments, "destroy");
  if (protectedReason) return failScene(protectedReason);
  const parentSeg = parentOf(resolved.segments);
  if (parentSeg.length === 0) return failScene("cannot destroy a top-level container");

  const before = await readProperties(bridge, resolved.path);
  if (before.infra) return infraScene(before.message);
  if (!before.ok) return failScene(`destroy target not readable: ${before.message}`);
  if (SCRIPT_CLASSES.has(before.className ?? "")) {
    return failScene(`scene.destroy refuses script instances (${before.className}); use script editing flows instead`);
  }
  const parentPath = `game.${parentSeg.join(".")}`;
  const parentBefore = await readStructure(bridge, parentPath, 2);
  if (parentBefore.infra) return infraScene(parentBefore.message);

  const chunk = sceneChunk({
    segments: resolved.segments,
    op: "destroy",
    body: [`target.Parent = nil`, `target:Destroy()`],
    resultFields: `path = "game." .. table.concat(segs, ".")`,
  });
  const exec = await bridge.callTool("eval_luau", { source: chunk, peer: "edit" });
  if (exec.infra) return infraScene(exec.message);
  if (!exec.ok) return failScene(exec.message);
  const destroyOutcome = parseChunkEnvelope(exec.stdout);
  const destroyErr = chunkOutcomeError(destroyOutcome);
  if (destroyErr) return failScene(`scene.destroy failed in Luau: ${destroyErr}`);

  const parentAfter = await readStructure(bridge, parentPath, 3);
  if (parentAfter.infra) return infraScene(parentAfter.message);
  const gone = parentAfter.ok ? !findChild(parentAfter.node, resolved.segments[resolved.segments.length - 1]) : false;
  if (!gone) {
    return failScene(`scene.destroy executed but read-back still finds "${resolved.path}"`);
  }
  return okScene(`scene.destroy succeeded: removed "${resolved.path}"`, {
    op: "destroy",
    path: resolved.path,
    className: before.className,
    evidence: { parentBefore: parentBefore.node, parentAfter: parentAfter.node, beforeProperties: before.properties },
  });
}

// ── Typed shortcuts ───────────────────────────────────────────────

const SHORTCUT_CLASS: Record<string, string> = {
  part: "Part",
  spawn: "SpawnLocation",
  folder: "Folder",
  model: "Model",
  attachment: "Attachment",
  ui: "ScreenGui",
};

export async function sceneTypedCreate(
  bridge: StudioBridgeClient,
  kind: Exclude<SceneOp, "inspect" | "plan" | "create" | "clone" | "set" | "move" | "rename" | "destroy">,
  args: { name: string; parent: string; properties?: Record<string, unknown> }
): Promise<SceneResult> {
  const cls = SHORTCUT_CLASS[kind];
  if (!cls) return failScene(`unknown scene shortcut: ${kind}`);
  const extraProps = {
    ...(args.properties as Record<string, unknown> | undefined),
  };
  if (kind === "spawn" && extraProps.Anchored == null) extraProps.Anchored = true;
  if (kind === "part" && extraProps.Anchored == null) extraProps.Anchored = true;
  if (kind === "ui" && extraProps.ResetOnSpawn == null) extraProps.ResetOnSpawn = false;
  if (kind === "attachment" && extraProps.WorldPosition == null) {
    extraProps.WorldPosition = [0, 0, 0] as unknown[];
  }
  const base = await sceneCreate(bridge, { className: cls, name: args.name, parent: args.parent, properties: extraProps });
  if (base.data) base.data.op = kind;
  return base;
}

// ── Helpers ───────────────────────────────────────────────────────

function parseChunkEnvelope(text: string): Record<string, unknown> | undefined {
  if (!text) return undefined;
  const attempt = (raw: string): Record<string, unknown> | undefined => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    return undefined;
  };
  const outer = attempt(text);
  if (outer && typeof outer.returnValue === "string") {
    return attempt(outer.returnValue) ?? outer;
  }
  return outer;
}

/** Early-fail when our emitted Luau chunk itself reported an error. */
function chunkOutcomeError(outcome: Record<string, unknown> | undefined): string | undefined {
  if (outcome && outcome.ok === false && typeof outcome.error === "string") return outcome.error;
  return undefined;
}

function extractCreatedPath(stdout: string, parentSegments: string[]): string | null {
  const parsed = parseChunkEnvelope(stdout);
  if (parsed && typeof parsed.createdPath === "string" && parsed.createdPath.startsWith(`game.${parentSegments.join(".")}`)) {
    return parsed.createdPath;
  }
  const m = stdout.match(/"createdPath"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  const fallback = stdout.match(/createdPath\s*=\s*"([^"]+)"/);
  if (fallback) return fallback[1];
  return null;
}

function playersGuardLines(segments: string[], label: string): string[] {
  // Belt-and-suspenders: re-check the Players subtree inside Luau too.
  const labelLit = emitLuauString(label) ?? '"target"';
  return [
    `local np = resolve(game, ${emitSegments(segments)})`,
    `if not np then error(${labelLit} .. " not found") end`,
    `local npRoot = np`,
    `while npRoot.Parent ~= nil do npRoot = npRoot.Parent end`,
    `if npRoot == game:GetService("Players") then error("protected: scene editing under Players is not allowed") end`,
  ];
}