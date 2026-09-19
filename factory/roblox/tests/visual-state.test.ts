import { describe, it, expect } from "vitest";
import { assessVisualState, describeVisualState, type ScreenshotResult, type VisionVerdict } from "../screenshot.js";

describe("visual QA state model (4-state)", () => {
  const shot = (partial: Partial<ScreenshotResult>): ScreenshotResult => ({
    status: "PASS",
    message: "ok",
    ...partial,
  });

  it("maps capture BLOCKED/FAIL to VISUAL_UNAVAILABLE", () => {
    expect(assessVisualState({ status: "BLOCKED", message: "window minimized", infraReason: "x" }).state).toBe("VISUAL_UNAVAILABLE");
    expect(assessVisualState({ status: "FAIL", message: "capture exploded" }).state).toBe("VISUAL_UNAVAILABLE");
  });

  it("PASS capture + PASS verdict => VISUAL_PASS", () => {
    const v: VisionVerdict = { verdict: "PASS", observation: "floor visible" };
    expect(assessVisualState(shot({ screenshotPath: "/tmp/s.png" }), v).state).toBe("VISUAL_PASS");
  });

  it("PASS capture + FAIL verdict => VISUAL_FAIL", () => {
    const v: VisionVerdict = { verdict: "FAIL", observation: "no floor" };
    expect(assessVisualState(shot({ screenshotPath: "/tmp/s.png" }), v).state).toBe("VISUAL_FAIL");
  });

  it("PASS capture without a vision verdict or with NEEDS_HUMAN => VISUAL_UNVERIFIED", () => {
    expect(assessVisualState(shot({ screenshotPath: "/tmp/s.png" })).state).toBe("VISUAL_UNVERIFIED");
    const v: VisionVerdict = { verdict: "NEEDS_HUMAN", observation: "pending human review" };
    expect(assessVisualState(shot({ screenshotPath: "/tmp/s.png" }), v).state).toBe("VISUAL_UNVERIFIED");
  });

  it("never upgrades UNVERIFIED to PASS (no vision, no override)", () => {
    expect(assessVisualState(shot({ screenshotPath: "/tmp/s.png" })).state).not.toBe("VISUAL_PASS");
    expect(describeVisualState("VISUAL_UNVERIFIED")).toMatch(/pending/i);
  });

  it("describeVisualState covers all four states", () => {
    for (const s of ["VISUAL_PASS", "VISUAL_FAIL", "VISUAL_UNVERIFIED", "VISUAL_UNAVAILABLE"] as const) {
      expect(describeVisualState(s).length).toBeGreaterThan(0);
    }
  });
});