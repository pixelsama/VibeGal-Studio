# 打包与发布说明

本阶段不引入真实签名密钥，先跑本地未签名包用于回归与归档验证。

## 安装前提
- Node.js + pnpm
- Rust + Cargo
- macOS 打包时（若需要）：对应 Xcode Command Line Tools

## 常用命令（本地）
- 安装依赖：`pnpm install`
- 生成 workspace 产物：`pnpm build`
- 导出 schema 并校验漂移：`pnpm run check:schemas`
- 版本一致性校验：`pnpm run check:versions`
- 发布前 smoke：`pnpm smoke:release`
- 打包（未签名）：
  - `pnpm tauri build`
- 产物目录（默认）：
  - `packages/studio/src-tauri/target/release/bundle/`

## Contracts 与 CLI 发布门槛
- exact MSRV：`cargo +1.77.2 check --locked --all-targets --manifest-path packages/studio/src-tauri/Cargo.toml`
- 离线 Cargo：先 `cargo fetch --locked`，再运行 `CARGO_NET_OFFLINE=true cargo test --locked --manifest-path packages/studio/src-tauri/Cargo.toml`
- `validate` 必须能从任意 cwd、无 Node 的 PATH 和无源码 checkout 环境运行。
- 安装包内 CLI 的 Web `build` / `smoke` 必须使用 bundled exporter；当前 build 仍要求系统 Node 或 `VIBEGAL_NODE`。
- CI 在 macOS/Windows bundle 后把安装物复制到独立、无 checkout 的 job，并使用含空格路径完成 validate/build/browser smoke。

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
