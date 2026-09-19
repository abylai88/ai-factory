import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reusable professional game-system library.
 *
 * The Factory must NOT force a weak model to reinvent common Roblox systems.
 * These ModuleScripts are templates/components — agents inspect, copy into
 * the project (transparent, editable Luau), and adapt Config values.
 *
 * Systems: Collectible, Currency, Upgrade, Shop, Checkpoint, Quest, Zone,
 * Teleport, Npc, SaveLoad, DailyReward.
 */

export interface GameSystemDef {
  id: string;
  name: string;
  description: string;
  file: string;
  serverOnly: boolean;
}

export const GAME_SYSTEMS: GameSystemDef[] = [
  { id: "collectible", name: "Collectible", description: "Server-authoritative pickups with respawn + ring layout helper.", file: "Collectible.lua", serverOnly: false },
  { id: "currency", name: "Currency", description: "leaderstats setup + spend/grant (server authority).", file: "Currency.lua", serverOnly: false },
  { id: "upgrade", name: "Upgrade", description: "Cost curve + walk-speed purchase (server authority).", file: "Upgrade.lua", serverOnly: false },
  { id: "shop", name: "Shop", description: "RemoteFunction coin shop catalog + server purchase handler.", file: "Shop.lua", serverOnly: false },
  { id: "checkpoint", name: "Checkpoint", description: "Touch pads that store respawn attributes.", file: "Checkpoint.lua", serverOnly: true },
  { id: "quest", name: "Quest", description: "Attribute-driven progress tracker with one-time reward.", file: "Quest.lua", serverOnly: false },
  { id: "zone", name: "Zone unlock", description: "Coin/level-gated area gate + unlock.", file: "Zone.lua", serverOnly: true },
  { id: "teleport", name: "Teleport", description: "Same-place teleport pad with cooldown.", file: "Teleport.lua", serverOnly: true },
  { id: "npc", name: "NPC interaction", description: "ProximityPrompt talk wiring with server callback.", file: "Npc.lua", serverOnly: true },
  { id: "saveload", name: "Save/Load", description: "DataStore snapshot/apply/load/save with pcall guards (server-only).", file: "SaveLoad.lua", serverOnly: true },
  { id: "dailyreward", name: "Daily reward", description: "Join-streak daily claim with coin grant.", file: "DailyReward.lua", serverOnly: true },
];

function systemsDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function listGameSystems(): GameSystemDef[] {
  return [...GAME_SYSTEMS];
}

export function getGameSystem(id: string): GameSystemDef | undefined {
  return GAME_SYSTEMS.find((s) => s.id === id);
}

export async function loadGameSystemSource(id: string): Promise<string> {
  const def = getGameSystem(id);
  if (!def) throw new Error(`unknown game system: ${id}`);
  return fs.readFile(path.join(systemsDir(), def.file), "utf8");
}

/**
 * Install a game system into a Rojo project as an inspectable ModuleScript.
 * Target: src/ReplicatedStorage/Shared/GameSystems/<File>.lua (shared) or
 * src/ServerScriptService/GameSystems/<File>.lua (server-only).
 */
export async function installGameSystem(
  projectDir: string,
  id: string
): Promise<{ path: string; bytes: number }> {
  const def = getGameSystem(id);
  if (!def) throw new Error(`unknown game system: ${id}`);
  const src = await loadGameSystemSource(id);
  const rel = def.serverOnly
    ? `src/ServerScriptService/GameSystems/${def.file}`
    : `src/ReplicatedStorage/Shared/GameSystems/${def.file}`;
  const full = path.join(projectDir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, src, "utf8");
  return { path: rel, bytes: Buffer.byteLength(src, "utf8") };
}

export function describeGameSystemsForPrompt(): string {
  return GAME_SYSTEMS.map((s) => `- ${s.id}: ${s.description} (${s.serverOnly ? "server-only" : "shared"})`).join("\n");
}
