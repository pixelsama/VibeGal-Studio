# Spec 05 — Export and Packaging

> 状态：草案。
> 前置：renderer contract 稳定、runtime persistence contract 初步成型。
> 目标：把 GalStudio 项目导出为可玩的游戏包，优先 Web，后续桌面。

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

候选命令：

```text
galstudio-cli build <project-path> --target web --out dist-game
```

候选参数：

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

开放问题：

- Web export 是否允许 renderer 引用第三方 npm 包？
- 若允许，如何声明依赖？
- 是否需要 `renderers/<id>/package.json`？
- 还是保持当前 contract：只允许 React、React DOM、`@galstudio/engine` 和相对 imports？

V1 建议保持当前限制，降低打包复杂度。

## 7. Persistence Adapter

Web export 至少需要：

- save slots；
- global persistent；
- runtime settings。

候选 storage：

- localStorage for V1；
- IndexedDB for larger save data；
- pluggable adapter later。

接口应与 Spec 02 的 runtime services 对齐。

## 8. Desktop Export

桌面导出作为后续目标。

候选：

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

V1 建议：

- 默认复制完整 `content/`；
- validate 报 missing/unused；
- 不做资源裁剪；
- 不做加密。

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

## 14. 开放问题

- build 实现放在 Rust CLI、Node 脚本，还是混合？
- renderer bundle 用现有 esbuild-wasm，还是 Node esbuild？
- Web export 的 base path 如何处理相对部署？
- 是否要生成 `game.manifest.json` 描述导出信息？
- 首个 desktop export 是否直接复用 Tauri？
