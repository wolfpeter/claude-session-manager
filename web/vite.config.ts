import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the backend runs on :3000; Vite proxies API + WebSocket calls to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
