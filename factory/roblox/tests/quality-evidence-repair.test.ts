import { describe, it, expect } from "vitest";
import {
  captureQualityScreenshot,
  extractRef,
  screenshotRefForCritic,
} from "../quality-screenshot.js";
import { collectStarterGuiEvidence } from "../ui-evidence.js";
import { runVisualCritic, VISUAL_UNAVAILABLE } from "../../mission/quality-critics.js";
import { evaluateProductionQualityGate } from "../../mission/quality-gate.js";
import { scrubEphemeralIds } from "../../mission/readiness-evidence.js";

function bridgeFor(shot: { ok: boolean; message: string; stdout?: string; data?: unknown }) {
  return {
    discover: async () => ({ pluginConnected: true, message: "studio connected via MCP (1 instance(s))" }),
    callTool: async () => shot,
  };
}

// 1. extractRef with valid path/id/ref → accepted
describe("defect 1: screenshot ref honesty", () => {
  it("accepts explicit path/id/ref", () => {
    expect(extractRef({ screenshotPath: "/tmp/shots/shot-1.png" }, undefined)).toBe("shot-1.png");
    expect(extractRef({ path: "/tmp/a/viewport.png" }, undefined)).toBe("viewport.png");
    expect(extractRef({ id: "shot-abc" }, undefined)).toBe("shot-abc");
    expect(extractRef({ ref: "viewport-1" }, undefined)).toBe("viewport-1");
  });

  it("accepts a real base64 image payload as evidence (no faked path)", () => {
    const pixels = "iVBOR".padEnd(400, "A");
    const ref = extractRef({ imageBase64: pixels, mimeType: "image/png" }, undefined);
    expect(ref).toContain("mcp-screenshot-image");
    expect(ref).not.toMatch(/\.png$/);
  });

  // 2. extractRef with only message/metadata → undefined/unavailable
  it("returns undefined for prose-only metadata (message/width/height/format/mimeType)", () => {
    const data = {
      width: 1280,
      height: 720,
      format: "png",
      mimeType: "image/png",
      message: "this_exact_image shows the viewport",
    };
    expect(extractRef(data, undefined)).toBeUndefined();
  });

  // 3. prose-tail message cannot become evidence
  it("never derives a ref from stdout prose tail", () => {
    expect(extractRef(undefined, "this_exact_image of the coin simulator viewport")).toBeUndefined();
    expect(
      extractRef({ width: 1, height: 2 }, "screenshot captured ok this_exact_image"),
    ).toBeUndefined();
  });

  it("captureQualityScreenshot reports unavailable honestly on prose-only ok", async () => {
    const ev = await captureQualityScreenshot(
      bridgeFor({
        ok: true,
        message: "screenshot captured",
        stdout: "this_exact_image shows the viewport",
        data: { width: 1280, height: 720, format: "png", mimeType: "image/png", message: "this_exact_image" },
      }) as never,
      { project: "coin-sim", missionId: "m-1", stage: "quality-review" },
    );
    expect(ev.status).toBe("unavailable");
    expect(ev.ref).toBeUndefined();
    expect(screenshotRefForCritic(ev)).toBeUndefined();
    expect(ev.detail).toContain(VISUAL_UNAVAILABLE);
  });

  // 4. visual critic with unavailable screenshot → VISUAL_UNAVAILABLE
  it("visual critic stays VISUAL_UNAVAILABLE without a screenshot", () => {
    const review = runVisualCritic({ sceneSummary: "SpawnLocation + BasePlate" });
    expect(review.status).toBe("unavailable");
    expect(review.evidenceNotes.join(" ")).toContain(VISUAL_UNAVAILABLE);
    expect(review.status).not.toBe("pass");
  });

  // 5. quality gate does not pass visual dimension on unavailable screenshot
  it("quality gate never passes visual when unavailable", () => {
    const functional = {
      functionalPass: true,
      functionalEvidence: "build ok",
      runtimePass: true,
      runtimeEvidence: "assertions pass",
    };
    const at = new Date().toISOString();
    const gate = evaluateProductionQualityGate({
      functional,
      reviews: [
        { dimension: "visual", status: "unavailable", findings: [], evidenceNotes: [`${VISUAL_UNAVAILABLE}: no pixels`], reviewedAt: at },
        { dimension: "ux", status: "pass", findings: [], evidenceNotes: ["ux evidenced"], reviewedAt: at },
        { dimension: "gameplay", status: "pass", findings: [], evidenceNotes: ["gameplay evidenced"], reviewedAt: at },
      ],
      unresolvedFindings: [],
    });
    expect(gate.dimensions.find((d) => d.dimension === "visual")?.status).toBe("unavailable");
    expect(gate.productionPass).toBe(false);
  });
});

