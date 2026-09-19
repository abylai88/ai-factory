import { describe, it, expect } from "vitest";
import type { StudioBridgeClient, StudioCallResult, StudioConnectionStatus } from "../bridge.js";
import { ToolRegistry } from "../../tools/registry.js";
import { blocked } from "../../tools/types.js";
import { roleMayUse, DESTRUCTIVE_TOOLS } from "../../tools/roles.js";
import type { ToolRole } from "../../tools/types.js";
import {
  SCENE_TOOL_DEFS,
  PROTECTED_SCENE_ROOTS,
  resolveScenePath,
  protectedSceneReason,
  validateSceneProperties,
  emitLuauString,
  sceneInspect,
  scenePlan,
  sceneCreate,
  sceneClone,
  sceneSet,
  sceneMove,
  sceneRename,
  sceneDestroy,
  sceneTypedCreate,
} from "../scene-editing.js";

/**
 * Scene Editing Tool Layer tests.
 *
 * The layer consumes StudioBridgeClient, so these tests drive it with an
 * in-memory fake bridge that simulates a tiny Roblox instance tree and
 * interprets the emitted Luau chunks' machine-readable result the same way a
 * live McpStudioBridge/Studio would. This exercises validation, guardrails,
 * evidence (before/after read-back), and infra-vs-fail classification
 * without a real Studio install.
 */

// ── In-memory instance store + fake bridge ─────────────────────────

interface FNode {
  name: string;
  className: string;
  props: Record<string, unknown>;
  children: FNode[];
}

function node(name: string, className: string, children: FNode[] = []): FNode {
  return { name, className, props: {}, children };
}

function seedRoot(): FNode {
  return {
    name: "game",
    className: "DataModel",
    props: {},
    children: [
      node("Workspace", "Workspace", [
        node("Map", "Folder", [node("Spawn", "SpawnLocation"), node("Baseplate", "Part")]),
      ]),
      node("ReplicatedStorage", "ReplicatedStorage", [node("Remotes", "Folder", [node("CoinCollected", "RemoteEvent"), node("RequestUpgrade", "RemoteEvent")])]),
      node("ServerScriptService", "ServerScriptService", [node("main", "Script")]),
      node("ServerStorage", "ServerStorage", []),
      node("StarterGui", "StarterGui", [node("HUD", "ScreenGui")]),
      node("StarterPlayer", "StarterPlayer", []),
      node("Lighting", "Lighting", []),
      node("Players", "Players", []),
      node("SoundService", "SoundService", []),
      node("Terrain", "Terrain", []),
    ],
  };
}

function findBySegs(root: FNode, segs: string[]): FNode | undefined {
  let cur = root;
  for (const s of segs) {
    const next = cur.children.find((c) => c.name === s);
    if (!next) return undefined;
    cur = next;
  }
  return cur;
}

function pathOf(root: FNode, target: FNode): string {
  const walk = (n: FNode, trail: string[]): string[] | null => {
    if (n === target) return trail;
    for (const c of n.children) {
      const found = walk(c, [...trail, c.name]);
      if (found) return found;
    }
    return null;
  };
  const segs = walk(root, []);
  return segs ? `game.${segs.join(".")}` : "";
}

function cloneNode(n: FNode): FNode {
  return { name: n.name, className: n.className, props: { ...n.props }, children: n.children.map(cloneNode) };
}

function uniqueName(parent: FNode, base: string): string {
  if (!parent.children.some((c) => c.name === base)) return base;
  let i = 1;
  while (parent.children.some((c) => c.name === `${base}${i}`)) i++;
  return `${base}${i}`;
}

function parseSegs(source: string): string[] {
  const m = /local segs = \{([^}]*)\}/.exec(source);
  if (!m) return [];
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let f: RegExpExecArray | null;
  while ((f = re.exec(m[1])) !== null) out.push(JSON.parse(`"${f[1]}"`));
  return out;
}

function evalExpr(expr: string): number | boolean | string | number[] {
  const t = expr.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(Vector3|Color3|Vector2)\.new\(([^)]*)\)$/.exec(t);
  if (m) return m[2].split(",").map((x) => Number(x.trim()));
  const cf = /^CFrame\.new\(([^)]*)\)$/.exec(t);
  if (cf) return cf[1].split(",").map((x) => Number(x.trim()));
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(t);
  if (str) return JSON.parse(`"${str[1]}"`);
  throw new Error(`cannot evaluate ${t}`);
}

