/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Dev traffic enters through Caddy on :8080 (which also proxies /api).
    hmr: { clientPort: 8080 },
    // Bind mounts under Docker Desktop need polling for reliable HMR.
    watch: { usePolling: true },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
