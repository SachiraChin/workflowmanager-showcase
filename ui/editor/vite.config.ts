import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  
  return {
    // Base path for assets - use VITE_EDITOR_URL for subdirectory deployment
    base: env.VITE_EDITOR_URL || "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      exclude: ["@wfm/shared"],
    },
    server: {
      host: "0.0.0.0",
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-shared": ["@wfm/shared"],
            "vendor-monaco": ["monaco-editor", "@monaco-editor/react"],
            "vendor-flow": ["@xyflow/react"],
            "vendor-dnd": [
              "@dnd-kit/core",
              "@dnd-kit/sortable",
              "@dnd-kit/utilities",
            ],
          },
        },
      },
    },
  };
});
