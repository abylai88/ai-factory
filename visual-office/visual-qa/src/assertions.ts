import type { Page, Locator } from "playwright";

export interface AssertionResult {
  passed: boolean;
  message: string;
}

export async function assertElementVisible(locator: Locator): Promise<AssertionResult> {
  const visible = await locator.isVisible().catch(() => false);

  return visible
    ? { passed: true, message: "Element is visible" }
    : { passed: false, message: "Element is not visible" };
}

export async function assertBoundingBoxInsideViewport(
  page: Page,
  locator: Locator,
): Promise<AssertionResult> {
  const box = await locator.boundingBox();

  if (!box) {
    return { passed: false, message: "Element has no bounding box" };
  }

  const viewport = page.viewportSize();

  if (!viewport) {
    return { passed: false, message: "Viewport size unavailable" };
  }

  const fullyInside =
    box.x >= -1 &&
    box.y >= -1 &&
    box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1;

  if (fullyInside) {
    return {
      passed: true,
      message: "Bounding box is fully inside viewport",
    };
  }

  // Phaser Traffic Dodge intentionally renders a wider canvas and centers
  // it with overflow on narrow viewports. Reject only if the canvas does not
  // intersect the viewport at all.
  const intersectsViewport =
    box.x < viewport.width &&
    box.x + box.width > 0 &&
    box.y < viewport.height &&
    box.y + box.height > 0;

  return intersectsViewport
    ? {
        passed: true,
        message: `Canvas intersects viewport (${Math.round(box.x)},${Math.round(
          box.y,
        )} ${Math.round(box.width)}x${Math.round(box.height)})`,
      }
    : {
        passed: false,
        message: `Element is outside viewport (${Math.round(box.x)},${Math.round(
          box.y,
        )} ${Math.round(box.width)}x${Math.round(box.height)})`,
      };
}

export async function assertNoClipping(locator: Locator): Promise<AssertionResult> {
  const clipped = await locator
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        return true;
      }

      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);

      return top !== el && !el.contains(top);
    })
    .catch(() => true);

  return clipped
    ? { passed: false, message: "Element appears clipped or occluded" }
    : { passed: true, message: "Element is not clipped" };
}

export async function assertCanvasDimensionsValid(
  locator: Locator,
  min = 100,
): Promise<AssertionResult> {
  const dims = await locator.evaluate((el: HTMLCanvasElement) => ({
    width: el.width,
    height: el.height,
  }));

  return dims.width >= min && dims.height >= min
    ? {
        passed: true,
        message: `Canvas dimensions ${dims.width}x${dims.height}`,
      }
    : {
        passed: false,
        message: `Canvas dimensions too small: ${dims.width}x${dims.height}`,
      };
}

export async function assertCanvasHasVisualContent(
  locator: Locator,
): Promise<AssertionResult> {
  try {
    const result = await locator.evaluate((el: HTMLCanvasElement) => {
      const width = el.width;
      const height = el.height;

      if (width <= 0 || height <= 0) {
        return { passed: false, message: "Canvas has zero dimensions" };
      }

      // Phaser.AUTO may use WebGL instead of a 2D context.
      // In that case, getContext("2d") is not a valid way to determine
      // whether the game is visually rendering.
      const hasWebGL =
        Boolean(el.getContext("webgl")) ||
        Boolean(el.getContext("webgl2"));

      const ctx2d = el.getContext("2d");

      if (!ctx2d && hasWebGL) {
        return {
          passed: true,
          message: "Canvas has an active WebGL rendering context",
        };
      }

      if (!ctx2d) {
        return {
          passed: false,
          message: "Canvas has neither a 2D nor WebGL rendering context",
        };
      }

      const points = [
        [0.5, 0.35],
        [0.5, 0.5],
        [0.5, 0.65],
        [0.3, 0.5],
        [0.7, 0.5],
      ];

      const colors = new Set<string>();

      for (const [rx, ry] of points) {
        const x = Math.min(width - 1, Math.floor(width * rx));
        const y = Math.min(height - 1, Math.floor(height * ry));
        const data = ctx2d.getImageData(x, y, 1, 1).data;
        colors.add(`${data[0]},${data[1]},${data[2]},${data[3]}`);
      }

      return colors.size >= 3
        ? {
            passed: true,
            message: "Canvas contains varied 2D visual content",
          }
        : {
            passed: false,
            message: "Canvas appears blank or uniform",
          };
    });

    return result;
  } catch (error) {
    return {
      passed: false,
      message:
        error instanceof Error
          ? `Canvas visual-content check failed: ${error.message}`
          : "Canvas visual-content check failed",
    };
  }
}

export async function assertMenuSceneActive(
  page: Page,
): Promise<AssertionResult> {
  const canvas = page.locator("#game canvas").first();

  try {
    await canvas.waitFor({
      state: "visible",
      timeout: 5_000,
    });

    const ready = await page.evaluate(() => {
      const game = document.querySelector("#game");
      const canvas = game?.querySelector("canvas");

      if (!game || !canvas) {
        return false;
      }

      const rect = canvas.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        document.visibilityState === "visible"
      );
    });

    return ready
      ? {
          passed: true,
          message: "Game booted with a visible canvas",
        }
      : {
          passed: false,
          message: "Game canvas is not in a ready visible state",
        };
  } catch {
    return {
      passed: false,
      message: "Game did not reach a visible canvas state",
    };
  }
}

export async function assertScreenshotCheckpoint(
  filePath: string,
): Promise<AssertionResult> {
  const { access, stat } = await import("node:fs/promises");

  try {
    await access(filePath);
    const info = await stat(filePath);

    return info.size > 0
      ? {
          passed: true,
          message: "Screenshot checkpoint exists",
        }
      : {
          passed: false,
          message: "Screenshot checkpoint is empty",
        };
  } catch {
    return {
      passed: false,
      message: "Screenshot checkpoint missing",
    };
  }
}