function applyPropAssigns(n: FNode, source: string): void {
  const re = /(?:^|\n)\s*(?:target|inst)\.([A-Za-z_]\w*)\s*=\s*(.+?)(?=\n|$)/g;
  let f: RegExpExecArray | null;
  while ((f = re.exec(source)) !== null) {
    if (f[1] === "Name" || f[1] === "Parent") continue;
    n.props[f[1]] = evalExpr(f[2]);
  }
}

interface FakeOpts {
  simulate?: boolean;
}

class FakeSceneBridge implements StudioBridgeClient {
  private root: FNode;
  simulate: boolean;

  constructor(opts: FakeOpts = {}) {
    this.root = seedRoot();
    this.simulate = opts.simulate ?? true;
  }

  reset(): void {
    this.root = seedRoot();
  }

  peek(segs: string[]): FNode | undefined {
    return findBySegs(this.root, segs);
  }

  async discover(): Promise<StudioConnectionStatus> {
    return { bridgeAlive: true, pluginConnected: true, instances: [{ id: "place-1" }], message: "fake connected" };
  }

  async isStudioConnected(): Promise<boolean> {
    return true;
  }

  private struct(n: FNode, depth: number): unknown {
    return {
      name: n.name,
      className: n.className,
      path: pathOf(this.root, n),
      children: depth > 0 ? n.children.map((c) => this.struct(c, depth - 1)) : [],
    };
  }

