import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(root, "tests"),
  timeout: 120_000,
  retries: 0,
  use: {
    headless: true,
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
