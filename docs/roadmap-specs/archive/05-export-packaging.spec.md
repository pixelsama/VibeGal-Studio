# Spec 05 — Export and Packaging

> 状态：已归档。
> 前置：renderer contract 稳定、runtime persistence contract 初步成型。
> 目标：把 GalStudio 项目导出为可玩的游戏包，优先 Web，后续桌面。

## 0. V1 实现记录

已实现 Web export V1：

- `galstudio-cli build <project-path> --target web --out <dir> [--renderer <id>] [--strict] [--allow-warnings] [--base-path <path>] [--format json|text]`。
- build 前复用 CLI project validation；error 默认失败，`--strict` 下 warning 失败，`--allow-warnings` 可覆盖 strict warning gate。
- Web 产物包含 `index.html`、完整复制的 `content/`、`runtime/bundle.js`、`runtime/bundle.js.map`、`renderer/bundle.js` 和顶层 `game.manifest.json`。
- `game.manifest.json` 记录 project id/title、renderer id、contract version、build target、base path、builtAt、GalStudio build schema version。
- renderer/runtime bundling 通过随仓库提供的 Node esbuild worker；V1 仅允许 renderer 裸导入 `react`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom`、`react-dom/client`、`@galstudio/engine`，以及相对 imports。不支持 renderer 第三方 npm 依赖。
- 导出 runtime host 复用 `GraphNovelPlayer`、content validation、AudioEngine 与 renderer contract，能从 graph entry node 加载节点文件并播放 linear/choice/auto route。
- Web runtime storage adapter 提供 save slots、global persistent、runtime settings 三类独立 key；默认使用 `localStorage`，不可用时降级 in-memory 并记录 warning。

V1 明确未实现：桌面导出、应用商店签名/公证、资源加密、补丁更新、云存档、移动端、renderer marketplace、renderer 第三方依赖。

## 1. 背景

当前 GalStudio 可以编辑、验证、预览项目，但还不能把项目导出成玩家可运行的游戏。

现有 CLI 只支持：

```text
galstudio-cli validate <project-path> --format json|text
```

导出是整个架构的验收：

- 如果 Studio preview 能跑但 export 不能跑，说明 renderer contract 混入了 Studio 私有能力。
- 如果项目文件必须依赖源代码仓库才能运行，说明项目自描述和 runtime host 不完整。
- 如果导出后持久化行为不同，说明 runtime contract 不稳定。

## 2. 产品边界

导出负责包装：

- engine runtime；
- selected renderer；
- project `content/`；
- manifest/meta/graph/nodes；
- assets；
- runtime host；
- persistence adapter。

导出不负责：

- 改写 renderer UI；
- 注入正式菜单；
- 替 renderer 实现 gallery/backlog/save UI；
- 自动修复项目错误。

## 3. Export Runtime Host

需要一个 Studio 之外的独立播放器宿主。

概念：

```text
web-runtime-host
  -> load content/meta.json
  -> load content/manifest.json
  -> load content/graph.json
  -> load content/nodes/*.json
  -> instantiate GraphNovelPlayer
  -> instantiate AudioEngine
  -> load selected renderer bundle
  -> provide RendererProps + RuntimeServices
```

它本质上是把 `useProjectPlayer` 的预览链路从 Tauri/Studio 中抽离出来。

## 4. Web Export

第一目标：

```text
galstudio-cli build <project-path> --target web --out <dir>
```

产物示例：

```text
dist-game/
  index.html
  assets/
  content/
    meta.json
    manifest.json
    graph.json
    nodes/
    assets/
  renderer/
    bundle.js
  runtime/
    bundle.js
```

要求：

- 打包 selected renderer，而不是默认 renderer。
- 使用同一套 renderer contract。
- content 文件路径在 Web 环境可解析。
- 三层持久化落到 Web storage adapter。
- build 前运行 validate。
- validate 有 error 时默认失败。

## 5. CLI Build

V1 命令：

```text
galstudio-cli build <project-path> --target web --out dist-game
```

V1 参数：

```text
--renderer <id>
--strict
--allow-warnings
--base-path <path>
--format json|text
```

CLI 输出应机器可读：

```json
{
  "ok": true,
  "target": "web",
  "outDir": "...",
  "rendererId": "default",
  "warnings": []
}
```

失败时：

- 输出 stable error code；
- 指向文件、renderer、schema 或 build step；
- 非零 exit code。

## 6. Renderer Build

当前 Studio runtime compiler 支持项目 renderer TSX。

导出需要类似能力，但应更接近生产构建：

- compile renderer entry；
- bundle relative imports；
- reject unsupported bare imports unless explicitly allowed；
- include React/runtime dependencies；
- preserve sourcemap in dev build；
- report line/column errors。

V1 决策：

- 保持当前 renderer contract 限制，只允许 React、React DOM、`@galstudio/engine` 和相对 imports。
- V1 不支持 renderer 自带第三方 npm 依赖，也不引入 `renderers/<id>/package.json`。
- 裸导入若不在 allowlist 内，build 必须失败并输出 renderer id、文件、行列和 stable error code。
- CLI/export bundling 使用 Node esbuild；Studio preview 的 runtime compiler 可继续使用现有 esbuild-wasm 路线。

## 7. Persistence Adapter

Web export 至少需要：

- save slots；
- global persistent；
- runtime settings。

V1 storage：

- 使用与 Spec 02 对齐的可插拔 `RuntimeStorageAdapter`。
- Web 默认 adapter 使用 `localStorage` 存 save slots、global persistent、runtime settings。
- V1 save preview 不存截图二进制；需要大体积存档或截图后再迁移 IndexedDB。

接口应与 Spec 02 的 runtime services 对齐。

## 8. Desktop Export

桌面导出作为后续目标。

后续方向：

- Tauri shell per game；
- Electron shell；
- Web export + wrapper。

桌面目标必须复用：

- engine runtime；
- selected renderer；
- content；
- persistence contract；
- renderer contract。

不要让桌面导出引入与 Web export 完全不同的 runtime 行为。

## 9. Asset Packaging

要求：

- 复制实际使用的 assets；
- 可选复制全部 content assets；
- 检查 missing asset；
- 可生成 asset manifest；
- 后续支持压缩/加密，但 V1 不做。

V1 决策：

- 默认复制完整 `content/`；
- validate 报 missing/unused；
- 不做资源裁剪；
- 不做加密。
- 生成顶层 `game.manifest.json`，记录 project id/title、renderer id、contract version、build target、base path、builtAt 和 GalStudio build schema version。

## 10. Build Validation

build 前必须执行：

- project validate；
- manifest/meta/schema validate；
- graph/node validate；
- asset validate；
- renderer entry check；
- renderer compile check。

可以允许 warning，但 error 默认失败。

## 11. 非目标

- 不做应用商店签名/公证。
- 不做资源加密。
- 不做补丁更新。
- 不做云存档。
- 不做移动端。
- 不做 renderer marketplace。
- 不把 default renderer 写死为唯一导出 UI。

## 12. 验收标准

- `galstudio-cli build --target web` 能产出可打开的 Web 游戏。
- 产物使用 selected renderer。
- 产物可从 entry node 开始播放。
- choice/auto route 正常。
- assets 正常加载。
- save/global/settings storage adapter 可用。
- build 失败能输出机器可读错误。
- Studio preview 与 Web export runtime 行为一致。

## 13. TDD / Smoke 清单

| 测试名 | 断言 |
| --- | --- |
| `buildWebFailsWhenProjectValidationHasErrors` | 有 error 的项目 build 失败 |
| `buildWebUsesSelectedRenderer` | 指定 renderer 被打进产物 |
| `buildWebCopiesContentFiles` | content graph/nodes/manifest/meta 被复制 |
| `buildWebReportsRendererCompileError` | renderer 编译失败有文件和行列 |
| `webRuntimeFollowsLinearRoute` | 导出 runtime 能播放 linear edge |
| `webRuntimeHandlesChoiceRoute` | 导出 runtime 能选择 choice edge |
| `webRuntimePersistsSettingsSeparatelyFromSaveSlot` | 设置与存档分离 |

## 14. V1 决策

- `galstudio-cli build` 是唯一对外入口。Rust CLI 负责参数解析、project validation、路径安全、复制文件、机器可读输出；renderer/runtime bundling 委托给随包提供的 Node build worker。
- Renderer bundle 使用 Node esbuild，不复用浏览器内的 esbuild-wasm。原因是 export 是离线构建任务，需要更可靠的文件系统访问、sourcemap 和错误行列。
- `--base-path` 默认 `./`，保证导出包可在相对路径和静态文件服务器子目录下运行。用户传入 `/game/` 等路径时写入 `game.manifest.json`，runtime 统一从该 base 解析 content/asset 路径。
- V1 必须生成 `game.manifest.json`，作为导出产物自描述文件和后续 smoke test 入口。
- 首个 desktop export 复用 Web export，并优先用 Tauri wrapper；Electron 不作为首选路线。桌面导出不进入 V1 build 的验收范围。
