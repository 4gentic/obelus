import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ["pdfjs-dist"],
          dexie: ["dexie"],
          react: ["react", "react-dom", "react-router-dom"],
          zod: ["zod"],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,wasm,mjs,svg,bcmap,pfb,ttf}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/\.well-known/, /^\/sitemap/, /^\/robots\.txt$/],
      },
      manifest: {
        name: "Obelus",
        short_name: "Obelus",
        id: "/",
        start_url: "/",
        scope: "/",
        theme_color: "#F6F1E7",
        background_color: "#F6F1E7",
        display: "standalone",
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
    }),
  ],
});