  async callTool(tool: string, params: Record<string, unknown> = {}): Promise<StudioCallResult> {
    const ok = (message: string, data: unknown, stdout = ""): StudioCallResult => ({ ok: true, infra: false, message, data, stdout, stderr: "" });
    const fail = (message: string): StudioCallResult => ({ ok: false, infra: false, message, stdout: "", stderr: message });
    switch (tool) {
      case "get_datamodel": {
        const segs = parsePath(String(params.path ?? "game"));
        const n = segs.length ? findBySegs(this.root, segs) : this.root;
        if (!n) return fail(`instance not found: ${params.path}`);
        return ok("datamodel read", this.struct(n, Math.max(1, Number(params.depth ?? 2))));
      }
      case "get_properties": {
        const segs = parsePath(String(params.path ?? ""));
        const n = findBySegs(this.root, segs);
        if (!n) return fail(`instance not found: ${params.path}`);
        const properties: Record<string, string> = {};
        properties["Name"] = n.name;
        for (const [k, v] of Object.entries(n.props)) properties[k] = String(v);
        return ok("properties read", { instancePath: String(params.path), className: n.className, properties });
      }
      case "set_properties": {
        const segs = parsePath(String(params.path ?? ""));
        const n = findBySegs(this.root, segs);
        if (!n) return fail(`instance not found: ${params.path}`);
        for (const [k, v] of Object.entries((params.properties ?? {}) as Record<string, unknown>)) {
          n.props[k] = v;
        }
        return ok("properties set", {});
      }
      case "eval_luau": {
        const source = String(params.source ?? "");
        if (!this.simulate) {
          const segs = parseSegs(source);
          const nameLit = /inst\.Name\s*=\s*("(?:[^"\\]|\\.)*")/.exec(source);
          const base = nameLit ? JSON.parse(nameLit[1]) : "New";
          const createdPath = segs.length ? `game.${[...segs, base].join(".")}` : undefined;
          const inner = JSON.stringify(createdPath ? { ok: true, op: "create", createdPath } : { ok: true, op: "x" });
          return ok("luau executed (simulated)", {}, JSON.stringify({ returnValue: inner, message: "Code executed successfully", success: true, output: [] }));
        }
        const r = this.simulateEval(source);
        return ok("luau executed (simulated)", {}, JSON.stringify(r));
      }
      default:
        return { ok: false, infra: true, message: `fake bridge lacks tool ${tool}`, stdout: "", stderr: `fake lacks ${tool}` };
    }
  }

  private simulateEval(source: string): Record<string, unknown> {
    const segs = parseSegs(source);
    const op = /op\s*=\s*"([^"]+)"/.exec(source)?.[1] ?? "create";
    const target = findBySegs(this.root, segs);
    if (!target) return { ok: false, error: `scene target not found: game.${segs.join(".")}` };
    switch (op) {
      case "create": {
        const cls = /className\s*=\s*"([^"]+)"/.exec(source)?.[1] ?? "Part";
        const nameLit = /inst\.Name\s*=\s*("(?:[^"\\]|\\.)*")/.exec(source);
        const base = nameLit ? JSON.parse(nameLit[1]) : "New";
        const n: FNode = { name: uniqueName(target, base), className: cls, props: {}, children: [] };
        applyPropAssigns(n, source);
        target.children.push(n);
        return { ok: true, op: "create", createdPath: `game.${[...segs, n.name].join(".")}`, className: cls };
      }
      case "set": {
        applyPropAssigns(target, source);
        return { ok: true, op: "set" };
      }
      case "rename": {
        const nl = /target\.Name\s*=\s*("(?:[^"\\]|\\.)*")/.exec(source);
        if (nl) target.name = JSON.parse(nl[1]);
        return { ok: true, op: "rename" };
      }
      case "move": {
        const np = /target\.Parent = resolve\(game, \{([^}]*)\}\)/.exec(source) ?? /local np = resolve\(game, \{([^}]*)\}\)/.exec(source);
        const npList = np ? extractList(np[1]) : [];
        const parentNode = findBySegs(this.root, npList);
        if (!parentNode) return { ok: false, error: "newParent not found" };
        const oldParentPath = segs.slice(0, -1);
        const oldParent = findBySegs(this.root, oldParentPath);
        if (oldParent) {
          const idx = oldParent.children.findIndex((c) => c.name === segs[segs.length - 1]);
          if (idx >= 0) {
            parentNode.children.push(oldParent.children.splice(idx, 1)[0]);
          }
        }
        return { ok: true, op: "move" };
      }
      case "clone": {
        const cls = /className\s*=\s*"([^"]+)"/.exec(source)?.[1] ?? target.className;
        const nl = /clone\.Name\s*=\s*("(?:[^"\\]|\\.)*")/.exec(source);
        const np = /clone\.Parent = resolve\(game, \{([^}]*)\}\)/.exec(source);
        const npList = np ? extractList(np[1]) : [];
        const parentNode = findBySegs(this.root, npList);
        if (!parentNode) return { ok: false, error: "newParent not found" };
        const copy = cloneNode(target);
        copy.name = nl ? JSON.parse(nl[1]) : target.name;
        copy.name = uniqueName(parentNode, copy.name);
        parentNode.children.push(copy);
        return { ok: true, op: "clone", createdPath: `game.${[...npList, copy.name].join(".")}`, className: cls };
      }
      case "destroy": {
        const parentPath = segs.slice(0, -1);
        const parent = findBySegs(this.root, parentPath);
        if (parent) {
          const idx = parent.children.findIndex((c) => c.name === segs[segs.length - 1]);
          if (idx >= 0) parent.children.splice(idx, 1);
        }
        return { ok: true, op: "destroy" };
      }
      default:
        return { ok: true, op };
    }
  }
}

function extractList(listBody: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let f: RegExpExecArray | null;
  while ((f = re.exec(listBody)) !== null) out.push(JSON.parse(`"${f[1]}"`));
  return out;
}

function parsePath(p: string): string[] {
  return p.replace(/^game\./, "").split(".").filter(Boolean);
}

// ── Unit tests: validation + guards ────────────────────────────────

describe("resolveScenePath", () => {
  it("canonicalizes valid paths", () => {
    const r = resolveScenePath("game.Workspace.Map");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.segments).toEqual(["Workspace", "Map"]);
      expect(r.path).toBe("game.Workspace.Map");
    }
  });
  it("rejects traversal, shell meta, and deep paths", () => {
    expect("error" in resolveScenePath("game..")).toBe(true);
    expect("error" in resolveScenePath("game.Workspace;rm")).toBe(true);
    expect("error" in resolveScenePath("")).toBe(true);
    expect("error" in resolveScenePath("game." + "A.".repeat(100) + "B")).toBe(true);
  });
});

