import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ test: { environment: "node", include: ["**/*.test.ts"] }, resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "../shared/src") } } });
