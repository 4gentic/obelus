import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,wasm,mjs,svg,bcmap,pfb,ttf,otf}"],
        navigateFallback: "/index.html",
      },
      manifest: {
        name: "Obelus",
        short_name: "Obelus",
        theme_color: "#F6F1E7",
        background_color: "#F6F1E7",
        display: "standalone",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
      },
    }),
  ],
});
