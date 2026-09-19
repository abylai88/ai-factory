import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../registry.js";
import { registerBuiltinTools, builtinCoverage, LOCAL_TOOL_DEFS } from "../builtin.js";
import { toolsForRole, roleMayUse, allReferencedToolIds } from "../roles.js";
import { STUDIO_TOOL_DEFS } from "../../studio/tools.js";
import type { ToolDefinition } from "../types.js";

function freshRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  registerBuiltinTools(r);
  return r;
}

// ─── 1. registry initialization ───────────────────────────────────

describe("tool registry initialization", () => {
  it("registers every studio + local tool", () => {
    const r = freshRegistry();
    for (const d of STUDIO_TOOL_DEFS) expect(r.has(d.id)).toBe(true);
    for (const d of LOCAL_TOOL_DEFS) expect(r.has(d.id)).toBe(true);
    expect(r.list().length).toBeGreaterThan(20);
  });

  it("every role-referenced tool id resolves (no dangling permissions)", () => {
    const cov = builtinCoverage();
    expect(cov.missing).toEqual([]);
    expect(allReferencedToolIds().length).toBeGreaterThan(10);
  });

  it("rejects duplicate registration", () => {
    const r = freshRegistry();
    const def: ToolDefinition = {
      id: "research.web",
      name: "dup",
      description: "dup",
      capability: "research",
      platform: "shared",
      executionMethod: "stub",
      allowedRoles: ["researcher"],
      timeoutMs: 1000,
      retry: { maxRetries: 0, backoffMs: 0 },
      dangerous: false,
      requiresStudio: false,
    };
    expect(() => r.register(def, async () => { throw new Error("x"); })).toThrow(/already registered/);
  });

  it("unknown tool execution fails honestly (no fake success)", async () => {
    const r = freshRegistry();
    const res = await r.execute("does.not.exist", {}, { role: "programmer" });
    expect(res.status).toBe("FAIL");
    expect(res.message).toMatch(/unknown tool/);
  });
});

// ─── 2. permission enforcement ────────────────────────────────────

describe("tool permission enforcement", () => {
  it("denies researcher the destructive luau.execute tool", async () => {
    const r = freshRegistry();
    const res = await r.execute("luau.execute", { source: "return 1" }, { role: "researcher" });
    expect(res.status).toBe("BLOCKED");
    expect(res.message).toMatch(/permission denied/);
  });

  it("denies reviewer script.edit", async () => {
    const r = freshRegistry();
    const res = await r.execute(
      "script.edit",
      { path: "game.Workspace.Script", source: "print(1)" },
      { role: "reviewer" }
    );
    expect(res.status).toBe("BLOCKED");
    expect(res.message).toMatch(/permission denied/);
  });

  it("denies director any destructive studio tool", async () => {
    const r = freshRegistry();
    const res = await r.execute(
      "studio.create",
      { className: "Part", name: "X", parent: "Workspace" },
      { role: "director" }
    );
    expect(res.status).toBe("BLOCKED");
  });
});

// ─── 3. programmer tool access ────────────────────────────────────

describe("programmer tool access", () => {
  it("programmer may use script read/edit, eval, validate, build, playtest", () => {
    for (const id of ["script.read", "script.edit", "luau.execute", "luau.validate", "rojo.build", "studio.play", "studio.output", "studio.inspect"]) {
      expect(roleMayUse("programmer", id)).toBe(true);
    }
    expect(toolsForRole("programmer")).toContain("gamesystem.use");
  });

  it("programmer research-free tools do not include asset insert", () => {
    expect(roleMayUse("programmer", "asset.insert")).toBe(false);
  });
});

// ─── 4. research denied destructive tools ─────────────────────────

describe("research agent isolation", () => {
  it("researcher has only read-only/metadata tools", () => {
    const tools = toolsForRole("researcher");
    expect(tools).toContain("research.web");
    for (const id of ["studio.create", "studio.modify", "studio.delete", "script.edit", "luau.execute", "studio.play", "gameplay.create"]) {
      expect(tools).not.toContain(id);
    }
  });
});

// ─── 5/6. visual + qa access ──────────────────────────────────────

