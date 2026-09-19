/**
 * Hermes / Telegram → Factory mission gateway.
 *
 * Preferred topology (master task §10):
 *   Telegram → Hermes → Factory API / Mission Gateway → Manager
 * The Factory owns execution; Hermes is the communication/orchestration
 * interface and must NOT bypass Factory safety.
 *
 * Hermes-agent upstream: NousResearch/hermes-agent (MIT). This module does
 * not vendor it — it defines the contract the Hermes side speaks: validated
 * inbound intents, allowlisted commands, attachment handling (reference
 * images → style intent), and safe outbound replies with artifact refs.
 */

export type HermesCommand =
  | "create-game"
  | "edit-game"
  | "game-status"
  | "add-structure"
  | "restyle"
  | "reference-image"
  | "unknown";

export interface HermesInbound {
  userId: string;
  chatId: string;
  text: string;
  /** Reference image bytes/path when the user sent one. */
  imageRef?: string;
  messageId?: string;
}

export interface HermesIntent {
  command: HermesCommand;
  /** Factory goal text derived from the human message. */
  goal: string;
  /** Project slug when the message targets an existing game. */
  projectId?: string;
  /** Structured modifiers, e.g. { moonScale: 1.3 } for "moon 30% larger". */
  modifiers?: Record<string, number | string | boolean>;
  /** Caption accompanying a reference image. */
  caption?: string;
  imageRef?: string;
  rawText: string;
}

export interface HermesOutbound {
  chatId: string;
  text: string;
  /** MEDIA:/path tags Hermes ships as native attachments (screenshots). */
  media?: string[];
}

export interface GatewayValidation {
  ok: boolean;
  reason?: string;
}

/** Allowlisted sender/chat ids (TELEGRAM_ALLOWED_USERS pattern). */
export function validateSender(msg: HermesInbound, allowlist?: Set<string>): GatewayValidation {
  if (!msg.userId) return { ok: false, reason: "missing user id" };
  if (!msg.text && !msg.imageRef) return { ok: false, reason: "empty message (no text or image)" };
  if (allowlist && !allowlist.has(msg.userId) && !allowlist.has(msg.chatId)) {
    return { ok: false, reason: "sender not allowlisted" };
  }
  if (msg.text && msg.text.length > 4000) return { ok: false, reason: "message too long (max 4000 chars)" };
  return { ok: true };
}

/** Parse human text into a factory-safe intent (no direct tool execution). */
export function parseHermesIntent(msg: HermesInbound): HermesIntent {
  const text = (msg.text ?? "").trim();
  const lower = text.toLowerCase();
  const projectId = extractProjectId(text);

  if (msg.imageRef) {
    return {
      command: "reference-image",
      goal: text || "Apply reference style intent to the current game.",
      projectId,
      caption: text,
      imageRef: msg.imageRef,
      rawText: text,
    };
  }
  if (/(create|build|make|new).*(game|roblox|simulator|obby|tycoon)/i.test(text)) {
    return { command: "create-game", goal: toRobloxGoal(text), projectId, rawText: text };
  }
  if (/status|progress|how.*going|report/i.test(lower)) {
    return { command: "game-status", goal: text, projectId, rawText: text };
  }
  const scale = parseScaleModifier(lower);
  if (scale) {
    return {
      command: "edit-game",
      goal: `${text} (target project: ${projectId ?? "current game"})`,
      projectId,
      modifiers: scale,
      rawText: text,
    };
  }
  if (/(add|more|place|spawn).*(struct|building|tree|coin|house|spawn|floor)/i.test(text)) {
    return { command: "add-structure", goal: text, projectId, rawText: text };
  }
  if (/(darker|brighter|larger|smaller|style|theme|reference|mood|palette)/i.test(lower)) {
    return { command: "restyle", goal: text, projectId, rawText: text };
  }
  return { command: text ? "edit-game" : "unknown", goal: text, projectId, rawText: text };
}

function extractProjectId(text: string): string | undefined {
  const m = text.match(/(?:project|game)\s+([a-z0-9][a-z0-9-]{2,60})/i);
  return m ? m[1].toLowerCase() : undefined;
}

function toRobloxGoal(text: string): string {
  return /roblox|luau|rojo/i.test(text) ? text : `Roblox: ${text}`;
}

function parseScaleModifier(lower: string): Record<string, number> | undefined {
  const pct = lower.match(/(\d{1,3})\s*%\s*(larger|bigger|smaller)/);
  if (pct) {
    const n = Number(pct[1]);
    const factor = pct[2].startsWith("small") ? 1 - n / 100 : 1 + n / 100;
    if (lower.includes("moon")) return { moonScale: round2(factor) };
    return { targetScale: round2(factor) };
  }
  if (/moon.*(larger|bigger)/.test(lower)) return { moonScale: 1.3 };
  return undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Render a factory result as a Telegram-safe reply (no secrets, bounded). */
export function renderHermesReply(result: {
  status: string;
  summary: string;
  screenshotPath?: string;
  projectId?: string;
}): HermesOutbound {
  const lines = [
    `Factory result: ${result.status}`,
    result.summary.slice(0, 1500),
    result.projectId ? `Project: ${result.projectId}` : "",
  ].filter(Boolean);
  return {
    chatId: "",
    text: lines.join("\n"),
    media: result.screenshotPath ? [`MEDIA:${result.screenshotPath}`] : undefined,
  };
}
