import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  publicDir: path.join(here, "public"),
  resolve: {
    alias: {
      "@shared": path.join(here, "..", "shared"),
      "@": path.join(here, "src"),
    },
  },
  build: {
    outDir: path.join(here, "..", "dist", "web"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/mcp": "http://localhost:8787",
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icons/*.png", "icons/*.svg"],
      manifest: {
        id: "/",
        name: "Northstar",
        short_name: "Northstar",
        description: "Northstar — Personal Strategy OS. 人生にも、経営戦略を。",
        lang: "ja",
        start_url: "/?source=pwa",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0f1420",
        theme_color: "#0f1420",
        categories: ["productivity", "business"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Quick Capture", short_name: "Capture", url: "/capture?source=shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
          { name: "Today", short_name: "Today", url: "/today?source=shortcut", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Read-only API responses for Today / Big3 / recent reviews are cached for offline viewing.
            urlPattern: ({ url, request }) =>
              request.method === "GET" && /^\/api\/(today|focus\/week|reviews\/recent|me)$/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "northstar-offline-read",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 3 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
