#!/usr/bin/env tsx
/**
 * Roblox end-to-end smoke test through the REAL factory provisioning path.
 *
 * Usage:
 *   npx tsx factory/roblox/smoke-provision.ts [--project-id <id>] [--force]
 *
 * What it does (no fakes, no hand-made fixtures):
 *   1. Provisions a project via ProjectProvisioner (the same class
 *      executeGameMission uses) from `roblox-rojo-template`.
 *   2. Builds a Mission with Roblox context and runs the deterministic
 *      Planner to prove Roblox routing (engine/stack/template/workspace +
 *      Luau acceptance criteria, no Visual QA).
 *   3. Implements a minimal coin-simulator feature in Luau (server-authoritative
 *      coin spawner, upgrade RemoteFunction with server validation, shop
 *      LocalScript) — the same files a programmer agent would write.
 *   4. Validates the result through ValidationGate (Roblox/Rojo path:
 *      structural + Luau + `rojo build` where Rojo is installed).
 *
 * Exit code 0 on PASS, 1 on FAIL, 2 on BLOCKED (Rojo missing = infra).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ProjectProvisioner } from "../mission/project-provisioner.js";
import { ValidationGate } from "../mission/validation-gate.js";
import { createMission, createDelegation } from "../mission/mission.js";
import { createPlanner } from "../mission/planner.js";
import { isRobloxMission } from "./platform.js";

const GOAL =
  "Create a Roblox simulator with a player spawn and collectible coins.";

function parseArgs(argv: string[]): { projectId: string; force: boolean } {
  let projectId = "roblox-coin-sim-smoke";
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project-id") projectId = argv[++i] ?? projectId;
    if (argv[i] === "--force") force = true;
  }
  return { projectId, force };
}

const COIN_SPAWNER = `-- CoinSpawner: server-authoritative collectible coins.
-- Coins spawn on the server, collection is granted by the server only.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local template = Instance.new("Part")
template.Name = "Coin"
template.Shape = Enum.PartType.Ball
template.Size = Vector3.new(2, 2, 2)
template.BrickColor = BrickColor.new("Bright yellow")
template.Anchored = true
template.CanCollide = false

local collected = {} :: { [BasePart]: boolean }

local function grantCoin(player: Player, coin: BasePart)
	if collected[coin] then
		return
	end
	collected[coin] = true
	local leaderstats = player:FindFirstChild("leaderstats")
	local coinsValue = leaderstats and leaderstats:FindFirstChild("Coins")
	if coinsValue and coinsValue:IsA("IntValue") then
		coinsValue.Value += Config.COIN_VALUE
	end
	coin:Destroy()
	task.delay(Config.COIN_RESPAWN_SECONDS, function()
		collected[coin] = nil
		spawnCoin()
	end)
end

function spawnCoin()
	local coin = template:Clone()
	coin.Position = Vector3.new(math.random(-40, 40), 4, math.random(-40, 40))
	coin.Parent = Workspace
	coin.Touched:Connect(function(hit: BasePart)
		local character = hit:FindFirstAncestorOfClass("Model")
		local player = character and Players:GetPlayerFromCharacter(character)
		if player then
			grantCoin(player, coin)
		end
	end)
end

for _ = 1, 8 do
	task.spawn(spawnCoin)
end

print("[AI FACTORY] CoinSpawner online")
`;

const UPGRADE_SHOP = `-- UpgradeShop: server-validated movement-speed upgrades.
-- Clients invoke the RemoteFunction; the server owns coins and walk speed.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local CoinService = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinService"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")

local upgradeFn = Instance.new("RemoteFunction")
upgradeFn.Name = "UpgradeShop"
upgradeFn.Parent = remotes

local function applySpeed(player: Player, level: number)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = CoinService.nextWalkSpeed(
			Config.START_WALK_SPEED,
			Config.SPEED_UPGRADE_STEP,
			Config.SPEED_UPGRADE_MAX,
			level
		)
	end
end

upgradeFn.OnServerInvoke = function(player: Player)
	local leaderstats = player:FindFirstChild("leaderstats")
	local coinsValue = leaderstats and leaderstats:FindFirstChild("Coins")
	if not (coinsValue and coinsValue:IsA("IntValue")) then
		return false, "no leaderstats"
	end
	local level = player:GetAttribute("SpeedLevel") or 0
	local cost = CoinService.upgradeCost(Config.UPGRADE_BASE_COST, level)
	if coinsValue.Value < cost then
		return false, "not enough coins"
	end
	coinsValue.Value -= cost
	player:SetAttribute("SpeedLevel", level + 1)
	applySpeed(player, level + 1)
	return true, "upgraded"
end

Players.PlayerAdded:Connect(function(player: Player)
	player:SetAttribute("SpeedLevel", 0)
	player.CharacterAdded:Connect(function()
		applySpeed(player, player:GetAttribute("SpeedLevel") or 0)
	end)
end)

print("[AI FACTORY] UpgradeShop online")
`;

const SHOP_CLIENT = `-- Shop client: requests speed upgrades through the server-validated remote.
-- Display only: the server decides whether the purchase succeeds.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local upgradeFn = remotes:WaitForChild("UpgradeShop") :: RemoteFunction

local function requestUpgrade()
	local ok, result = pcall(function()
		return upgradeFn:InvokeServer()
	end)
	if ok then
		print("[AI FACTORY] Upgrade result:", result)
	else
		warn("[AI FACTORY] Upgrade failed:", result)
	end
end

-- Demo hook: expose for bound UI buttons (StarterGui) to call.
_G.RequestSpeedUpgrade = requestUpgrade

print("[AI FACTORY] Shop client online")
`;

async function main(): Promise<void> {
  const { projectId, force } = parseArgs(process.argv.slice(2));
  const baseDir = path.resolve(process.env.AI_FACTORY_HOME ?? process.cwd());

  console.log("GOAL:", GOAL);
  console.log("BASE:", baseDir);

  const provisioner = new ProjectProvisioner({
    baseDir,
    templatesDir: path.join(baseDir, "templates"),
    projectsDir: path.join(baseDir, "projects"),
    allowedTemplateIds: ["phaser-generic-web-template", "yagames-phaser-template", "roblox-rojo-template"],
  });

  const projectPath = path.join(baseDir, "projects", projectId);
  try {
    await fs.access(projectPath);
    if (!force) {
      console.error(`Project already exists at ${projectPath}. Re-run with --force to replace it.`);
      process.exitCode = 1;
      return;
    }
    await fs.rm(projectPath, { recursive: true, force: true });
  } catch {
    // does not exist — proceed
  }

  // 1. Provision through the real factory path.
  const handle = await provisioner.provision("roblox-rojo-template", projectId);
  console.log(`PROVISIONED: ${handle.templateId} -> ${handle.projectPath}`);

  // 2. Mission context + deterministic planner routing proof.
  const mission = createMission(
    GOAL,
    {
      projectId: handle.projectId,
      engine: "roblox",
      stack: "Roblox + Luau + Rojo",
      template: handle.templateId,
      workspace: handle.projectPath,
      requiresVisualQa: false,
    },
    { maxRepairs: 3, maxDelegations: 20, allowedPipelines: ["game", "engineering"], requireApproval: false }
  );
  console.log(`ROBLOX MISSION: ${isRobloxMission(mission)}`);
  console.log(`VISUAL QA REQUIRED: ${mission.context?.requiresVisualQa === true}`);

  const planner = createPlanner();
  const plan = planner.decompose(mission);
  const impl = plan.delegations.find((d) => (d.stepIds ?? []).includes("implementation"));
  console.log(`PLAN: ${plan.delegations.length} delegations`);
  console.log(`IMPLEMENTATION CRITERIA: ${(impl?.acceptanceCriteria ?? []).join(" | ")}`);
  if (JSON.stringify(plan).includes("npm run build") || JSON.stringify(plan).includes("Phaser")) {
    console.error("PLAN LEAKED WEB COMMANDS INTO A ROBLOX MISSION");
    process.exitCode = 1;
    return;
  }

  // 3. Programmer output: Luau coin-simulator feature.
  await fs.writeFile(path.join(handle.projectPath, "src/ServerScriptService/CoinSpawner.server.lua"), COIN_SPAWNER);
  await fs.writeFile(path.join(handle.projectPath, "src/ServerScriptService/UpgradeShop.server.lua"), UPGRADE_SHOP);
  await fs.writeFile(
    path.join(handle.projectPath, "src/StarterPlayer/StarterPlayerScripts/Shop.client.lua"),
    SHOP_CLIENT
  );
  console.log("IMPLEMENTED: CoinSpawner.server.lua, UpgradeShop.server.lua, Shop.client.lua");

  // 4. Validate through the real ValidationGate (Roblox path).
  const gate = new ValidationGate({ timeoutMs: 60_000 });
  const delegation = createDelegation(mission.id, "obj-impl", "Build Roblox project", "ROLE: builder", "engineering", {
    acceptanceCriteria: ["Rojo validation succeeds"],
  });
  const result = await gate.validate(delegation, mission, handle.projectPath, {
    buildCommand: undefined,
    engine: "roblox",
    timeoutMs: 60_000,
  });

  console.log(`VALIDATION: passed=${result.passed} command="${result.command}"`);
  if (result.stdout) console.log(`STDOUT:\n${result.stdout}`);
  if (result.stderr) console.log(`STDERR:\n${result.stderr}`);

  if (result.passed) {
    console.log(`SMOKE PASS: ${handle.projectPath}`);
    return;
  }
  if (result.stderr.includes("roblox_toolchain:")) {
    console.log(`SMOKE BLOCKED (infrastructure): Rojo not installed. Structural checks passed up to the Rojo build.`);
    process.exitCode = 2;
    return;
  }
  console.error("SMOKE FAIL: Roblox validation reported a project bug.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("SMOKE ERROR:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
