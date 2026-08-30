import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import path from "node:path";
import type { ArtifactStore } from "./artifact-store.js";
import {
  assertBoundingBoxInsideViewport,
  assertCanvasDimensionsValid,
  assertCanvasHasVisualContent,
  assertElementVisible,
  assertMenuSceneActive,
  assertNoClipping,
  type AssertionResult
} from "./assertions.js";
import type { VisualQaCheck, VisualQaErrorRecord, ViewportSize } from "./types.js";

export interface SmokeRunCallbacks {
  onCheckCompleted?: (check: VisualQaCheck) => void;
  onArtifactCreated?: (artifact: { id: string; type: "screenshot" | "trace" | "report"; label: string }) => void;
}

export interface ViewportSmokeResult {
  viewport: string;
  checks: VisualQaCheck[];
  errors: VisualQaErrorRecord[];
  artifacts: Array<{ id: string; type: "screenshot" | "trace" | "report"; label: string; createdAt: string; available: boolean }>;
  passed: boolean;
}

const YA_GAMES_MOCK = `
window.YaGames = {
  init: async () => ({
    features: { LoadingAPI: { ready: () => {} } },
    adv: {
      showFullscreenAdv: () => {},
      showRewardedVideo: () => {}
    },
    feedback: {
      canReview: async () => ({ value: false }),
      requestReview: async () => ({ feedbackSent: false })
    }
  })
};
`;

const IGNORED_REQUEST_HOSTS = ["yandex.ru", "yandex.net"];

function isCriticalRequest(url: string) {
  try {
    const host = new URL(url).hostname;
    return !IGNORED_REQUEST_HOSTS.some(h => host.endsWith(h));
  } catch {
    return false;
  }
}

function isBenignConsoleMessage(text: string) {
  return /favicon|devtools|yandex|YaGames|stats\.min|^No parent to post message$/i.test(text.trim());
}

async function runCheck(name: string, viewport: string, started: number, fn: () => Promise<AssertionResult>): Promise<VisualQaCheck> {
  const result = await fn();
  return {
    name,
    viewport,
    status: result.passed ? "passed" : "failed",
    durationMs: Date.now() - started,
    message: result.message
  };
}

