export type PermissionAction = "allow" | "ask" | "deny";

export interface BashPermission {
  pattern: string;
  action: PermissionAction;
}

export interface PermissionProfile {
  edit: PermissionAction;
  bash: BashPermission[];
  todowrite: PermissionAction;
}

// ─── Security Denials (global, applied to all agents) ─────────────
export const SECURITY_DENIALS: BashPermission[] = [
  { pattern: "rm -rf*", action: "deny" },
  { pattern: "sudo*", action: "deny" },
  { pattern: "npm publish*", action: "deny" },
  { pattern: "chmod 777*", action: "deny" },
  { pattern: "chown *", action: "deny" },
  { pattern: "curl * | bash", action: "deny" },
  { pattern: "wget * | bash", action: "deny" }
];

// ─── Safe Read-Only Commands ──────────────────────────────────────
// These patterns must work for BOTH relative and absolute paths.
// The opencode wildcard matcher converts * → .* and optimizes trailing " *" to ( .*)?
// so "cat *" matches "cat", "cat file", and "cat /absolute/path/to/file.json".
export const SAFE_READ_ONLY: BashPermission[] = [
  { pattern: "ls", action: "allow" },
  { pattern: "ls *", action: "allow" },
  { pattern: "cat", action: "allow" },
  { pattern: "cat *", action: "allow" },
  { pattern: "find *", action: "allow" },
  { pattern: "grep *", action: "allow" },
  { pattern: "head *", action: "allow" },
  { pattern: "tail *", action: "allow" },
  { pattern: "wc *", action: "allow" },
  { pattern: "echo *", action: "allow" },
  { pattern: "echo", action: "allow" },
  { pattern: "git log*", action: "allow" },
  { pattern: "git diff*", action: "allow" },
  { pattern: "git status*", action: "allow" }
];

// ─── Safe Build/Test Commands ─────────────────────────────────────
export const SAFE_BUILD_TEST: BashPermission[] = [
  { pattern: "npx tsc*", action: "allow" },
  { pattern: "npm test*", action: "allow" },
  { pattern: "npm run build*", action: "allow" },
  { pattern: "npm run lint*", action: "allow" },
  { pattern: "npm run check*", action: "allow" }
];

// ─── Safe Roblox/Rojo Commands ────────────────────────────────────
// Read-only validation and build commands for Roblox/Rojo projects.
// These are the Roblox equivalents of the npm/tsc toolchain above:
// agents working on a Rojo project validate with `rojo build` instead of
// `npm run build`. Never allow package-manager writes here.
export const SAFE_ROBLOX_COMMANDS: BashPermission[] = [
  { pattern: "rojo", action: "allow" },
  { pattern: "rojo *", action: "allow" },
  { pattern: "stylua *", action: "allow" },
  { pattern: "lune *", action: "allow" }
];

// ─── Profile Definitions ──────────────────────────────────────────

export const PROFILES: Record<string, PermissionProfile> = {
  tester: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS,
      { pattern: "npm run _*", action: "allow" },
      { pattern: "npm run dev", action: "ask" }
    ],
    todowrite: "deny"
  },

  reviewer: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS
    ],
    todowrite: "deny"
  },

  builder: {
    edit: "allow",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS,
      { pattern: "npm run _*", action: "ask" },
      { pattern: "npm install*", action: "ask" },
      { pattern: "npx webpack*", action: "allow" }
    ],
    todowrite: "allow"
  },

  programmer: {
    edit: "allow",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS,
      { pattern: "npm run _*", action: "ask" },
      { pattern: "npm install*", action: "ask" },
      { pattern: "npx webpack*", action: "allow" }
    ],
    todowrite: "allow"
  },

  researcher: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  market: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  competitor: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  idea: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  designer: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS
    ],
    todowrite: "deny"
  },

  director: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  gameplay: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  architect: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS
    ],
    todowrite: "deny"
  },

  monetization: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY
    ],
    todowrite: "deny"
  },

  content: {
    edit: "allow",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS,
      { pattern: "npm run _*", action: "ask" }
    ],
    todowrite: "allow"
  },

  // ─── Tool-layer roles (agent → tool-registry bridge) ─────────────
  // Visual builds the 3D world via Studio tools (inspect/create/modify,
  // terrain/lighting/material, asset search/insert, screenshot, playtest).
  // Edit stays deny: world changes go through Studio instances, not raw
  // filesystem writes outside the tool layer.
  visual: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS
    ],
    todowrite: "deny"
  },

  // UI owns ScreenGui/UI via Studio UI tools + screenshots + playtest.
  ui: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS
    ],
    todowrite: "deny"
  },

  // QA runs the playtest/visual-runtime gate (play, stop, screenshot,
  // output, inspect, assertions). Mirrors tester; both map to the QA tool
  // set in factory/tools/roles.ts.
  qa: {
    edit: "deny",
    bash: [
      ...SECURITY_DENIALS,
      ...SAFE_READ_ONLY,
      ...SAFE_BUILD_TEST,
      ...SAFE_ROBLOX_COMMANDS,
      { pattern: "npm run _*", action: "allow" },
      { pattern: "npm run dev", action: "ask" }
    ],
    todowrite: "deny"
  }
};

export const AGENT_NAMES = Object.keys(PROFILES) as (keyof typeof PROFILES)[];
