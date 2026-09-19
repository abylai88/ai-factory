import { promises as fs } from "node:fs";
import path from "node:path";

export type EngineKind = "web" | "roblox" | "unity" | "unknown";

export interface EngineInfo {
  kind: EngineKind;
  stack?: string;
  supported: boolean;
  reason: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const WEB_KEYWORDS = [
  "web", "html5", "html", "browser", "browser-based", "browser based",
  "casual", "puzzle", "match-3", "match3", "clicker", "idle",
  "arcade", "hyper-casual", "hypercasual", "2d", "tile", "card",
  "yandex", "ya-games", "prototype", "mini-game", "minigame"
];

const UNITY_KEYWORDS = [
  "unity", "3d", "2d-game", "mobile 3d", "gameobject", "c#", "csharp"
];

const ROBLOX_KEYWORDS = [
  "roblox",
  "roblox studio",
  "luau",
  "rojo",
  "roblox game",
  "roblox simulator"
];

/**
 * Classify the target engine for a NEW game goal. This deliberately does NOT
 * look at any existing project on disk — the engine is decided from the goal
 * (and/or an explicit --engine override) BEFORE a workspace is created.
 *
 * `explicit` takes precedence when provided ("web" | "unity" | ...).
 */
export function classifyGoal(
  goal: string,
  explicit?: string
): EngineInfo {
  const g = (goal ?? "").toLowerCase();

  if (explicit) {
    const e = explicit.toLowerCase();
    if (e === "web" || e === "html5" || e === "browser") {
      return {
        kind: "web",
        stack: "Phaser + TypeScript + Webpack",
        supported: true,
        reason: `Explicit engine requested: ${explicit}`
      };
    }
    if (e === "roblox" || e === "luau") {
      return {
        kind: "roblox",
        stack: "Roblox + Luau + Rojo",
        supported: true,
        reason: `Explicit engine requested: ${explicit}`
      };
    }

    if (e === "unity") {
      return {
        kind: "unity",
        supported: false,
        reason:
          "Unity requested, but no Unity adapter/template exists yet. " +
          "WEB (Phaser + TypeScript + Webpack) is the supported engine."
      };
    }
    return {
      kind: "unknown",
      supported: false,
      reason: `Unknown engine requested: ${explicit}`
    };
  }

  if (ROBLOX_KEYWORDS.some((k) => g.includes(k))) {
    return {
      kind: "roblox",
      stack: "Roblox + Luau + Rojo",
      supported: true,
      reason: `Goal classified as a Roblox game (keyword match: ${g}).`
    };
  }

  if (UNITY_KEYWORDS.some((k) => g.includes(k))) {
    return {
      kind: "unity",
      supported: false,
      reason:
        "Goal looks like a Unity/3D game, but no Unity adapter/template exists yet. " +
        "WEB (Phaser + TypeScript + Webpack) is the supported engine."
    };
  }

  if (
    WEB_KEYWORDS.some((k) => g.includes(k)) ||
    g.trim().length > 0
  ) {
    return {
      kind: "web",
      stack: "Phaser + TypeScript + Webpack",
      supported: true,
      reason: `Goal classified as a WEB/casual/puzzle game (keyboard: ${g}).`
    };
  }

  return {
    kind: "unknown",
    supported: false,
    reason: `Could not identify engine for goal: "${goal}".`
  };
}

/**
 * Detect the engine of an EXISTING project on disk. Used when a project path
 * is provided explicitly (e.g. improving an already-initialized workspace).
 */
export async function detectEngine(projectDir: string): Promise<EngineInfo> {
  const robloxMarkers = [
    "default.project.json",
    "src/ServerScriptService",
  ];

  for (const marker of robloxMarkers) {
    if (await pathExists(path.join(projectDir, marker))) {
      return {
        kind: "roblox",
        stack: "Roblox + Luau + Rojo",
        supported: true,
        reason: "Roblox/Rojo project detected.",
      };
    }
  }

  const unityMarkers = [
    "ProjectSettings/ProjectVersion.txt",
    "Assets",
    "Packages/manifest.json"
  ];

  for (const marker of unityMarkers) {
    if (await pathExists(path.join(projectDir, marker))) {
      return {
        kind: "unity",
        supported: false,
        reason:
          "Unity project detected, but no Unity adapter/template exists yet. " +
          "WEB (Phaser + TypeScript + Webpack) is the supported engine."
      };
    }
  }

  const packageJson = path.join(projectDir, "package.json");
  if (await pathExists(packageJson)) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(await fs.readFile(packageJson, "utf8"));
    } catch {
      // ignore malformed package.json
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (all.phaser) {
      return {
        kind: "web",
        stack: "Phaser + TypeScript + Webpack",
        supported: true,
        reason: "Phaser dependency detected."
      };
    }
    return {
      kind: "web",
      stack: "TypeScript Web project",
      supported: true,
      reason: "Node/TypeScript project detected; using WEB pipeline."
    };
  }

  return {
    kind: "unknown",
    supported: false,
    reason: `No recognizable project structure at ${projectDir}.`
  };
}
