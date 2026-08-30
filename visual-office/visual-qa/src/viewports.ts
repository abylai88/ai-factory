import type { ViewportSize } from "./types.js";

export const DEFAULT_VIEWPORTS: ViewportSize[] = [
  { label: "1280x720", width: 1280, height: 720 },
  { label: "1366x768", width: 1366, height: 768 },
  { label: "1920x1080", width: 1920, height: 1080 }
];

const VIEWPORT_PATTERN = /^(\d{3,5})x(\d{3,5})$/;

export function parseViewportLabel(label: string): ViewportSize | undefined {
  const match = VIEWPORT_PATTERN.exec(label.trim());
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 320 || width > 3840 || height < 240 || height > 2160) return undefined;
  return { label: `${width}x${height}`, width, height };
}

export function resolveViewports(requested?: string[]): ViewportSize[] {
  if (!requested?.length) return [...DEFAULT_VIEWPORTS];
  const parsed = requested.map(parseViewportLabel).filter((v): v is ViewportSize => Boolean(v));
  if (!parsed.length) return [...DEFAULT_VIEWPORTS];
  const unique = new Map(parsed.map(v => [v.label, v]));
  return [...unique.values()];
}

export function isValidViewportLabel(label: string): boolean {
  return Boolean(parseViewportLabel(label));
}
