import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { StudioBridgeClient } from "../studio/bridge.js";
import { createStudioBridge } from "../studio/mcp-bridge.js";
import { createInstance } from "../studio/tools.js";
import { validateRobloxProject } from "./validation.js";
import { runRojo } from "./rojo.js";
import { runRobloxRuntimeQa } from "./visual-qa.js";

/**
 * True Roblox smoke test helper.
 *
 * Makes the actual Factory:
 *   1. provision a Roblox project (from the template chor from scratch)
 *   2. connect to tools where possible
 *   3. create a real Workspace floor (BasePlate)
 *   4. create a SpawnLocation
 *   5. create collectibles (10 coins ring)
 *   6. validate the project
 *   7. build with Rojo
 *   8. if Studio is connected: Play → runtime inspect → screenshot →
 *      verify the player isn't falling into the void
 *
 * Without Studio, steps 1–7 run locally and step 8 returns BLOCKED with an
 * honest infrastructure reason (never fake success).
 */

export type SmokeStatus = "PASS" | "FAIL" | "BLOCKED";

export interface StudioSmokeResult {
  status: SmokeStatus;
  reason: string;
  steps: Array<{ name: string; status: SmokeStatus; message: string }>;
  durationMs: number;
  screenshotPath?: string;
}

export interface StudioSmokeOptions {
  bridge?: StudioBridgeClient;
  skipRojoBuild?: boolean;
  coinCount?: number;
}

const FLOOR_LUA = `-- AI Factory smoke: guarantees a real floor + spawn so the player never falls into the void.
local workspace = game:GetService("Workspace")

local function ensureFloor()
	if workspace:FindFirstChild("SmokeBasePlate") then
		return workspace.SmokeBasePlate
	end
	local floor = Instance.new("Part")
	floor.Name = "SmokeBasePlate"
	floor.Size = Vector3.new(128, 2, 128)
	floor.Position = Vector3.new(0, 0, 0)
	floor.Anchored = true
	floor.Material = Enum.Material.Grass
	floor.TopSurface = Enum.SurfaceType.Smooth
	floor.Parent = workspace
	return floor
end

local function ensureSpawn(floor)
	local spawn = workspace:FindFirstChildOfClass("SpawnLocation")
	if spawn then
		return spawn
	end
	local s = Instance.new("SpawnLocation")
	s.Name = "SmokeSpawn"
	s.Size = Vector3.new(6, 1, 6)
	s.Position = floor.Position + Vector3.new(0, 3, 0)
	s.Anchored = true
	s.Neutral = true
	s.Parent = workspace
	return s
end

local function ensureCoins(spawn, count)
	local folder = workspace:FindFirstChild("SmokeCoins")
	if folder then
		return folder
	end
	folder = Instance.new("Folder")
	folder.Name = "SmokeCoins"
	folder.Parent = workspace
	local template = Instance.new("Part")
	template.Name = "SmokeCoin"
	template.Shape = Enum.PartType.Ball
	template.Size = Vector3.new(2, 2, 2)
	template.Material = Enum.Material.Neon
	template.Color = Color3.fromRGB(255, 200, 40)
	template.Anchored = true
	template.CanCollide = false
	for i = 1, count do
		local angle = (math.pi * 2 * (i - 1)) / count
		local coin = template:Clone()
		coin.Position = spawn.Position + Vector3.new(math.cos(angle) * 20, 3, math.sin(angle) * 20)
		coin.Parent = folder
	end
	template:Destroy()
	return folder
end

local floor = ensureFloor()
local spawn = ensureSpawn(floor)
ensureCoins(spawn, COIN_COUNT_PLACEHOLDER)
print("[SMOKE] floor + spawn + coins ready")
`;

export async function ensureSmokeGeometry(projectDir: string, coinCount = 10): Promise<string[]> {
  const rel = "src/ServerScriptService/SmokeGeometry.server.lua";
  const full = path.join(projectDir, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, FLOOR_LUA.replaceAll("COIN_COUNT_PLACEHOLDER", String(coinCount)), "utf8");
  return [rel];
}

