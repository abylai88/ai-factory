import { describe, it, expect } from "vitest";
import {
  validateSender,
  parseHermesIntent,
  renderHermesReply,
} from "../gateway.js";

describe("hermes gateway", () => {
  it("rejects empty and non-allowlisted senders", () => {
    expect(validateSender({ userId: "", chatId: "c", text: "hi" }).ok).toBe(false);
    expect(validateSender({ userId: "u", chatId: "c", text: "" }).ok).toBe(false);
    expect(
      validateSender({ userId: "intruder", chatId: "c", text: "hi" }, new Set(["owner"])).ok
    ).toBe(false);
    expect(
      validateSender({ userId: "owner", chatId: "c", text: "hi" }, new Set(["owner"])).ok
    ).toBe(true);
  });

  it("parses create-game into a roblox goal", () => {
    const intent = parseHermesIntent({ userId: "u", chatId: "c", text: "Create a new Roblox game about space mining" });
    expect(intent.command).toBe("create-game");
    expect(intent.goal).toMatch(/roblox/i);
  });

  it("parses moon 30% larger into a scale modifier", () => {
    const intent = parseHermesIntent({ userId: "u", chatId: "c", text: "Make the moon 30% larger" });
    expect(intent.command).toBe("edit-game");
    expect(intent.modifiers?.moonScale).toBe(1.3);
  });

  it("parses structure + restyle requests", () => {
    expect(
      parseHermesIntent({ userId: "u", chatId: "c", text: "Add more structures around the spawn" }).command
    ).toBe("add-structure");
    expect(
      parseHermesIntent({ userId: "u", chatId: "c", text: "Make the environment darker" }).command
    ).toBe("restyle");
  });

  it("routes reference images to style intent (never exact copy)", () => {
    const intent = parseHermesIntent({
      userId: "u",
      chatId: "c",
      text: "Use this reference",
      imageRef: "/tmp/ref.png",
    });
    expect(intent.command).toBe("reference-image");
    expect(intent.imageRef).toBe("/tmp/ref.png");
  });

  it("renders telegram-safe replies with MEDIA tags", () => {
    const out = renderHermesReply({ status: "PASS", summary: "done", screenshotPath: "docs/qa/shot.png", projectId: "space-miner" });
    expect(out.text).toMatch(/PASS/);
    expect(out.media).toEqual(["MEDIA:docs/qa/shot.png"]);
  });
});
