import { promises as fs } from "node:fs";
import path from "node:path";
import type { Mission } from "../mission/mission.js";

/**
 * Roblox platform helpers — the single source of truth for deciding whether
 * a goal / engine / template / project targets Roblox.
 *
 * Web behavior is untouched: these helpers only ADD a Roblox branch wherever
 * the factory previously assumed browser/Phaser/npm.
 */

/** Template ID for the Roblox + Luau + Rojo project template. */
export const ROBLOX_TEMPLATE_ID = "roblox-rojo-template";

/** Engine kind used in MissionContext for Roblox missions. */
export const ROBLOX_ENGINE = "roblox" as const;

/**
 * Goal pattern for Roblox missions. Kept identical to the historical
 * pipeline/game-mission matchers so existing routing behavior is preserved.
 */
export const ROBLOX_GOAL_PATTERN =
  /(^|\W)(roblox|roblox studio|luau|rojo|roblox game|roblox simulator)(\W|$)/i;

export function isRobloxGoal(goal: string | null | undefined): boolean {
  if (!goal) return false;
  return ROBLOX_GOAL_PATTERN.test(goal);
}

export function isRobloxEngine(engine: string | null | undefined): boolean {
  return (engine ?? "").toLowerCase() === "roblox";
}

export function isRobloxTemplate(template: string | null | undefined): boolean {
  return template === ROBLOX_TEMPLATE_ID;
}

/** True when a mission targets Roblox via context OR goal text. */
export function isRobloxMission(mission: Pick<Mission, "goal" | "context">): boolean {
  const ctx = mission.context;
  if (ctx && (isRobloxEngine(ctx.engine) || isRobloxTemplate(ctx.template))) {
    return true;
  }
  return isRobloxGoal(mission.goal);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a directory on disk is a Roblox/Rojo project (presence of
 * `default.project.json`). This is how the factory distinguishes a Roblox
 * workspace from a Web/npm workspace without running any commands.
 */
export async function isRobloxProjectDir(projectDir: string): Promise<boolean> {
  return pathExists(path.join(projectDir, "default.project.json"));
}

export async function hasPackageJson(projectDir: string): Promise<boolean> {
  return pathExists(path.join(projectDir, "package.json"));
}

/** Root markers every provisioned Roblox workspace must contain. */
export const ROBLOX_ROOT_MARKERS: readonly string[] = [
  "default.project.json",
  "src",
  "src/ServerScriptService",
  "src/ReplicatedStorage",
];

/** Source services the Roblox template scaffolds. */
export const ROBLOX_SRC_SERVICES: readonly string[] = [
  "src/ServerScriptService",
  "src/ReplicatedStorage",
  "src/StarterPlayer",
  "src/ServerStorage",
  "src/StarterGui",
];