export async function runStudioSmoke(
  projectDir: string,
  opts: StudioSmokeOptions = {}
): Promise<StudioSmokeResult> {
  const start = Date.now();
  const steps: StudioSmokeResult["steps"] = [];
  const push = (name: string, status: SmokeStatus, message: string) => {
    steps.push({ name, status, message });
  };

  // 1. project present
  try {
    await fs.access(path.join(projectDir, "default.project.json"));
    push("provision", "PASS", "roblox project present");
  } catch {
    push("provision", "FAIL", "missing default.project.json");
    return { status: "FAIL", reason: "not a Roblox project", steps, durationMs: Date.now() - start };
  }

  // 2–5. floor + spawn + coins (project-file mode; live Studio ops bonus)
  const coinCount = opts.coinCount ?? 10;
  const written = await ensureSmokeGeometry(projectDir, coinCount);
  push("geometry-files", "PASS", `wrote ${written.join(", ")} (floor + SpawnLocation + ${coinCount} coins)`);

  const bridge = opts.bridge ?? createStudioBridge();
  const discovery = await bridge.discover();
  if (discovery.pluginConnected) {
    const floor = await createInstance(bridge, {
      className: "Part",
      name: "SmokeBasePlate",
      parent: "Workspace",
      properties: { Anchored: true, Size: [128, 2, 128] },
    });
    push("studio-floor", floor.ok ? "PASS" : "BLOCKED", floor.message.slice(0, 300));
    const spawn = await createInstance(bridge, {
      className: "SpawnLocation",
      name: "SmokeSpawn",
      parent: "Workspace",
      properties: { Anchored: true, Neutral: true },
    });
    push("studio-spawn", spawn.ok ? "PASS" : "BLOCKED", spawn.message.slice(0, 300));
  } else {
    push("studio-connect", "BLOCKED", `Studio not connected (${discovery.message}) — live create skipped, file-mode geometry used`);
  }

  // 6. validate
  const validation = await validateRobloxProject(projectDir, { runRojoBuild: false });
  push("validate", validation.status === "PASS" ? "PASS" : validation.status === "BLOCKED" ? "BLOCKED" : "FAIL", validation.reason.slice(0, 300));
  if (validation.status !== "PASS") {
    return {
      status: validation.status,
      reason: validation.reason,
      steps,
      durationMs: Date.now() - start,
    };
  }

  // 7. rojo build
  if (!opts.skipRojoBuild) {
    const outFile = path.join(os.tmpdir(), `studio-smoke-${Date.now()}.rbxlx`);
    const built = await runRojo(["build", "default.project.json", "--output", outFile], { cwd: projectDir, timeoutMs: 90_000 });
    try {
      await fs.rm(outFile, { force: true });
    } catch {
      // cleanup
    }
    if (!built.ok) {
      if (built.infraError || built.exitCode === 127) {
        push("rojo-build", "BLOCKED", built.stderr.slice(0, 300));
        return { status: "BLOCKED", reason: built.stderr.slice(0, 500), steps, durationMs: Date.now() - start };
      }
      push("rojo-build", "FAIL", built.stderr.slice(0, 300));
      return { status: "FAIL", reason: built.stderr.slice(0, 500), steps, durationMs: Date.now() - start };
    }
    push("rojo-build", "PASS", "rojo build succeeded");
  }

  // 8. live runtime QA when Studio is available, else honest BLOCKED tail.
  if (!discovery.pluginConnected) {
    push("playtest", "BLOCKED", "static gates passed; live playtest pending Studio connection");
    return {
      status: "BLOCKED",
      reason: "static smoke gates passed (validate + rojo build); live Studio playtest BLOCKED — open Studio with the MCP plugin and retry",
      steps,
      durationMs: Date.now() - start,
    };
  }
  const qa = await runRobloxRuntimeQa(projectDir, { bridge, runRojoBuild: false });
  push("playtest", qa.status, qa.reason.slice(0, 300));
  return {
    status: qa.status,
    reason: qa.reason,
    steps,
    durationMs: Date.now() - start,
    screenshotPath: qa.screenshotPath,
  };
}
