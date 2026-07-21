# [Bug] CLI worker 解析顺序会命中 `target/debug/exporter/` 陈旧副本，打进过时的 Web 载荷

## 环境

- OS：macOS（Apple Silicon, darwin arm64）
- 发现时间：2026-07-20（Spec 21 标题画面桌面导出 smoke 验证期间）
- 触发命令：`vibegal-cli build --target desktop`（cargo 构建的 debug CLI）

## 问题概述

桌面导出后的 smoke 失败，表现为导出物里的 Web 载荷是**旧版本**（不认识当时新加的标题门逻辑），而仓库内 `packages/studio/scripts/` 的源码明明是新的。排查确认：CLI 解析 Web exporter worker 时命中了 `target/debug/exporter/` 下 7 月 10 日的陈旧副本，而不是仓库里的最新脚本。

## 根因

`resolve_worker_path()`（`packages/studio/src-tauri/src/bin/cli.rs:1863-1895`）的候选解析顺序：

1. 环境变量（`VIBEGAL_EXPORT_WORKER` 等）——显式指定则优先；
2. exe 相对候选（`worker_path_candidates()`，cli.rs:1850-1861）：`<exe目录>/exporter/packages/studio/scripts/build-web-export.mjs`（`EXPORT_WORKER_RELATIVE_PATH`，cli.rs:1843）、`resources/`、`Resources/` 等；
3. **最后**才在 debug 构建下追加仓库源码路径 `../scripts/build-web-export.mjs`（cli.rs:1878-1880）。

当从 `target/debug/vibegal-cli` 直接运行 debug CLI 时，候选 2 中的 `target/debug/exporter/...` 一旦存在就会**抢先命中**，把永远最新的仓库 scripts 副本（候选 3）完全遮蔽。而 `resources/exporter/` 树只由 `scripts/prepare-web-exporter.mjs` 在 Tauri 构建前刷新（`tauri.conf.json:10` 的 `beforeBuildCommand`）——日常 `cargo run` / `cargo test` 走 CLI 时没有任何环节刷新它，副本只会越来越旧。

加重问题的两点：

- **不可观测**：解析成功时不打印实际命中的 worker 路径（只有找不到时才在错误里列候选清单，cli.rs:1885-1894），排查时只能靠猜；
- **不对称**：同一流程里 `VIBEGAL_DESKTOP_WORKER` 被显式设置（desktop worker 走候选 1），`VIBEGAL_EXPORT_WORKER` 未设置（web exporter 走候选 2 中招），两个 worker 的新旧来源不一致，失败表象极具迷惑性。

## 复现步骤

```bash
# 1. 让 target/debug/exporter/ 存在一份旧副本（历史构建残留即可）
# 2. 修改 packages/studio/scripts/build-web-export.mjs 的行为（例如 smoke 断言）
cd packages/studio/src-tauri && cargo build --bin vibegal-cli
# 3. 不显式设置 VIBEGAL_EXPORT_WORKER，执行 web/desktop 导出
./target/debug/vibegal-cli build <project> --target desktop --out /tmp/out
# 4. 导出物内的 Web 载荷是旧副本的行为，与仓库 scripts 源码不一致
```

## 当时的绕过方式

显式设置全部 worker 环境变量（`VIBEGAL_EXPORT_WORKER` / `VIBEGAL_DESKTOP_WORKER` / `VIBEGAL_SNAPSHOT_WORKER`）指向仓库 `packages/studio/scripts/` 下的真实脚本，重建后 smoke 通过。

## 建议修复方向

1. **debug 构建反转优先级**：`cfg!(debug_assertions)` 时把仓库 `scripts/` 路径（`CARGO_MANIFEST_DIR` 相对、永远最新）排在 exe 相对候选**之前**；`target/debug/exporter/` 副本仅在显式模拟分发布局时使用（如专用 env 开关）。这是最小且根除性的改法；
2. **可观测性**：解析成功时在 stderr/verbose 输出实际命中的 worker 路径（一行即可），下次同类问题秒级定位；
3. （可选）构建期刷新：`build.rs` 或 xtask 在每次构建 CLI 时同步 `target/debug/exporter/` 副本，保证不陈旧；
4. （可选）陈旧告警：命中候选与仓库 scripts 副本做 mtime 对比，更旧则 warn。

推荐 1 + 2 组合：1 根除遮蔽，2 让残余场景可诊断。

## 附录：同一验证流程中遇到的环境问题（非代码 bug）

Electron 43.1.1 运行时 zip 解压在 `.app` 内把符号链接写成 ASCII 文本 stub、二进制缺执行位，导致 `dyld` 加载失败无法启动。用定点脚本重建符号链接 + `chmod +x` 后恢复。如桌面 smoke 要在更多机器上跑，建议把解压后校验/修复步骤固化进 `build-desktop-export.mjs` 的运行时准备流程。
