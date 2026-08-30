import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({ plugins: [react()], root: path.resolve(import.meta.dirname, ".."), resolve: { alias: { "@shared": path.resolve(import.meta.dirname, "../shared/src") } }, server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4100" } } });
