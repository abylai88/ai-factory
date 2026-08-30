import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["factory/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000
  }
});