describe("visual and qa tool access", () => {
  it("visual may create/modify/terrain/lighting/screenshot/play", () => {
    for (const id of ["studio.inspect", "studio.create", "studio.modify", "studio.terrain", "studio.lighting", "studio.material", "asset.search", "asset.insert", "screenshot.capture", "studio.play"]) {
      expect(roleMayUse("visual", id)).toBe(true);
    }
  });

  it("visual may NOT execute arbitrary luau or edit scripts", () => {
    expect(roleMayUse("visual", "luau.execute")).toBe(false);
    expect(roleMayUse("visual", "script.edit")).toBe(false);
  });

  it("qa may play/stop/screenshot/output/inspect/assert", () => {
    for (const id of ["studio.play", "studio.stop", "screenshot.capture", "studio.output", "studio.inspect", "runtime.assert", "luau.validate", "rojo.build"]) {
      expect(roleMayUse("qa", id)).toBe(true);
    }
  });

  it("qa may NOT edit scripts or create instances", () => {
    expect(roleMayUse("qa", "script.edit")).toBe(false);
    expect(roleMayUse("qa", "studio.create")).toBe(false);
  });

  it("reviewer is read-only (no edit/create/delete/eval)", () => {
    for (const id of ["script.edit", "studio.create", "studio.delete", "luau.execute"]) {
      expect(roleMayUse("reviewer", id)).toBe(false);
    }
    expect(roleMayUse("reviewer", "screenshot.capture")).toBe(true);
  });
});

// ─── 9. timeout → infrastructure ──────────────────────────────────

describe("tool timeout", () => {
  it("hanging tool surfaces BLOCKED infrastructure (never hangs forever)", async () => {
    const r = new ToolRegistry();
    r.register(
      {
        id: "test.hang",
        name: "hang",
        description: "hang",
        capability: "test",
        platform: "shared",
        executionMethod: "stub",
        allowedRoles: ["programmer"],
        timeoutMs: 150,
        retry: { maxRetries: 0, backoffMs: 0 },
        dangerous: false,
        requiresStudio: false,
      },
      () => new Promise(() => {})
    );
    const res = await r.execute("test.hang", {}, { role: "programmer" });
    expect(res.status).toBe("BLOCKED");
    expect(res.message).toMatch(/timeout/i);
  });
});

// ─── 10. successful execution ─────────────────────────────────────

describe("successful tool execution", () => {
  it("research.web passes for researcher", async () => {
    const r = freshRegistry();
    const res = await r.execute("research.web", { topic: "space mining sims" }, { role: "researcher" });
    expect(res.status).toBe("PASS");
  });

  it("gamesystem.use list passes for programmer", async () => {
    const r = freshRegistry();
    const res = await r.execute("gamesystem.use", { op: "list" }, { role: "programmer" });
    expect(res.status).toBe("PASS");
    expect((res.data?.systems as unknown[]).length).toBeGreaterThan(5);
  });
});

// ─── 19. invalid args rejected ────────────────────────────────────

describe("invalid tool arguments rejected", () => {
  it("studio.create with non-allowlisted class fails (no bridge call)", async () => {
    const r = freshRegistry();
    const res = await r.execute(
      "studio.create",
      { className: "EvilExecutor", name: "X", parent: "Workspace" },
      { role: "visual", projectDir: "/tmp/x" }
    );
    expect(res.status).toBe("FAIL");
    expect(res.message).toMatch(/allowlisted/);
  });

  it("gamesystem.use with unknown op fails", async () => {
    const r = freshRegistry();
    const res = await r.execute("gamesystem.use", { op: "explode" }, { role: "programmer" });
    expect(res.status).toBe("FAIL");
  });

  it("gameplay.create with unsupported kind fails", async () => {
    const r = freshRegistry();
    const res = await r.execute(
      "gameplay.create",
      { kind: "starship", name: "X", projectDir: "/tmp/x" },
      { role: "programmer" }
    );
    expect(res.status).toBe("FAIL");
  });

  it("asset.insert with non-numeric id fails", async () => {
    const r = freshRegistry();
    const res = await r.execute(
      "asset.insert",
      { assetId: "https://evil.example/payload", parent: "Workspace" },
      { role: "visual" }
    );
    expect(res.status).toBe("FAIL");
  });
});

// ─── 20. destructive protection ───────────────────────────────────

describe("destructive operation protection", () => {
  it("dangerous tool denied even when listed for a non-dangerous role", async () => {
    const r = new ToolRegistry();
    r.register(
      {
        id: "test.danger",
        name: "danger",
        description: "danger",
        capability: "test",
        platform: "shared",
        executionMethod: "stub",
        allowedRoles: ["researcher"],
        timeoutMs: 1000,
        retry: { maxRetries: 0, backoffMs: 0 },
        dangerous: true,
        requiresStudio: false,
      },
      async () => ({ status: "PASS", toolId: "test.danger", message: "should never run", stdout: "", stderr: "", durationMs: 0 })
    );
    const res = await r.execute("test.danger", {}, { role: "researcher" });
    expect(res.status).toBe("BLOCKED");
    expect(res.message).toMatch(/destructive operation protection/);
  });
});
