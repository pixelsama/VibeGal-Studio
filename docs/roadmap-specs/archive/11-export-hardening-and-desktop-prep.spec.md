# Spec 11 — Export Hardening And Desktop Prep

> 状态：已归档。
> 前置：[Spec 05](../archive/05-export-packaging.spec.md)、[Spec 06](./06-persistent-runtime-save-and-restore.spec.md)、[Spec 10](./10-renderer-diagnostics-and-contract-tooling.spec.md)。
> 目标：把 Web export V1 打磨成可复现、可诊断、可包装的发行基础，并为首个 desktop wrapper 做准备。

## 1. 背景

V1 已实现：

- `vibegal-cli build --target web`；
- validate gate；
- selected renderer bundling；
-完整复制 `content/`；
- `game.manifest.json`；
- Web runtime host；
- localStorage/in-memory storage adapter。

但发行还需要：

- 更稳定的 build manifest；
- asset manifest；
- base path smoke；
- renderer diagnostics 统一；
- build reproducibility；
- desktop wrapper 准备；
- release smoke automation。

## 2. 产品边界

export 负责：

- 打包 engine/runtime/renderer/content/assets；
- 校验 renderer 与 project；
- 生成 manifest；
- 产出可部署目录；
- 提供 smoke test。

export 不负责：

- renderer UI；
- 自动修复项目；
- 加密/DRM；
- 云存档；
- 移动端；
- 应用商店签名/公证。

## 3. V1.1 决策

- Web export 继续复制完整 `content/`，但额外生成 `asset.manifest.json` 描述资源路径、大小、hash、kind。
- build 输出必须可复现：除 `builtAt` 外，相同输入产物 hash 应稳定。
- `--base-path` 必须进入 smoke test。
- Renderer build 复用 Spec 10 diagnostics。
- Desktop prep 只实现 Tauri wrapper 的设计和最小 prototype，不进入签名/公证。
- V1.1 仍不支持 renderer 第三方 npm 依赖。

## 4. 功能范围

### 4.1 Build Manifest

扩展 `game.manifest.json`：

- project id/title；
- renderer id；
- renderer contract version；
- VibeGal-Studio build schema version；
- content hash；
- asset manifest hash；
- base path；
- build mode。

### 4.2 Asset Manifest

新增：

```json
{
  "schemaVersion": 1,
  "assets": [
    { "kind": "background", "id": "room", "path": "content/assets/bg/room.png", "size": 1234, "sha256": "..." }
  ]
}
```

### 4.3 Smoke Command

新增：

```text
vibegal-cli smoke <dist-dir> --target web --format json
```

检查：

- `index.html`；
- `game.manifest.json`；
- `runtime/bundle.js`；
- `content/graph.json`；
- all manifest assets exist；
- base path resolution metadata。

### 4.4 Desktop Prep

产出：

- Tauri game wrapper 设计文档；
- 最小 `--target desktop-tauri` prototype 可选择延后到本 spec 后半段；
- 不做签名/公证。

## 5. 非目标

- 不做资源加密。
- 不做差分补丁。
- 不做云存档。
- 不做移动端。
- 不做应用商店签名/公证。
- 不支持 renderer 第三方 npm 依赖。

## 6. 验收标准

- Web build 生成 `asset.manifest.json`。
- `game.manifest.json` 包含 content/asset hash。
- `vibegal-cli smoke` 能检查导出目录。
- `--base-path /foo/` 的产物 smoke 通过。
- renderer diagnostics 来自 Spec 10 的统一模型。
- desktop wrapper prep 文档进入 docs。

## 7. TDD / Smoke 清单

| 测试名 | 断言 |
| --- | --- |
| `buildWebWritesAssetManifest` | 产物包含 asset.manifest.json |
| `buildWebHashesContentAndAssets` | game manifest 包含 content/asset hash |
| `buildWebIsStableExceptBuiltAt` | 相同输入除 builtAt 外 manifest 稳定 |
| `smokeWebFailsMissingRuntimeBundle` | 缺 runtime bundle smoke 失败 |
| `smokeWebFailsMissingManifestAsset` | 缺 manifest asset smoke 失败 |
| `buildWebRespectsBasePathInManifest` | base path 写入 manifest 并被 smoke 识别 |
| `desktopTauriPrepDocExists` | desktop wrapper prep 文档存在并说明非目标 |

## 8. 归档记录

- 2026-07-08：Web build 生成 `asset.manifest.json`，包含资源 kind/id/path/size/sha256。
- 2026-07-08：`game.manifest.json` 增加 schema/build metadata、renderer contract version、content hash、asset manifest hash、base path。
- 2026-07-08：相同输入产物除 `builtAt` 外保持稳定，CLI 测试覆盖 manifest reproducibility。
- 2026-07-08：新增 `vibegal-cli smoke <dist-dir> --target web --format json|text`，检查 host/runtime/content/assets/hash/basePath。
- 2026-07-08：Web build 先跑 renderer diagnostics，再打包 selected renderer。
- 2026-07-08：新增 [desktop wrapper prep](../../desktop-tauri-wrapper-prep.md) 文档，明确 Tauri wrapper prototype 与非目标。
