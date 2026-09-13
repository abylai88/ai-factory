import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  TemplateManager,
  goalSlug,
  resolveWorkspaceDir,
  GENERIC_TEMPLATE_ID,
  LEGACY_TEMPLATE_ID,
  SLUG_MAX_LENGTH,
} from "../project-setup.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "template-selection-test-"));
  await fs.mkdir(path.join(tmpDir, "templates"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function createTemplateDir(id: string): Promise<void> {
  const dir = path.join(tmpDir, "templates", id);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "configs"), { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), '{"name":"test"}');
  await fs.writeFile(path.join(dir, "tsconfig.json"), "{}");
}

const webEngine = {
  kind: "web" as const,
  stack: "Phaser + TypeScript + Webpack",
  supported: true,
  reason: "test",
};

// ─── Template selection: generic greenfield games ────────────────────

describe("TemplateManager — generic greenfield game selects generic template", () => {
  it("selects phaser-generic-web-template for a generic 2D game goal", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Build a simple platformer game");

    expect(template).not.toBeNull();
    expect(template!.id).toBe(GENERIC_TEMPLATE_ID);
  });

  it("selects generic template for 'parking panic'", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Parking Panic");

    expect(template!.id).toBe(GENERIC_TEMPLATE_ID);
  });

  it("selects generic template for 'traffic dodge'", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Traffic Dodge");

    expect(template!.id).toBe(GENERIC_TEMPLATE_ID);
  });

  it("selects generic template when no goal is provided", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine);

    expect(template!.id).toBe(GENERIC_TEMPLATE_ID);
  });
});

// ─── Template selection: Yandex-specific goals ──────────────────────

describe("TemplateManager — Yandex goal selects legacy template", () => {
  it("selects legacy template for a goal mentioning yandex", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Build a Yandex Games puzzle");

    expect(template!.id).toBe(LEGACY_TEMPLATE_ID);
  });

  it("selects legacy template for a goal mentioning ya-games", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Deploy to ya-games platform");

    expect(template!.id).toBe(LEGACY_TEMPLATE_ID);
  });

  it("selects legacy template for a goal mentioning yagames", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "yagames minigame");

    expect(template!.id).toBe(LEGACY_TEMPLATE_ID);
  });
});

// ─── Template selection: explicit template override ──────────────────

describe("TemplateManager — explicit template selection still works", () => {
  it("allows selecting legacy template by explicit templateId", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    // Even though the goal is generic, goalSlug-based selection
    // defaults to generic; explicit override is handled upstream in
    // provisioner/mission code. Here we test that the legacy template
    // is still a valid candidate (returned when generic is missing).
    await fs.rm(path.join(tmpDir, "templates", GENERIC_TEMPLATE_ID), { recursive: true });
    const template = await manager.templateFor(webEngine, "Build a platformer");

    expect(template!.id).toBe(LEGACY_TEMPLATE_ID);
  });

  it("falls back to legacy template when generic is missing", async () => {
    await createTemplateDir(LEGACY_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Build a puzzle game");

    expect(template!.id).toBe(LEGACY_TEMPLATE_ID);
  });

  it("falls back to generic template when legacy is missing", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "yandex arcade game");

    expect(template!.id).toBe(GENERIC_TEMPLATE_ID);
  });
});

// ─── Template selection: non-web engines ─────────────────────────────

describe("TemplateManager — non-web engines return null", () => {
  it("returns null for unsupported engine", async () => {
    await createTemplateDir(GENERIC_TEMPLATE_ID);

    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor({
      kind: "unknown",
      supported: false,
      reason: "test",
    });

    expect(template).toBeNull();
  });

  it("returns null when no templates exist", async () => {
    const manager = new TemplateManager(tmpDir);
    const template = await manager.templateFor(webEngine, "Build a game");

    expect(template).toBeNull();
  });
});

// ─── goalSlug: length bounding ──────────────────────────────────────

describe("goalSlug — slug length is safely bounded", () => {
  it("returns short slug unchanged", () => {
    expect(goalSlug("Parking Panic")).toBe("parking-panic");
  });

  it("returns 'project' for empty string", () => {
    expect(goalSlug("")).toBe("project");
  });

  it("truncates long goal to SLUG_MAX_LENGTH", () => {
    const longGoal = "a".repeat(200);
    const slug = goalSlug(longGoal);

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it("never produces a slug longer than 64 characters", () => {
    const veryLongGoal = "build an incredibly detailed and comprehensive tycoon simulation game with many features and mechanics including resource management and worker AI and building systems and research trees and technology progression and unlockable content";
    const slug = goalSlug(veryLongGoal);

    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.length).toBeGreaterThan(0);
  });

  it("strips trailing hyphens after truncation", () => {
    // Build a slug that would end with a hyphen after truncation
    const goal = "a".repeat(63) + "-extra";
    const slug = goalSlug(goal);

    expect(slug).not.toMatch(/-$/);
  });

  it("produces valid directory name characters only", () => {
    const goal = "Build a Game! @#$%^&*() with spaces and CAPS";
    const slug = goalSlug(goal);

    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("resolveWorkspaceDir uses bounded slug", () => {
    const longGoal = "a".repeat(200);
    const workspace = resolveWorkspaceDir(tmpDir, longGoal);
    const basename = path.basename(workspace);

    expect(basename.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});

// ─── goalSlug: basic behavior preserved ─────────────────────────────

describe("goalSlug — basic slug generation", () => {
  it("lowercases the goal", () => {
    expect(goalSlug("PARKING PANIC")).toBe("parking-panic");
  });

  it("replaces non-alphanumeric chars with hyphens", () => {
    expect(goalSlug("hello world!")).toBe("hello-world");
  });

  it("collapses multiple hyphens", () => {
    expect(goalSlug("hello   world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(goalSlug("--hello--")).toBe("hello");
  });

  it("defaults to 'project' when result is empty", () => {
    expect(goalSlug("!!!@@@###")).toBe("project");
  });
});

// ─── Constants sanity checks ────────────────────────────────────────

describe("Template constants", () => {
  it("GENERIC_TEMPLATE_ID matches the directory", () => {
    expect(GENERIC_TEMPLATE_ID).toBe("phaser-generic-web-template");
  });

  it("LEGACY_TEMPLATE_ID matches the directory", () => {
    expect(LEGACY_TEMPLATE_ID).toBe("yagames-phaser-template");
  });

  it("SLUG_MAX_LENGTH is reasonable for filesystems", () => {
    expect(SLUG_MAX_LENGTH).toBeLessThanOrEqual(255);
    expect(SLUG_MAX_LENGTH).toBeGreaterThanOrEqual(32);
  });
});