// 6/7/8. StarterGui evidence contract
describe("defect 2: StarterGui property contract", () => {
  function uiBridge(scenario: "ok" | "unsupported") {
    const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
    return {
      calls,
      bridge: {
        callTool: async (tool: string, params: Record<string, unknown> = {}) => {
          calls.push({ tool, params });
          if (tool === "get_project_structure") {
            return {
              ok: true,
              message: "project structure read",
              stdout:
                "game.StarterGui.MainHud (ScreenGui) game.StarterGui.MainHud.CoinLabel (TextLabel) " +
                "game.StarterGui.MainHud.UpgradeButton (TextButton)",
            };
          }
          if (tool === "get_properties") {
            if (scenario === "unsupported") {
              return { ok: false, message: "property Visible is not supported for this class" };
            }
            return {
              ok: true,
              message: "properties read",
              stdout: JSON.stringify({ className: "TextButton", Name: "UpgradeButton", Visible: true, Text: "Upgrade" }),
            };
          }
          return { ok: false, message: `tool "${tool}" is not exposed by the MCP bridge (no 1:1 mapping).` };
        },
      },
    };
  }

  // 6. uses get_properties mapping correctly
  it("calls get_properties with { path } (never get_instance_properties)", async () => {
    const { calls, bridge } = uiBridge("ok");
    const ev = await collectStarterGuiEvidence(bridge as never);
    expect(ev.status).toBe("captured");
    const propCalls = calls.filter((c) => c.tool === "get_properties");
    expect(propCalls.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.tool === "get_instance_properties")).toBe(false);
    for (const c of propCalls) expect(typeof (c.params as Record<string, unknown>).path).toBe("string");
  });

  // 7. relevant UI properties captured when available
  it("captures Visible/Text for at least one UI node when available", async () => {
    const { bridge } = uiBridge("ok");
    const ev = await collectStarterGuiEvidence(bridge as never);
    expect(ev.nodes.length).toBeGreaterThan(0);
    expect(ev.uiInventory).toMatch(/Visible/);
    expect(ev.uiInventory).toMatch(/Upgrade/);
  });

  // 8. unsupported properties remain honest
  it("marks unsupported properties honestly instead of inventing values", async () => {
    const { bridge } = uiBridge("unsupported");
    const ev = await collectStarterGuiEvidence(bridge as never);
    expect(ev.status).toBe("captured");
    expect(ev.nodes).toHaveLength(0);
    expect(ev.uiInventory).toMatch(/unreadable|not supported/i);
  });
});

// 9. no secret/ephemeral identifiers introduced
describe("evidence hygiene", () => {
  it("introduces no secret/ephemeral identifiers", () => {
    const scrubbed = scrubEphemeralIds("Studio (instance:abc peer:xyz launch:qrs) shot-1.png evidence");
    expect(scrubbed).not.toContain("abc");
    expect(extractRef({ screenshotPath: "/tmp/shots/shot-1.png" }, undefined)).not.toMatch(/instance|peer|token/i);
    expect(`mcp-screenshot-image:image/png:400chars`).not.toMatch(/instance:|peer:|token/i);
  });
});
