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
    watch: {
      // Rust 构建产物目录：cargo 链接 exe 时文件被瞬时锁定，chokidar 去 watch
      // 会在 Windows 上撞出 EBUSY 直接崩掉 beforeDevCommand；target/ 变动本来
      // 也不需要触发前端刷新（src-tauri 源码由 cargo watch 负责重启）
      ignored: ["**/src-tauri/target/**"],
    },
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
