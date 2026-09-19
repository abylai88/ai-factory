import { describe, expect, it } from "vitest";
import { createFullGamePipeline } from "../../pipeline/pipeline.js";

describe("Roblox platform pipeline", () => {
  it("uses Roblox-specific production steps for Roblox goals", () => {
    const pipeline = createFullGamePipeline("Create a Roblox simulator");

    expect(pipeline.name).toBe("Roblox Game Production Pipeline");

    const director = pipeline.steps.find((step) => step.id === "director");
    const implementation = pipeline.steps.find((step) => step.id === "implementation");
    const test = pipeline.steps.find((step) => step.id === "test");
    const build = pipeline.steps.find((step) => step.id === "build");

    expect(director?.description).toContain("Roblox");
    expect(implementation?.description).toContain("Luau");
    expect(implementation?.description).toContain("Rojo");
    expect(test?.description).toContain("default.project.json");
    expect(build?.description).toContain("Rojo");
  });

  it("keeps the existing web pipeline for non-Roblox goals", () => {
    const pipeline = createFullGamePipeline("Create a browser puzzle game");

    expect(pipeline.name).toBe("Game Production Pipeline");

    const implementation = pipeline.steps.find((step) => step.id === "implementation");
    const test = pipeline.steps.find((step) => step.id === "test");
    const build = pipeline.steps.find((step) => step.id === "build");

    expect(implementation?.description).toContain("TypeScript");
    expect(implementation?.description).toContain("Phaser");
    expect(test?.description).toContain("npm run build");
    expect(build?.description).toContain("npm run build");
  });
});
