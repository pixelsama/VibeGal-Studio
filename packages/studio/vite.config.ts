import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 项目根目录环境变量：dev 时允许 Vite 读取磁盘上项目内的渲染层源码
const PROJECTS_ROOT = process.env.GALSTUDIO_PROJECTS_ROOT ?? "";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true, // Tauri 依赖固定端口
    fs: {
      // 允许加载仓库外（用户磁盘项目目录）的渲染层源码
      allow: PROJECTS_ROOT ? [PROJECTS_ROOT, "../../"] : ["../../"],
    },
  },
  clearScreen: false,
});
