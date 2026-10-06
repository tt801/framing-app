import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// No proxy without an explicit target: never silently send local admin traffic to Production.
const apiProxyTarget = process.env.ADMIN_API_PROXY_TARGET?.trim();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: apiProxyTarget ? {
      "/api": { target: apiProxyTarget, changeOrigin: true },
    } : undefined,
  },
});