describe("protectedSceneReason", () => {
  it("blocks destroy/move/rename on every protected root", () => {
    for (const root of PROTECTED_SCENE_ROOTS) {
      for (const op of ["destroy", "move", "rename"] as const) {
        expect(protectedSceneReason([root], op)).toBeTruthy();
      }
    }
    expect(protectedSceneReason(["Workspace", "Map", "Spawn"], "destroy")).toBeNull();
    expect(protectedSceneReason(["Workspace", "Map"], "create")).toBeNull();
  });
});

describe("validateSceneProperties", () => {
  it("accepts typed primitives and vectors", () => {
    const r = validateSceneProperties({ Size: [4, 0.5, 4], Anchored: true, Color: [0, 0.5, 1], Transparency: 0 });
    expect("error" in r).toBe(false);
  });
  it("rejects bad shapes, non-finite numbers, and oversized batches", () => {
    expect("error" in validateSceneProperties({ Size: [1, 2] })).toBe(true);
    expect("error" in validateSceneProperties({ Size: [1, 2, Infinity] })).toBe(true);
    expect("error" in validateSceneProperties({ Color: [0, 0, 2] })).toBe(true);
    expect("error" in validateSceneProperties({ x: null })).toBe(true);
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 26; i++) big[`P${i}`] = i;
    expect("error" in validateSceneProperties(big)).toBe(true);
    expect("error" in validateSceneProperties({ Parent: "game.X" })).toBe(true);
    expect("error" in validateSceneProperties({ "bad name": 1 })).toBe(true);
  });
});

describe("emitLuauString", () => {
  it("escapes safely and rejects control characters", () => {
    expect(emitLuauString("Hello World")).toBe('"Hello World"');
    expect(emitLuauString('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(emitLuauString("\x07bell")).toBeNull();
  });
});

// ── Evidence-backed ops via the fake bridge ───────────────────────

describe("sceneCreate (evidence + read-back)", () => {
  it("creates a part with typed properties and confirms via read-back", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneCreate(b, {
      className: "Part",
      name: "Pad",
      parent: "game.Workspace.Map",
      properties: { Size: [4, 0.5, 4], Anchored: true, Color: [0, 0.5, 1] },
    });
    expect(r.ok).toBe(true);
    expect(r.data?.createdPath).toBe("game.Workspace.Map.Pad");
    expect(r.data?.evidence.parentBefore).toBeTruthy();
    expect(r.data?.evidence.parentAfter).toBeTruthy();
    expect((r.data!.evidence.afterProperties as Record<string, string>)["Name"]).toBe("Pad");
    const n = b.peek(["Workspace", "Map", "Pad"]);
    expect(n?.className).toBe("Part");
    expect(n?.props.Size).toEqual([4, 0.5, 4]);
    expect(n?.props.Anchored).toBe(true);
  });

  it("typed shortcuts enforce class + defaults", async () => {
    const b = new FakeSceneBridge();
    const sp = await sceneTypedCreate(b, "spawn", { name: "Spawn2", parent: "game.Workspace.Map", properties: { Size: [8, 2, 8] } });
    expect(sp.ok).toBe(true);
    expect(b.peek(["Workspace", "Map", "Spawn2"])?.className).toBe("SpawnLocation");
    expect(b.peek(["Workspace", "Map", "Spawn2"])?.props.Anchored).toBe(true);
    const ui = await sceneTypedCreate(b, "ui", { name: "Menu", parent: "game.StarterGui" });
    expect(ui.ok).toBe(true);
    expect(b.peek(["StarterGui", "Menu"])?.props.ResetOnSpawn).toBe(false);
  });

  it("fails honestly when the op ran but read-back cannot confirm", async () => {
    const b = new FakeSceneBridge({ simulate: false });
    const r = await sceneCreate(b, { className: "Part", name: "Ghost", parent: "game.Workspace.Map" });
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(false);
    expect(r.message).toMatch(/read-back could not confirm/i);
    expect(b.peek(["Workspace", "Map", "Ghost"])).toBeUndefined();
  });
});

describe("sceneSet (before/after evidence)", () => {
  it("uses native set_properties for primitive values and verifies change", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneSet(b, { path: "game.Workspace.Map.Baseplate", properties: { Transparency: 0.5, Anchored: true } });
    expect(r.ok).toBe(true);
    expect(r.data?.evidence.beforeProperties).toBeTruthy();
    expect(r.data?.evidence.afterProperties?.["Transparency"]).toBe("0.5");
    expect(b.peek(["Workspace", "Map", "Baseplate"])?.props.Transparency).toBe(0.5);
  });

  it("emits Luau for vector types and verifies change", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneSet(b, { path: "game.Workspace.Map.Baseplate", properties: { Size: [10, 1, 10], Color: [1, 0, 0] } });
    expect(r.ok).toBe(true);
    expect(b.peek(["Workspace", "Map", "Baseplate"])?.props.Size).toEqual([10, 1, 10]);
    expect(b.peek(["Workspace", "Map", "Baseplate"])?.props.Color).toEqual([1, 0, 0]);
  });

  it("reports a read-back no-change, not fabricated success", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneSet(b, { path: "game.Workspace.Map.Baseplate", properties: { Transparency: 0 } });
    // Baseplate has no Transparency before; setting 0 makes after "0" => changed=true.
    expect(r.ok).toBe(true);
    const again = await sceneSet(b, { path: "game.Workspace.Map.Baseplate", properties: { Transparency: 0 } });
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/no change/);
  });

  it("refuses to set on protected roots", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneSet(b, { path: "game.Workspace", properties: { Name: "X" } });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/protected scene root/);
  });
});

