import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    headers: { "Permissions-Policy": "geolocation=(self)" },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/waha": { target: "http://127.0.0.1:3000", changeOrigin: true, rewrite: (path) => path.replace(/^\/waha/, "") },
      "/n8n": { target: "http://127.0.0.1:5678", changeOrigin: true, rewrite: (path) => path.replace(/^\/n8n/, "") },
    },
  },
  preview: {
    headers: { "Permissions-Policy": "geolocation=(self)" },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/waha": { target: "http://127.0.0.1:3000", changeOrigin: true, rewrite: (path) => path.replace(/^\/waha/, "") },
      "/n8n": { target: "http://127.0.0.1:5678", changeOrigin: true, rewrite: (path) => path.replace(/^\/n8n/, "") },
    },
  },
});
