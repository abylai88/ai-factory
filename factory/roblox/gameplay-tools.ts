import { promises as fs } from "node:fs";
import path from "node:path";
import { checkLuauPath } from "../tools/safety.js";
import { installGameSystem, getGameSystem } from "./game-systems/index.js";

/**
 * Higher-level gameplay tooling.
 *
 * Deterministic helpers that reduce weak-model workload for the
 * highest-value systems only: collectible, upgrade, shop, zone, checkpoint,
 * interaction, npc, quest. Each helper produces TRANSPARENT, inspectable
 * Roblox objects/code the AI can modify afterwards — never opaque blobs.
 *
 * Two output modes:
 *   1. project-file mode (no Studio): writes/adapts Luau under src/ and
 *      ensures the needed game-system ModuleScript is installed.
 *   2. live-Studio mode: callers additionally use studio.create/edit tools
 *      with the returned instance specs.
 */

export type GameplayToolKind =
  | "collectible"
  | "upgrade"
  | "shop"
  | "zone"
  | "checkpoint"
  | "interaction"
  | "npc"
  | "quest";

export interface GameplaySpec {
  kind: GameplayToolKind;
  /** Project-relative Luau files written/ensured. */
  files: string[];
  /** Live-Studio instance operations the agent should apply when connected. */
  instances: Array<{
    op: "create" | "modify";
    className: string;
    name: string;
    parent: string;
    properties?: Record<string, unknown>;
  }>;
  /** Human-readable next steps for the agent. */
  notes: string;
}

const KIND_TO_SYSTEM: Record<GameplayToolKind, string> = {
  collectible: "collectible",
  upgrade: "upgrade",
  shop: "shop",
  zone: "zone",
  checkpoint: "checkpoint",
  interaction: "npc",
  npc: "npc",
  quest: "quest",
};

export function supportedGameplayKinds(): GameplayToolKind[] {
  return Object.keys(KIND_TO_SYSTEM) as GameplayToolKind[];
}

export interface CreateGameplayArgs {
  kind: GameplayToolKind;
  name: string;
  options?: Record<string, unknown>;
}

