import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, "scripts/**/*.test.mjs", "src-tauri/**"],
  },
  server: {
    port: 1420,
    strictPort: true, // Tauri 依赖固定端口
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/react") || id.includes("/node_modules/react-dom")) {
            return "react";
          }
          if (id.includes("/node_modules/@xyflow/react")) {
            return "xyflow";
          }
          return undefined;
        },
      },
    },
  },
  clearScreen: false,
});
