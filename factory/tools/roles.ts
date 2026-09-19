import type { ToolDefinition, ToolRole } from "./types.js";

/**
 * Role → tool-id permission matrix.
 *
 * Mirrors §4 of the master task. The ToolRegistry enforces this matrix at
 * runtime; the OpenCode bash-permission profiles in
 * factory/permissions/permission-profiles.ts enforce the shell-level
 * equivalent. Keep both in sync when adding tools.
 *
 * Tool ids are defined in factory/tools/registry.ts (BUILTIN_TOOLS) and
 * factory/studio/tools.ts (STUDIO_TOOL_DEFS).
 */

export const ROLE_TOOLS: Record<ToolRole, string[]> = {
  programmer: [
    "script.read",
    "script.edit",
    "luau.execute",
    "luau.validate",
    "rojo.build",
    "toolchain.stylua",
    "toolchain.selene",
    "toolchain.lune",
    "studio.play",
    "studio.stop",
    "studio.output",
    "studio.inspect",
    "studio.delete",
    "gamesystem.use",
    "gameplay.create",
    "scene.inspect",
    "scene.plan",
    "scene.create",
    "scene.clone",
    "scene.set",
    "scene.move",
    "scene.rename",
    "scene.destroy",
    "scene.part",
    "scene.spawn",
    "scene.folder",
    "scene.model",
    "scene.attachment",
  ],
  builder: [
    "script.read",
    "script.edit",
    "luau.validate",
    "rojo.build",
    "toolchain.stylua",
    "toolchain.lune",
    "studio.inspect",
    "gamesystem.use",
    "gameplay.create",
    "scene.inspect",
    "scene.plan",
    "scene.create",
    "scene.clone",
    "scene.set",
    "scene.move",
    "scene.rename",
    "scene.part",
    "scene.spawn",
    "scene.folder",
    "scene.model",
  ],
  visual: [
    "studio.inspect",
    "studio.create",
    "studio.modify",
    "studio.delete",
    "studio.terrain",
    "studio.lighting",
    "studio.material",
    "asset.search",
    "asset.insert",
    "screenshot.capture",
    "studio.play",
    "scene.inspect",
    "scene.plan",
    "scene.create",
    "scene.clone",
    "scene.set",
    "scene.move",
    "scene.rename",
    "scene.destroy",
    "scene.part",
    "scene.spawn",
    "scene.folder",
    "scene.model",
    "scene.attachment",
  ],
  ui: [
    "studio.ui.create",
    "studio.ui.modify",
    "studio.ui.inspect",
    "screenshot.capture",
    "studio.play",
    "scene.inspect",
    "scene.plan",
    "scene.create",
    "scene.clone",
    "scene.set",
    "scene.move",
    "scene.rename",
    "scene.part",
    "scene.folder",
    "scene.ui",
  ],
  qa: [
    "studio.play",
    "studio.stop",
    "screenshot.capture",
    "studio.output",
    "studio.inspect",
    "runtime.assert",
    "luau.validate",
    "rojo.build",
    "scene.inspect",
    "scene.plan",
  ],
  tester: [
    "studio.play",
    "studio.stop",
    "screenshot.capture",
    "studio.output",
    "studio.inspect",
    "runtime.assert",
    "luau.validate",
    "rojo.build",
    "scene.inspect",
    "scene.plan",
  ],
  researcher: ["research.web", "research.reference", "asset.search", "studio.inspect", "scene.inspect", "scene.plan"],
  market: ["research.web", "research.reference"],
  competitor: ["research.web", "research.reference"],
  idea: ["research.web", "research.reference"],
  director: [
    "research.web",
    "research.reference",
    "studio.inspect",
    "screenshot.capture",
    "studio.output",
    "scene.inspect",
    "scene.plan",
  ],
  designer: [
    "research.web",
    "studio.inspect",
    "screenshot.capture",
    "luau.validate",
    "scene.inspect",
    "scene.plan",
  ],
  gameplay: [
    "script.read",
    "studio.inspect",
    "screenshot.capture",
    "studio.play",
    "gamesystem.use",
    "gameplay.create",
    "scene.inspect",
    "scene.plan",
  ],
  architect: [
    "script.read",
    "studio.inspect",
    "luau.validate",
    "rojo.build",
    "screenshot.capture",
    "scene.inspect",
    "scene.plan",
  ],
  monetization: ["research.web", "studio.inspect", "gamesystem.use", "scene.inspect", "scene.plan"],
  content: [
    "script.read",
    "script.edit",
    "gamesystem.use",
    "gameplay.create",
    "asset.search",
    "asset.insert",
    "scene.inspect",
    "scene.plan",
  ],
  reviewer: [
    "research.web",
    "research.reference",
    "studio.inspect",
    "studio.ui.inspect",
    "screenshot.capture",
    "studio.output",
    "luau.validate",
    "scene.inspect",
    "scene.plan",
  ],
};

/** Destructive tool ids (require dangerous-capable role + validation). */
export const DESTRUCTIVE_TOOLS: ReadonlySet<string> = new Set([
  "studio.delete",
  "studio.modify",
  "studio.terrain",
  "studio.lighting",
  "studio.material",
  "script.edit",
  "luau.execute",
  "studio.play",
  "studio.stop",
  "gameplay.create",
  "asset.insert",
  "scene.create",
  "scene.clone",
  "scene.set",
  "scene.move",
  "scene.rename",
  "scene.destroy",
  "scene.part",
  "scene.spawn",
  "scene.folder",
  "scene.model",
  "scene.attachment",
  "scene.ui",
]);

export function toolsForRole(role: ToolRole): string[] {
  return [...(ROLE_TOOLS[role] ?? [])];
}

export function roleMayUse(role: ToolRole, toolId: string): boolean {
  return (ROLE_TOOLS[role] ?? []).includes(toolId);
}

export function describeRoleTools(role: ToolRole): string {
  return `${role}: ${(ROLE_TOOLS[role] ?? []).join(", ") || "(no tools)"}`;
}

/** All tool ids referenced by roles (for registry completeness checks). */
export function allReferencedToolIds(): string[] {
  return [...new Set(Object.values(ROLE_TOOLS).flat())];
}

export function toolDefinitionStub(id: string): Pick<ToolDefinition, "id"> {
  return { id };
}