describe("sceneRename / sceneMove / sceneClone / sceneDestroy", () => {
  it("renames with post-read-back Name check", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneRename(b, { path: "game.Workspace.Map.Spawn", newName: "SpawnA" });
    expect(r.ok).toBe(true);
    expect(b.peek(["Workspace", "Map", "SpawnA"])).toBeTruthy();
    expect(b.peek(["Workspace", "Map", "Spawn"])).toBeUndefined();
  });

  it("moves with old/new read-back confirmation", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneMove(b, { path: "game.Workspace.Map.Spawn", newParent: "game.Workspace" });
    expect(r.ok).toBe(true);
    expect(b.peek(["Workspace", "Map", "Spawn"])).toBeUndefined();
    expect(b.peek(["Workspace", "Spawn"])).toBeTruthy();
  });

  it("clones a decal-free part into a new parent", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneClone(b, { path: "game.Workspace.Map.Baseplate", newName: "BaseplateCopy", newParent: "game.Workspace" });
    expect(r.ok).toBe(true);
    expect(r.data?.createdPath).toBe("game.Workspace.BaseplateCopy");
    expect(b.peek(["Workspace", "BaseplateCopy"])?.className).toBe("Part");
  });

  it("destroy requires confirm and refuses protected roots / scripts", async () => {
    const b = new FakeSceneBridge();
    const noConfirm = await sceneDestroy(b, { path: "game.Workspace.Map.Baseplate" });
    expect(noConfirm.ok).toBe(false);
    expect(noConfirm.message).toMatch(/confirm:true/);
    const protectedRoot = await sceneDestroy(b, { path: "game.Workspace", confirm: true });
    expect(protectedRoot.ok).toBe(false);
    expect(protectedRoot.message).toMatch(/protected scene root/);
    const script = await sceneDestroy(b, { path: "game.ServerScriptService.main", confirm: true });
    expect(script.ok).toBe(false);
    expect(script.message).toMatch(/refuses script instances/);
  });

  it("destroys and confirms via parent read-back", async () => {
    const b = new FakeSceneBridge();
    const r = await sceneDestroy(b, { path: "game.Workspace.Map.Baseplate", confirm: true });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/succeeded/);
    expect(b.peek(["Workspace", "Map", "Baseplate"])).toBeUndefined();
  });
});

describe("scene plan never mutates", () => {
  it("returns a read-only preview with before evidence", async () => {
    const b = new FakeSceneBridge();
    const before = JSON.stringify(b.peek(["Workspace", "Map"])!.children.map((c) => c.name));
    const r = await scenePlan(b, { op: "destroy", path: "game.Workspace.Map.Baseplate", confirm: true });
    expect(r.ok).toBe(true);
    expect(r.data?.willChange).toBe(true);
    expect(r.data?.evidence.beforeProperties).toBeTruthy();
    expect(JSON.stringify(b.peek(["Workspace", "Map"])!.children.map((c) => c.name))).toBe(before);
  });
});