function checkName(name: string): string | null {
  if (!name || typeof name !== "string") return "name is required";
  if (name.length > 80 || /[./\\[\];|`$<>\n\r]/.test(name)) return `invalid name: ${name}`;
  return null;
}

/**
 * Create a gameplay element in project-file mode. Installs the backing
 * game-system ModuleScript when missing and writes a small wiring script
 * under the correct server container. Idempotent: re-running never
 * duplicates beyond the named wiring file.
 */
export async function createGameplay(
  projectDir: string,
  args: CreateGameplayArgs
): Promise<GameplaySpec> {
  if (!supportedGameplayKinds().includes(args.kind)) {
    throw new Error(`unsupported gameplay kind: ${args.kind} (supported: ${supportedGameplayKinds().join(", ")})`);
  }
  const nameErr = checkName(args.name);
  if (nameErr) throw new Error(nameErr);

  const systemId = KIND_TO_SYSTEM[args.kind];
  const sys = getGameSystem(systemId);
  if (!sys) throw new Error(`no game system for kind: ${args.kind}`);
  await installGameSystem(projectDir, systemId);

  const wiringRel = wiringPathFor(args.kind, args.name);
  const scope = checkLuauPath(wiringRel);
  if (!scope.ok) throw new Error(scope.reason);
  const full = path.join(projectDir, wiringRel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const exists = await fileExists(full);
  if (!exists) {
    await fs.writeFile(full, wiringSourceFor(args.kind, args.name, args.options ?? {}), "utf8");
  }
  return {
    kind: args.kind,
    files: [
      sys.serverOnly
        ? `src/ServerScriptService/GameSystems/${sys.file}`
        : `src/ReplicatedStorage/Shared/GameSystems/${sys.file}`,
      wiringRel,
    ],
    instances: instanceSpecsFor(args.kind, args.name, args.options ?? {}),
    notes:
      `Installed game system "${systemId}" + wiring script ${wiringRel}. ` +
      `Adapt Config values, then validate with rojo build. ` +
      `When Studio is connected, apply the listed instance ops via studio.create.`,
  };
}

function wiringPathFor(kind: GameplayToolKind, name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60) || "Item";
  switch (kind) {
    case "shop":
    case "upgrade":
      return `src/ServerScriptService/Shops/${safe}.server.lua`;
    case "quest":
      return `src/ServerScriptService/Quests/${safe}.server.lua`;
    case "npc":
    case "interaction":
      return `src/ServerScriptService/Npcs/${safe}.server.lua`;
    default:
      return `src/ServerScriptService/Gameplay/${safe}.server.lua`;
  }
}

function wiringSourceFor(kind: GameplayToolKind, name: string, options: Record<string, unknown>): string {
  const header = `-- AI Factory gameplay wiring: ${kind} "${name}".\n-- Generated helper output — adapt freely. Server-authoritative.\n\n`;
  switch (kind) {
    case "collectible": {
      const value = num(options.value, 1);
      const count = Math.min(Math.max(num(options.count, 10), 1), 100);
      return (
        header +
        `local Collectible = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("GameSystems"):WaitForChild("Collectible"))\n\n` +
        `--Coordinator: spawn ${count} "${name}" pickups in a ring around spawn.\n` +
        `local folder = Instance.new("Folder")\n` +
        `folder.Name = "${luaStr(name)}_Pickups"\n` +
        `folder.Parent = workspace\n\n` +
        `local template = Instance.new("Part")\n` +
        `template.Name = "${luaStr(name)}_Template"\n` +
        `template.Size = Vector3.new(2, 2, 2)\n` +
        `template.Shape = Enum.PartType.Ball\n` +
        `template.Material = Enum.Material.Neon\n` +
        `template.Anchored = true\n` +
        `template.CanCollide = false\n\n` +
        `local spawn = workspace:FindFirstChildOfClass("SpawnLocation")\n` +
        `local center = if spawn and spawn:IsA("BasePart") then spawn.Position else Vector3.new(0, 5, 0)\n` +
        `local positions = Collectible.ringPositions(center, 20, ${count}, center.Y + 3)\n` +
        `Collectible.spawn(folder, template, positions, { value = ${value}, respawnSeconds = 5 })\n` +
        `print("[AI FACTORY] collectible '${luaStr(name)}' ready (${count} pickups)")\n`
      );
    }
    case "checkpoint": {
      return (
        header +
        `local Checkpoint = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("GameSystems"):WaitForChild("Checkpoint"))\n\n` +
        `local folder = workspace:FindFirstChild("${luaStr(name)}_Checkpoints")\n` +
        `if folder then\n\tCheckpoint.wireFolder(folder)\n\tprint("[AI FACTORY] checkpoints wired: ${luaStr(name)}")\n` +
        `else\n\twarn("[AI FACTORY] checkpoint folder missing: ${luaStr(name)}_Checkpoints (create pads via studio.create)")\nend\n`
      );
    }
    case "shop":
    case "upgrade": {
      return (
        header +
        `local Shop = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("GameSystems"):WaitForChild("Shop"))\n\n` +
        `local catalog = {\n\t{ id = "speed1", name = "Speed +2", price = 25, kind = "speed", amount = 2 },\n` +
        `\t{ id = "coins10", name = "+10 Coins", price = 0, kind = "coins", amount = 10 },\n}\n` +
        `local remote = game:GetService("ReplicatedStorage"):FindFirstChild("${luaStr(name)}_Shop")\n` +
        `if remote and remote:IsA("RemoteFunction") then\n\tShop.serve(remote, catalog, { statName = "Coins" })\n` +
        `else\n\twarn("[AI FACTORY] shop RemoteFunction missing: ${luaStr(name)}_Shop")\nend\n`
      );
    }
    case "zone": {
      const cost = num(options.cost, 100);
      return (
        header +
        `local Zone = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("GameSystems"):WaitForChild("Zone"))\n\n` +
        `local gate = workspace:FindFirstChild("${luaStr(name)}_Gate")\n` +
        `if gate and gate:IsA("BasePart") then\n\tZone.wireGate(gate, { statName = "Coins", cost = ${cost} })\n` +
        `else\n\twarn("[AI FACTORY] zone gate missing: ${luaStr(name)}_Gate (create via studio.create)")\nend\n`
      );
    }
    case "quest": {
      const goal = Math.min(Math.max(num(options.goal, 10), 1), 10000);
      return (
        header +
        `local Quest = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("GameSystems"):WaitForChild("Quest"))\n\n` +
        `local quest = Quest.new({ id = "${luaStr(name)}", goal = ${goal}, reward = 25 })\n` +
        `_G["Quest_${luaStr(name)}"] = quest\n` +
        `print("[AI FACTORY] quest ready: ${luaStr(name)} (goal ${goal})")\n`
      );
    }
    case "npc":
    case "interaction": {
      return (
        header +
        `local Npc = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("GameSystems"):WaitForChild("Npc"))\n\n` +
        `local npc = workspace:FindFirstChild("${luaStr(name)}")\n` +
        `if npc and npc:IsA("Model") then\n\tNpc.wire(npc, { promptText = "Talk" })\n` +
        `else\n\twarn("[AI FACTORY] npc model missing: ${luaStr(name)} (create via studio.create)")\nend\n`
      );
    }
  }
}

function instanceSpecsFor(
  kind: GameplayToolKind,
  name: string,
  options: Record<string, unknown>
): GameplaySpec["instances"] {
  const safe = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60) || "Item";
  switch (kind) {
    case "collectible":
      return [
        { op: "create", className: "Folder", name: `${safe}_Pickups`, parent: "Workspace" },
        { op: "create", className: "Part", name: `${safe}_Template`, parent: "Workspace", properties: { Anchored: true, CanCollide: false, Shape: "Ball", Material: "Neon", Size: [2, 2, 2] } },
      ];
    case "checkpoint":
      return [
        { op: "create", className: "Folder", name: `${safe}_Checkpoints`, parent: "Workspace" },
        { op: "create", className: "Part", name: `${safe}_Pad1`, parent: `Workspace/${safe}_Checkpoints`, properties: { Anchored: true, Size: [6, 1, 6], Position: [0, 1, 10] } },
      ];
    case "shop":
    case "upgrade":
      return [{ op: "create", className: "RemoteFunction", name: `${safe}_Shop`, parent: "ReplicatedStorage" }];
    case "zone":
      return [
        { op: "create", className: "Part", name: `${safe}_Gate`, parent: "Workspace", properties: { Anchored: true, CanCollide: false, Size: [10, 6, 1], Transparency: 0.5 } },
        { op: "create", className: "Part", name: `${safe}_Floor`, parent: "Workspace", properties: { Anchored: true, Size: [40, 1, 40], Position: [0, 0, 40] } },
      ];
    case "quest":
      return [];
    case "npc":
    case "interaction":
      return [
        { op: "create", className: "Model", name: safe, parent: "Workspace" },
        { op: "create", className: "Part", name: "HumanoidRootPart", parent: `Workspace/${safe}`, properties: { Anchored: true, Size: [2, 3, 1], Position: [5, 4, 0] } },
      ];
    default:
      void options;
      return [];
  }
}

function num(v: unknown, fb: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

function luaStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
