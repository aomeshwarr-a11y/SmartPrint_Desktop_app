import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Vite config for the renderer (React UI) half of the Electron app. The main/preload
// processes are compiled separately by electron/tsconfig.json (see package.json scripts) -
// they are plain Node/CommonJS and do not go through Vite/bundling, matching a standard
// secure Electron project layout.
export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../packages/shared-contracts/src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
