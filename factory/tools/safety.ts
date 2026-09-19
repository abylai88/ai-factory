import path from "node:path";
import type { ToolRole } from "./types.js";

/**
 * Safety layer for tool execution.
 *
 * Enforces:
 *   - project scope (no writes outside the project/tool sandbox)
 *   - path scope (no absolute escapes, no `..`, no protected paths)
 *   - destructive-operation gating (dangerous tools need explicit role grant)
 *   - argument shape validation per tool
 */

export const PROTECTED_SEGMENTS = [
  "factory/",
  "agents/",
  "visual-office/",
  ".git/",
  "node_modules/",
] as const;

const SHELL_META = /[;&|`$><\n\r]/;

export interface ScopeCheck {
  ok: boolean;
  reason?: string;
}

/** Resolve a project-relative path and ensure it stays inside the project. */
export function checkProjectScope(
  projectDir: string,
  targetPath: string
): ScopeCheck {
  if (!targetPath || targetPath.trim().length === 0) {
    return { ok: false, reason: "empty path" };
  }
  if (path.isAbsolute(targetPath)) {
    return { ok: false, reason: `absolute paths are not allowed: ${targetPath}` };
  }
  const normalized = path.posix.normalize(targetPath.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return { ok: false, reason: `path escapes project scope: ${targetPath}` };
  }
  for (const seg of PROTECTED_SEGMENTS) {
    if (normalized === seg.replace(/\/$/, "") || normalized.startsWith(seg)) {
      return { ok: false, reason: `protected path: ${targetPath}` };
    }
  }
  void projectDir;
  return { ok: true };
}

/** Validate a Luau instance name (Instance.Name constraints, conservative). */
export function checkInstanceName(name: string): ScopeCheck {
  if (!name || name.length > 100) return { ok: false, reason: "instance name must be 1..100 chars" };
  if (/[./\\[\]]/.test(name)) return { ok: false, reason: `invalid instance name: ${name}` };
  return { ok: true };
}

/** Validate a Roblox class name against a conservative allowlist. */
const ALLOWED_CLASSES = new Set([
  "Part",
  "SpawnLocation",
  "Model",
  "Folder",
  "IntValue",
  "StringValue",
  "BoolValue",
  "NumberValue",
  "ObjectValue",
  "RemoteEvent",
  "RemoteFunction",
  "BindableEvent",
  "BindableFunction",
  "Script",
  "LocalScript",
  "ModuleScript",
  "ScreenGui",
  "Frame",
  "TextLabel",
  "TextButton",
  "ImageLabel",
  "ImageButton",
  "UIListLayout",
  "UIPadding",
  "UICorner",
  "PointLight",
  "SpotLight",
  "SurfaceLight",
  "ParticleEmitter",
  "Sound",
  "Decal",
  "Texture",
  "MeshPart",
  "WedgePart",
  "CornerWedgePart",
  "CylinderMesh",
  "BlockMesh",
  "SpecialMesh",
  "Seat",
  "VehicleSeat",
  "ProximityPrompt",
  "ClickDetector",
  "BillboardGui",
  "SurfaceGui",
  "Terrain",
  "Lighting",
  "Atmosphere",
  "BloomEffect",
  "ColorCorrectionEffect",
  "SunRaysEffect",
  "DepthOfFieldEffect",
]);

export function checkClassName(className: string): ScopeCheck {
  if (!ALLOWED_CLASSES.has(className)) {
    return { ok: false, reason: `class not allowlisted: ${className}` };
  }
  return { ok: true };
}

/** Reject shell metacharacters in free-form command arguments. */
export function checkNoShellMeta(value: string, field: string): ScopeCheck {
  if (SHELL_META.test(value)) {
    return { ok: false, reason: `${field} contains shell metacharacters` };
  }
  return { ok: true };
}

/** Validate a Luau source path inside a Rojo project. */
export function checkLuauPath(relPath: string): ScopeCheck {
  const scope = checkProjectScope("", relPath);
  if (!scope.ok) return scope;
  const n = relPath.replace(/\\/g, "/");
  if (!n.startsWith("src/")) return { ok: false, reason: "Luau paths must live under src/" };
  if (!(n.endsWith(".lua") || n.endsWith(".luau"))) {
    return { ok: false, reason: "Luau path must end with .lua/.luau" };
  }
  return { ok: true };
}

/** Roles that may invoke destructive tools at all. */
const DESTRUCTIVE_ROLES: ReadonlySet<ToolRole> = new Set([
  "programmer",
  "builder",
  "visual",
  "ui",
  "qa",
  "tester",
  "content",
]);

export function mayInvokeDangerous(role: ToolRole): boolean {
  return DESTRUCTIVE_ROLES.has(role);
}
