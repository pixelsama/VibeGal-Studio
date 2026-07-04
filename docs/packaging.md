# 打包与发布说明

本阶段不引入真实签名密钥，先跑本地未签名包用于回归与归档验证。

## 安装前提
- Node.js + pnpm
- Rust + Cargo
- macOS 打包时（若需要）：对应 Xcode Command Line Tools

## 常用命令（本地）
- 安装依赖：`pnpm install`
- 生成前端产物：`pnpm --filter @galstudio/studio build`
- 导出 schema 并校验漂移：`pnpm run check:schemas`
- 版本一致性校验：`pnpm run check:versions`
- 发布前 smoke：`pnpm smoke:release`
- 打包（未签名）：
  - `pnpm --filter @galstudio/studio tauri build`
- 产物目录（默认）：
  - `packages/studio/src-tauri/target/release/bundle/`

## macOS 签名与公证（后续）
1. 准备 Apple Developer 账号与证书。
2. 在 `packages/studio/src-tauri/tauri.conf.json` 配置签名密钥与安装器。
3. 在 CI 引入 Notarize 阶段（暂不在本 spec 中执行，避免泄露凭据）。

## 回滚与审计
- 若版本号/签名信息调整，先运行：
  - `pnpm run check:versions`
  - `pnpm run check:schemas`
  - `pnpm smoke:release`
- 将 CI/本地命令输出归档到 release notes 或 checklist。
