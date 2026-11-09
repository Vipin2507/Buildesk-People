import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    headers: { "Permissions-Policy": "geolocation=(self)" },
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  preview: {
    headers: { "Permissions-Policy": "geolocation=(self)" },
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
