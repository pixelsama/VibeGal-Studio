# [Bug] 桌面导出（Electron）在 macOS 上失败：测试夹具与打包逻辑的平台布局不匹配

## 环境

- OS：macOS（Apple Silicon, darwin arm64）
- 版本：`main` @ `57d6b17`（2026-07-20 拉取）
- Node：v24.x
- Rust：cargo 1.92.0

## 问题概述

`main` 分支新增的桌面导出（Desktop Export）功能在 macOS 上有 3 个测试失败，其中 2 个是确定性的平台 bug（100% 复现），1 个是疑似环境相关的截图超时。

---

## 失败 1：Electron 打包测试在 macOS 上必然失败（Rust 侧）

**测试**：`cargo test --bin vibegal-cli build_desktop_packages_electron_and_tauri_from_the_same_web_contract`

**错误**：

```
desktop build should succeed: BuildError {
  ok: false,
  code: "desktop_worker_failed",
  message: "ENOENT: no such file or directory, lstat '.../fake-electron/Electron.app'",
  step: "desktop", ...
}
```

**根因**：`packages/studio/scripts/build-desktop-export.mjs` 的 `packageElectron()` 在 `darwin` 平台要求 Electron 运行时为完整的 macOS bundle 结构：

```js
// build-desktop-export.mjs:269
if (process.platform === "darwin") {
  const sourceBundle = path.join(electronDist, "Electron.app");
  ...
}
```

但测试夹具（`packages/studio/src-tauri/src/bin/cli.rs:6528-6537`）只创建了 Linux/Windows 风格的扁平布局：

```rust
write_text(&electron_dist.join("electron"), "fake electron");
write_text(&electron_dist.join("resources/default_app.asar"), "fake default app");
```

夹具中没有 `Electron.app` 目录，因此该测试在 macOS 上**永远无法通过**；在 Linux CI 上能过，所以 CI 是绿的。

**建议修复方向**（二选一）：

1. 测试夹具按平台生成对应布局——`cfg!(target_os = "macos")` 时创建 `Electron.app/Contents/MacOS/Electron` 与 `Electron.app/Contents/Resources/default_app.asar` 的伪 bundle；
2. 或者在 darwin 上跳过该用例（`#[cfg_attr(target_os = "macos", ignore)]`），但会损失 macOS 覆盖。

---

## 失败 2：同一问题的 JS 侧镜像

**测试**：`node --test scripts/build-desktop-export.test.mjs`

**错误**：

```
AssertionError: {
  "ok": false,
  "code": "desktop_worker_failed",
  "message": "ENOENT: no such file or directory, lstat '.../electron-dist/Electron.app'",
  "step": "desktop"
}
```

与失败 1 同根因：`build-desktop-export.test.mjs:63` 的用例同样只准备了扁平布局的 `electron-dist`。

---

## 失败 3：渲染器快照端到端测试截图超时（疑似环境/性能问题）

**测试**：`cargo test --bin vibegal-cli renderer_snapshot_end_to_end`（整测耗时 460s）

**错误**：11 个场景中 10 个报 `浏览器截图超时（45s）`，仅 `narration` 场景成功：

```
id: "dialogue",   status: "error", error: "浏览器截图超时（45s）"
id: "narration",  status: "ok"
id: "choice",     status: "error", error: "浏览器截图超时（45s）"
id: "sprites",    status: "error", error: "浏览器截图超时（45s）"
...（save/history/settings/gallery-* 共 10 个超时）
```

**分析**：截图链路本身可用（有成功案例），10/11 超时更像本机 headless Chrome 渲染性能问题或超时阈值过紧，暂未发现代码逻辑错误。可考虑：

- 将 45s 超时做成环境变量可配置；
- 或在 CI/慢机器上对该用例标记 `ignore`。

---

## 复现步骤

```bash
git checkout 57d6b17
pnpm install
cd packages/studio/src-tauri
cargo test --bin vibegal-cli   # 失败 1、3
cd .. && node --test scripts/build-desktop-export.test.mjs   # 失败 2
```

## 其余测试状态（供参考）

前端 806（vitest）+ Rust 204（lib/集成/CLI 其余用例）全部通过，问题集中在桌面导出与截图快照两个新功能。