describe("scene ops when Studio is unavailable", () => {
  it("classifies unreachable bridge as infra (BLOCKED), never FAIL", async () => {
    const dead = {
      async discover(): Promise<StudioConnectionStatus> {
        return { bridgeAlive: false, pluginConnected: false, instances: [], message: "bridge down" };
      },
      async isStudioConnected(): Promise<boolean> {
        return false;
      },
      async callTool(): Promise<StudioCallResult> {
        return { ok: false, infra: true, message: "roblox_toolchain: studio unreachable", stdout: "", stderr: "studio unreachable" };
      },
    } satisfies StudioBridgeClient;
    const r = await sceneInspect(dead, { path: "game.Workspace" });
    expect(r.ok).toBe(false);
    expect(r.infra).toBe(true);
    const c = await sceneCreate(dead, { className: "Part", name: "P", parent: "game.Workspace" });
    expect(c.infra).toBe(true);
  });
});

describe("scene tool permission boundaries", () => {
  it("qa/tester/researcher are denied scene.destroy before any bridge call", async () => {
    let called = false;
    const reg = new ToolRegistry();
    reg.register(
      {
        id: "scene.destroy",
        name: "Destroy scene instance",
        description: "d",
        capability: "delete_instance",
        platform: "roblox",
        executionMethod: "studio-bridge",
        allowedRoles: ["visual", "programmer"],
        timeoutMs: 1000,
        retry: { maxRetries: 0, backoffMs: 0 },
        dangerous: true,
        requiresStudio: true,
      },
      async () => {
        called = true;
        return blocked("scene.destroy", "should not run");
      }
    );
    for (const role of ["qa", "tester", "researcher", "ui", "content", "reviewer"] as const) {
      const r = await reg.execute("scene.destroy", { path: "game.Workspace.X" }, { role, projectDir: "" });
      expect(r.status).toBe("BLOCKED");
      expect(called).toBe(false);
    }
  });

  it("an allowed role may pass the gate (handler runs)", async () => {
    let called = false;
    const reg = new ToolRegistry();
    reg.register(
      {
        id: "scene.rename",
        name: "Rename scene instance",
        description: "d",
        capability: "modify_instance",
        platform: "roblox",
        executionMethod: "studio-bridge",
        allowedRoles: ["visual", "programmer", "ui", "builder"],
        timeoutMs: 1000,
        retry: { maxRetries: 0, backoffMs: 0 },
        dangerous: true,
        requiresStudio: true,
      },
      async () => {
        called = true;
        return blocked("scene.rename", "rerouted to fake bridge");
      }
    );
    const r = await reg.execute("scene.rename", { path: "game.Workspace.X", newName: "Y" }, { role: "visual", projectDir: "" });
    expect(r.status).toBe("BLOCKED");
    expect(called).toBe(true);
  });

  it("role matrix + allowedRoles agree (scene.destroy private to visual/programmer)", () => {
    const def = SCENE_TOOL_DEFS.find((d) => d.id === "scene.destroy")!;
    for (const role of ["visual", "programmer"] as ToolRole[]) {
      expect(def.allowedRoles).toContain(role);
      expect(roleMayUse(role, "scene.destroy")).toBe(true);
    }
    for (const role of ["qa", "tester", "researcher", "ui", "builder", "reviewer", "director", "gameplay"] as ToolRole[]) {
      expect(def.allowedRoles.includes(role)).toBe(false);
      expect(roleMayUse(role, "scene.destroy")).toBe(false);
    }
  });

  it("scene.inspect/plan are read-only, not dangerous, and wide-open", () => {
    for (const id of ["scene.inspect", "scene.plan"]) {
      const def = SCENE_TOOL_DEFS.find((d) => d.id === id)!;
      expect(def.dangerous).toBe(false);
      expect(DESTRUCTIVE_TOOLS.has(id)).toBe(false);
      for (const role of ["reviewer", "researcher", "director", "qa", "tester"] as ToolRole[]) {
        expect(def.allowedRoles).toContain(role);
        expect(roleMayUse(role, id)).toBe(true);
      }
    }
  });

  it("every dangerous scene.* tool is tracked in DESTRUCTIVE_TOOLS", () => {
    for (const d of SCENE_TOOL_DEFS) {
      if (d.dangerous) expect(DESTRUCTIVE_TOOLS.has(d.id)).toBe(true);
    }
  });
});