export async function runTrafficDodgeSmoke(options: {
  baseUrl: string;
  viewport: ViewportSize;
  runId: string;
  artifactStore: ArtifactStore;
  traceOnFailure?: boolean;
  callbacks?: SmokeRunCallbacks;
}): Promise<ViewportSmokeResult> {
  const { viewport, runId, artifactStore, callbacks } = options;
  const checks: VisualQaCheck[] = [];
  const errors: VisualQaErrorRecord[] = [];
  const artifacts: ViewportSmokeResult["artifacts"] = [];
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let failed = false;

  const recordCheck = (check: VisualQaCheck) => {
    checks.push(check);
    if (check.status === "failed") failed = true;
    callbacks?.onCheckCompleted?.(check);
  };

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height }
    });

    if (options.traceOnFailure) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }

    page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", msg => {
      if (msg.type() === "error" && !isBenignConsoleMessage(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
page.on("pageerror", error => {
  const message = error.message;

  // Expected when Yandex Games SDK is executed outside the Yandex iframe.
  if (/^No parent to post message$/i.test(message.trim())) {
    return;
  }

  pageErrors.push(message);
});    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("requestfailed", request => {
      const url = request.url();
      if (isCriticalRequest(url)) failedRequests.push(`${request.failure()?.errorText ?? "failed"} ${url}`);
    });

    await page.addInitScript(YA_GAMES_MOCK);

    const pageLoadStart = Date.now();
    const response = await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    recordCheck(await runCheck("page-loads", viewport.label, pageLoadStart, async () => ({
      passed: Boolean(response && response.ok()),
      message: response ? `HTTP ${response.status()}` : "No response received"
    })));

    const canvas = page.locator("#game canvas").first();
    const canvasWaitStart = Date.now();
    await canvas.waitFor({ state: "attached", timeout: 30_000 }).catch(() => undefined);
    recordCheck(await runCheck("canvas-exists", viewport.label, canvasWaitStart, async () => ({
      passed: await canvas.count() > 0,
      message: await canvas.count() > 0 ? "Canvas element found" : "Canvas element missing"
    })));

    recordCheck(await runCheck("canvas-visible", viewport.label, Date.now(), () => assertElementVisible(canvas)));
    recordCheck(await runCheck("canvas-in-viewport", viewport.label, Date.now(), () => assertBoundingBoxInsideViewport(page!, canvas)));
    recordCheck(await runCheck("canvas-dimensions", viewport.label, Date.now(), () => assertCanvasDimensionsValid(canvas)));
    recordCheck(await runCheck("canvas-visual-content", viewport.label, Date.now(), () => assertCanvasHasVisualContent(canvas)));
    recordCheck(await runCheck("menu-scene-active", viewport.label, Date.now(), () => assertMenuSceneActive(page!)));
    recordCheck(await runCheck("canvas-not-clipped", viewport.label, Date.now(), () => assertNoClipping(canvas)));

    for (const message of pageErrors) {
      errors.push({ type: "page", message, viewport: viewport.label });
      failed = true;
    }
    for (const message of consoleErrors.slice(0, 5)) {
      errors.push({ type: "console", message, viewport: viewport.label });
      failed = true;
    }
    for (const message of failedRequests.slice(0, 5)) {
      errors.push({ type: "request", message, viewport: viewport.label });
      failed = true;
    }

    recordCheck(await runCheck("no-page-errors", viewport.label, Date.now(), async () => ({
      passed: pageErrors.length === 0,
      message: pageErrors.length ? pageErrors[0] : "No page errors"
    })));
    recordCheck(await runCheck("no-console-errors", viewport.label, Date.now(), async () => ({
      passed: consoleErrors.length === 0,
      message: consoleErrors.length ? consoleErrors[0] : "No console errors"
    })));
    recordCheck(await runCheck("no-critical-request-failures", viewport.label, Date.now(), async () => ({
      passed: failedRequests.length === 0,
      message: failedRequests.length ? failedRequests[0] : "No critical request failures"
    })));

    const screenshotPath = path.join(artifactStore.viewportDir(runId, viewport.label), "menu.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const screenshotArtifact = await artifactStore.saveBinary(runId, viewport.label, "menu", screenshotBuffer, "screenshot");
    artifacts.push(screenshotArtifact);
    callbacks?.onArtifactCreated?.(screenshotArtifact);

    recordCheck(await runCheck("screenshot-checkpoint", viewport.label, Date.now(), async () => ({
      passed: true,
      message: `Saved ${screenshotArtifact.label}`
    })));

    if (failed && options.traceOnFailure && context) {
      const tracePath = path.join(artifactStore.viewportDir(runId, viewport.label), "trace.zip");
      await context.tracing.stop({ path: tracePath });
      const { readFile } = await import("node:fs/promises");
      const traceBuffer = await readFile(tracePath);
      const traceArtifact = await artifactStore.saveBinary(runId, viewport.label, "trace", traceBuffer, "trace");
      artifacts.push(traceArtifact);
      callbacks?.onArtifactCreated?.(traceArtifact);
    } else if (options.traceOnFailure && context) {
      await context.tracing.stop();
    }

    return { viewport: viewport.label, checks, errors, artifacts, passed: !failed && checks.every(c => c.status === "passed") };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown smoke test error";
    errors.push({ type: "assertion", message, viewport: viewport.label });
    if (page && options.traceOnFailure) {
      try {
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotArtifact = await artifactStore.saveBinary(runId, viewport.label, "failure", screenshotBuffer, "screenshot");
        artifacts.push(screenshotArtifact);
        callbacks?.onArtifactCreated?.(screenshotArtifact);
      } catch { /* ignore screenshot failure */ }
    }
    if (context && options.traceOnFailure) {
      try {
        const tracePath = path.join(artifactStore.viewportDir(runId, viewport.label), "trace.zip");
        await context.tracing.stop({ path: tracePath });
        const { readFile } = await import("node:fs/promises");
        const traceArtifact = await artifactStore.saveBinary(runId, viewport.label, "trace", await readFile(tracePath), "trace");
        artifacts.push(traceArtifact);
        callbacks?.onArtifactCreated?.(traceArtifact);
      } catch { /* ignore trace failure */ }
    }
    return { viewport: viewport.label, checks, errors, artifacts, passed: false };
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
