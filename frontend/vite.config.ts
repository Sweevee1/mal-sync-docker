import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://localhost:3000",
        // Keep the browser Host so the backend CSRF Origin check matches in dev.
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
