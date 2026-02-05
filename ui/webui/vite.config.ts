import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Don't pre-bundle the shared package so changes are picked up immediately
  optimizeDeps: {
    exclude: ["@wfm/shared"],
  },
  server: {
    allowedHosts: ["arandomsitein.space"],
    host: "0.0.0.0",
  },
})
