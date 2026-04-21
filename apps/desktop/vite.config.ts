import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port; see tauri.conf.json build.devUrl.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "localhost",
    hmr: { host: "localhost", protocol: "ws", port: 1421 },
  },
  envPrefix: ["VITE_", "TAURI_"],
  // pdfjs-dist enters the graph through a workspace package (@obelus/pdf-view),
  // so Vite's auto-discovery misses it and dev mode serves each of its ~hundreds
  // of sub-modules as a separate request. Force pre-bundling.
  optimizeDeps: {
    include: ["pdfjs-dist"],
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/pdfjs-dist")) return "pdfjs";
          if (id.includes("node_modules/@codemirror") || id.includes("node_modules/@lezer")) {
            return "codemirror";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/react-router/")
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
