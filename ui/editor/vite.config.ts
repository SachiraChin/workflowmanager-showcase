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
            "vendor-monaco": ["monaco-editor", "@monaco-editor/react"],
            "vendor-flow": ["@xyflow/react"],
            "vendor-dnd": [
              "@dnd-kit/core",
              "@dnd-kit/sortable",
              "@dnd-kit/utilities",
            ],
            "vendor-radix": [
              "@radix-ui/react-accordion",
              "@radix-ui/react-checkbox",
              "@radix-ui/react-collapsible",
              "@radix-ui/react-dialog",
              "@radix-ui/react-dropdown-menu",
              "@radix-ui/react-label",
              "@radix-ui/react-popover",
              "@radix-ui/react-progress",
              "@radix-ui/react-radio-group",
              "@radix-ui/react-scroll-area",
              "@radix-ui/react-select",
              "@radix-ui/react-separator",
              "@radix-ui/react-slider",
              "@radix-ui/react-slot",
              "@radix-ui/react-switch",
              "@radix-ui/react-tabs",
              "@radix-ui/react-toggle",
              "@radix-ui/react-toggle-group",
            ],
            "vendor-nunjucks": ["nunjucks"],
            "vendor-wavesurfer": ["wavesurfer.js"],
            "vendor-lucide": ["lucide-react"],
          },
        },
      },
    },
  };
});
