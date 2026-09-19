/**
 * Reference-image → structured intent.
 *
 * The Factory must eventually support: human → Telegram → reference image →
 * Hermes → Factory. The image is NEVER "copy exactly" — it becomes
 * structured style intent that agents consume:
 *
 *   camera / palette / lighting / environment / architecture / mood /
 *   gameplay hints
 *
 * This module is the deterministic side: manifest shapes, prompt builders,
 * and a heuristic fallback parser. A vision-capable model fills the same
 * schema when available (pluggable `VisionAnalyzer`); without one the
 * pipeline degrades honestly instead of fabricating observations.
 */

export interface ReferenceStyleIntent {
  camera: string;
  palette: string[];
  lighting: string;
  environment: string;
  architecture: string;
  mood: string;
  gameplayHints: string[];
  notes: string;
  /** "vision-model" when a real model analyzed the image, else "heuristic". */
  source: "vision-model" | "heuristic" | "human-text";
}

export type VisionAnalyzer = (
  imagePathOrBytes: string | Uint8Array,
  prompt: string
) => Promise<Partial<ReferenceStyleIntent>>;

export function emptyStyleIntent(source: ReferenceStyleIntent["source"] = "heuristic"): ReferenceStyleIntent {
  return {
    camera: "third-person",
    palette: [],
    lighting: "neutral",
    environment: "unspecified",
    architecture: "unspecified",
    mood: "neutral",
    gameplayHints: [],
    notes: "",
    source,
  };
}

export function buildStyleAnalysisPrompt(): string {
  return [
    "Analyze this reference image as GAME STYLE INTENT, not as an asset to copy.",
    "Return structured intent with exactly these fields:",
    "camera: (third-person | first-person | top-down | side-view | isometric)",
    "palette: (3-6 color descriptors, e.g. dark metallic, blue highlights)",
    "lighting: (e.g. cinematic, bright cartoon, dark moody)",
    "environment: (e.g. industrial sci-fi, fantasy forest, urban)",
    "architecture: (e.g. large angular structures, low-poly huts)",
    "mood: (e.g. premium futuristic, cozy, mysterious)",
    "gameplayHints: (1-4 inferred loops: exploration/progression/social)",
    "Do NOT copy characters, logos, or copyrighted designs. Derive style direction only.",
  ].join("\n");
}

/**
 * Heuristic fallback: derives conservative intent from accompanying human
 * text (filename/caption) without pretending to see pixels. Vision-model
 * results always take precedence when provided.
 */
export function heuristicStyleFromText(hint: string): ReferenceStyleIntent {
  const t = (hint ?? "").toLowerCase();
  const intent = emptyStyleIntent("heuristic");
  if (/sci-?fi|space|cyber|robot|industrial/.test(t)) {
    intent.environment = "industrial sci-fi";
    intent.palette = ["dark metallic", "blue highlights"];
    intent.lighting = "cinematic";
    intent.architecture = "large angular structures";
    intent.mood = "premium futuristic";
    intent.gameplayHints = ["exploration", "progression"];
  } else if (/fantasy|forest|magic|castle/.test(t)) {
    intent.environment = "fantasy wilderness";
    intent.palette = ["deep green", "warm gold"];
    intent.lighting = "soft volumetric";
    intent.architecture = "organic timber structures";
    intent.mood = "adventurous cozy";
    intent.gameplayHints = ["exploration", "quest"];
  } else if (/horror|dark|dungeon|cave/.test(t)) {
    intent.environment = "dark dungeon";
    intent.palette = ["near-black", "ember orange"];
    intent.lighting = "dark moody";
    intent.architecture = "tight stone corridors";
    intent.mood = "tense mysterious";
    intent.gameplayHints = ["survival", "progression"];
  }
  if (/first-?person|fps/.test(t)) intent.camera = "first-person";
  else if (/top-?down/.test(t)) intent.camera = "top-down";
  else if (/side/.test(t)) intent.camera = "side-view";
  intent.notes = hint ? `heuristic derived from caption: "${hint.slice(0, 200)}" (no vision model ran)` : "no caption provided; defaults used";
  return intent;
}

export async function analyzeReferenceImage(
  image: string | Uint8Array,
  opts?: { caption?: string; vision?: VisionAnalyzer }
): Promise<ReferenceStyleIntent> {
  const base = heuristicStyleFromText(opts?.caption ?? (typeof image === "string" ? image : ""));
  if (!opts?.vision) return base;
  try {
    const partial = await opts.vision(image, buildStyleAnalysisPrompt());
    return sanitizeIntent({ ...base, ...partial, source: "vision-model" as const });
  } catch {
    return base;
  }
}

function sanitizeIntent(i: ReferenceStyleIntent): ReferenceStyleIntent {
  const str = (v: unknown, fb: string) => (typeof v === "string" && v.trim() ? v.slice(0, 200) : fb);
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 8) : []);
  return {
    camera: str(i.camera, "third-person"),
    palette: arr(i.palette),
    lighting: str(i.lighting, "neutral"),
    environment: str(i.environment, "unspecified"),
    architecture: str(i.architecture, "unspecified"),
    mood: str(i.mood, "neutral"),
    gameplayHints: arr(i.gameplayHints),
    notes: str(i.notes, ""),
    source: i.source === "vision-model" ? "vision-model" : i.source === "human-text" ? "human-text" : "heuristic",
  };
}

/** Render intent as agent-consumable markdown for GDD/visual prompts. */
export function renderStyleIntent(intent: ReferenceStyleIntent): string {
  return [
    "REFERENCE STYLE ANALYSIS",
    ``,
    `camera: ${intent.camera}`,
    `palette: ${intent.palette.join(", ") || "(unspecified)"}`,
    `lighting: ${intent.lighting}`,
    `environment: ${intent.environment}`,
    `architecture: ${intent.architecture}`,
    `mood: ${intent.mood}`,
    `gameplay: ${intent.gameplayHints.join(" / ") || "(unspecified)"}`,
    intent.notes ? `notes: ${intent.notes}` : "",
    `(source: ${intent.source} — style direction only, never copy copyrighted designs)`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
