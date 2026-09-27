import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  // Chemins relatifs : l'app fonctionne quel que soit le sous-dossier de
  // déploiement (évite l'écran noir si l'hébergeur sert sous /novastream/).
  base: './',
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react(),
    VitePWA({ registerType: "autoUpdate", manifest: { name: "DZ Stream", short_name: "DZ Stream", description: "Films, Series et Streaming", start_url: ".", scope: ".", display: "standalone", background_color: "#0a0a12", theme_color: "#42b883", lang: "fr", icons: [{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] }, workbox: { navigateFallback: "index.html", maximumFileSizeToCacheInBytes: 6000000 } })],
  server: {
    port: 3000,
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(__dirname, "./src") + "/" },
    ],
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    cssMinify: false,
  },
});
