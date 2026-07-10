# Spec 13 — Default Renderer Player UX And Runtime Settings

> 状态：已归档。
> 基线：`fd53fa4 refactor: drive rust validation from contracts`。
> 前置：[Spec 02](./archive/02-renderer-runtime-api.spec.md)、[Spec 06](./archive/06-persistent-runtime-save-and-restore.spec.md)、[Spec 07](./archive/07-playback-history-rollback-and-skip.spec.md)、[Spec 09](./archive/09-unlock-media-replay-runtime.spec.md)。
> 当前代码优先：实施前必须重新读取实际代码；本文约束产品结果和验收，不得用规划覆盖更新后的代码事实。
> 目标：把已经存在的 save/history/skip/settings runtime 能力接入默认 renderer，使新建项目和 Web 导出无需自行开发 renderer 就具备基本完整的 Galgame 玩家控制界面。

## 1. 背景与当前问题

Engine 和 Web runtime 已经具备相当完整的底层服务：

- `runtime.save` 支持 list/save/load/delete/quick/auto；
- `runtime.history` 支持 backlog、语音重播和 rollback；
- `controls.setSkipMode()` 支持已读跳过和全文跳过；
- `runtime.settings` 支持运行时设置记录和分轨音量；
- Web export 使用 `localStorage` 保存 save/global/settings；
- Studio preview 和 Web export 均提供完整 `RendererProps.controls/runtime` 形状；
- CG 和视频已由宿主级 `RuntimeMediaOverlay` 展示。

但当前默认 renderer 只提供：

- 推进和选择；
- 重开；
- 自动播放开关；
- 录制/进度提示。

因此目前存在明显的“能力已实现但产品不可见”问题：

1. 玩家无法通过默认界面创建、读取、覆盖或删除存档。
2. 快存、快读和 auto save 只有 API，没有正常产品入口或触发点。
3. backlog、语音重播和 rollback 没有历史界面。
4. skip mode 没有按钮和状态反馈。
5. runtime settings 没有游戏内设置页。
6. `textSpeedCps`、`autoAdvanceMs` 和 `fullscreen` 虽在设置记录中存在，但当前只有音量会真正应用；播放器计时仍固定读取项目 `meta`。
7. Web runtime 启动时没有把已持久化 settings 作为首屏有效设置加载进 player/audio。
8. Studio preview 的 runtime persistence 仍是内存级；它可用于调试服务，但不能让人误以为是正式玩家存档位置。

本 spec 负责完成默认玩家控制闭环，不继续扩张底层数据契约。

## 2. 本期完成后的产品结果

完成后，新建项目自带的默认 renderer 必须可以直接完成：

- 打开统一玩家菜单；
- 手动存档、读档、覆盖存档和删除存档；
- 快速存档与快速读档；
- 在稳定剧情点生成自动存档；
- 查看历史文本、重播该条语音、回滚到历史停点；
- 开关自动播放、已读跳过和全文跳过，并看到当前状态；
- 调整主音量、BGM、音效、语音、文字速度和自动播放间隔；
- 重新打开 Web 导出游戏后保留存档、已读/解锁和运行时设置；
- 在 Studio preview 中使用同一套 UI 和 service contract 进行本次预览会话内的调试。

这里的“完成”指默认模板真正可操作，不以“接口存在”或“自定义 renderer 可以自己实现”为验收标准。

## 3. 产品边界

### 3.1 本期包含

- 默认 renderer 的玩家菜单与 HUD 控制。
- 手动存档、快存、快读、自动存档 UI/行为。
- 历史、语音重播与回滚 UI。
- 已读跳过、全文跳过、自动播放状态 UI。
- 游戏内运行时设置 UI。
- 文字速度和自动播放间隔对 `GraphNovelPlayer` 的真实运行时覆盖。
- Web export 启动时读取持久化 settings，并在首个可见剧情状态前应用。
- 默认 renderer 三份镜像的同步和行为验证。
- Web 导出的真实浏览器行为 smoke。

### 3.2 本期不包含

- CG Gallery、回想模式、音乐鉴赏、结局列表 UI；这些进入后续 Spec 14。
- CG/video/font/uiSkin/animationAtlas/unlock registry 的完整资产编辑器；这些进入后续资产 UX spec。
- 标题画面、周目选择、路线选择和章节选择。
- 云存档、跨设备同步、存档导入导出、截图二进制缩略图。
- 手柄、触屏手势和可重绑定键位系统。
- renderer iframe/WebView 隔离。
- 在 Studio preview 中创建项目持久或系统全局的正式玩家存档。Studio preview 本期仍允许使用内存 adapter。
- fullscreen/windowed 切换。现有 `fullscreen` 字段继续兼容读取和保存，但本期不在默认 UI 暴露；窗口宿主能力另立 spec。
- Renderer contract v2。实现应优先使用现有 contract v1 的 `controls/runtime`。

## 4. 必须保护的现有行为

1. 默认 renderer 仍是项目本地可修改代码，不变成 Studio 内置不可替换 UI。
2. 新项目模板、Tauri resource 和示例项目 renderer 保持字节级一致。
3. 自定义 renderer 不强制采用默认菜单布局。
4. `RendererProps` 继续使用 `controls/runtime`，不恢复旧 `onAdvance/onChoose` 回调。
5. 读档不得回滚 global persistent 的已读状态、CG/音乐/回想/结局解锁或 runtime settings。
6. rollback 和 load 不得重复播放 one-shot SFX、voice、unlock、CG 或 video effect。
7. `skipMode: "read"` 继续在未读文本、choice、pause 和错误处停止。
8. `skipMode: "all"` 继续在 choice、pause 和错误处停止。
9. Web export 在 `localStorage` 不可用时仍可降级到内存 adapter，不得导致游戏无法启动。
10. Studio 继续只通过 typed runtime/host API 驱动 player，不在 renderer 内直接访问 Tauri 文件系统。

## 5. 默认 Renderer UX

### 5.1 HUD

非录制模式下，舞台必须提供以下稳定入口：

- 菜单；
- 快存；
- 快读；
- 自动播放；
- 已读跳过；
- 全文跳过；
- 历史。

要求：

- 当前 auto/skip 状态必须可见，不能只靠按钮点击后的瞬时提示。
- `read` 与 `all` skip 互斥；切换到一种 skip mode 时另一种自动关闭。
- skip 被 player 因 choice、pause、未读文本或错误停止后，UI 必须反映真实 mode，而不是保留过期的本地按钮状态。
- 菜单或弹层打开时，点击弹层内容不能冒泡成剧情推进。
- choice 展示时仍允许打开历史和设置，但 load/rollback 后必须正确关闭过期的 choice UI。
- 所有异步操作提供 busy 状态，防止重复 save/load/delete。

### 5.2 统一玩家菜单

菜单包含四个一级页面：

1. 存档/读档；
2. 历史；
3. 设置；
4. 系统。

系统页本期提供：

- 返回游戏；
- 重新开始，并要求确认；

不得把 Gallery 等尚未完成的入口做成不可用占位按钮。

### 5.3 存档/读档

默认 renderer V1 使用确定性的 12 个手动槽位：

```text
manual-01 ... manual-12
```

同时展示：

- `quick` 快速存档；
- `auto:node` 节点自动存档；
- `auto:choice` 选择后自动存档。

槽位显示：

- label；
- 更新时间；
- 当前 node/story point 的可读位置；
- `SavePreview.text`；
- `SavePreview.background` 可解析时的轻量背景预览。

行为：

- 空手动槽位执行保存。
- 非空手动槽位保存前要求覆盖确认。
- 所有非空槽位均可读取。
- 手动和 quick 槽位可删除；auto 槽位可读取，不在默认 UI 提供删除按钮。
- 读档 warning 和 persistence error 必须显示在菜单内，不能只写 `console.error`。
- 保存时由默认 renderer 传入当前文本和背景 id 作为 `SavePreview`，不保存二进制截图。

### 5.4 快存与快读

- HUD 和菜单都提供快存/快读。
- 快读不存在 `quick` 槽位时，显示稳定错误提示，不改变剧情状态。
- 快存完成后显示短暂状态提示。
- 快捷键作为次要入口：`F5` 快存、`F9` 快读；在输入框、range 控件或弹窗确认中不得触发。
- Web 中必须阻止 `F5` 的浏览器刷新默认行为。

### 5.5 历史、语音重播与回滚

历史页使用 `runtime.history.getBacklog()`，不得从对话框 DOM 反推内容。

每条历史显示：

- 说话人；
- 文本；
- 有语音时的重播按钮；
- 可恢复时的回滚按钮。

行为：

- 语音重播只播放该条 voice，不推进剧情。
- 回滚前要求确认；成功后关闭玩家菜单并回到舞台。
- 回滚失败必须保持菜单可用并显示错误。
- 历史为空时显示明确空状态。

### 5.6 Skip 与 Auto

- Auto、已读跳过、全文跳过是三个独立可见控制。
- 启用任一 skip mode 时自动关闭 auto。
- 启用 auto 时关闭 skip mode。
- UI 状态以 player 暴露的真实状态为准。
- 如果当前 contract 缺少 skip mode getter/状态订阅，应以最小兼容方式把 mode 放入 `NovelState.flags` 或正式 renderer-readable runtime state；不得只维护 renderer 本地猜测状态。

## 6. Runtime Settings 生效模型

### 6.1 有效设置

本期默认设置页暴露：

- master volume；
- BGM volume；
- SFX volume；
- voice volume；
- text speed；
- auto advance delay。

有效值优先级：

```text
persisted RuntimeSettingsRecord
  -> 缺省字段回退 content/meta.json
  -> 最后回退 contracts 默认值
```

虽然迁移兼容要求 `RuntimeSettingsRecord.textSpeedCps/autoAdvanceMs` 仍可缺省，但 host 交给默认 renderer 的 `getSettings()` 必须返回已经补齐的有效值。

### 6.2 Player 运行时覆盖

`GraphNovelPlayer` 需要新增窄的运行时计时覆盖能力，例如：

```ts
player.setPlaybackTiming({
  textSpeedCps,
  autoAdvanceMs,
});
```

具体命名可在实现时调整，但必须满足：

- 不修改项目 `content/meta.json`；
- 不重建整个 player；
- 不改变当前 node、vars、choice、backlog 或 story point；
- 文字速度更新对当前正在显示的文本最迟从下一次 typing tick 生效；
- auto delay 更新对当前尚未触发的 auto timer 生效；
- 非法值仍由 runtime settings schema 拒绝。

`runtime.settings.updateSettings()` 成功后必须同时：

1. 写入 persistence adapter；
2. 更新 AudioEngine 分轨音量；
3. 更新 GraphNovelPlayer 有效计时；
4. 通知 renderer 刷新当前值。

如果 persistence 写入失败，不得让 UI 显示为已保存；是否保留本次会话的临时应用值必须有明确测试并保持一致。

### 6.3 启动加载

Web runtime 启动流程必须先读取 persisted settings，再完成首个可交互 renderer mount。

要求：

- 首个 BGM/voice 使用持久化音量；
- 首行文本使用持久化文字速度；
- 首次 auto 使用持久化 auto delay；
- settings 记录损坏时按现有 structured migration/error 策略处理，不得静默写坏新记录；
- localStorage 不可用时使用默认/项目设置并暴露现有降级 warning。

Studio preview 使用相同有效设置与 player 更新逻辑，但 persistence 可继续是当前预览生命周期内的 in-memory adapter。

## 7. Auto Save 触发规则

`SaveService.autoSave()` 不能继续只有 API 而无调用者。

本期固定两个自动槽位：

- `auto:node`：进入新节点并到达该节点第一个稳定 story point 后保存；
- `auto:choice`：选择成功、路由完成并到达目标节点稳定 story point 后保存。

规则：

- 同 reason 覆盖旧 auto slot。
- player 初始 load 不在尚无稳定 story point 时写空存档。
- restore、rollback、debug jump 和 decision replay 不触发新的 auto save。
- auto save 失败不阻断剧情推进，但必须通过 renderer-readable transient status 或 host warning 被观察到。
- 同一稳定点不得因 state subscription/timer 重入重复写入。

实现可以使用 player lifecycle event 或 host-level checkpoint observer，但不得通过比较序列化后的整个 `NovelState` 猜测节点变化。

## 8. 默认 Renderer 源与目录约束

当前 canonical source 为：

```text
packages/studio/src-tauri/resources/default-renderer/
```

镜像为：

```text
packages/studio/templates/default-renderer/
examples/sample-novel/renderers/default/
```

本期允许新增：

```text
PlayerHud.tsx
PlayerMenu.tsx
SaveLoadPanel.tsx
HistoryPanel.tsx
RuntimeSettingsPanel.tsx
playerUiModel.ts
```

实际文件拆分可调整，但要求：

- canonical 和两个 mirror 文件列表、字节内容一致；
- renderer 只使用 runtime contract、React 和项目本地源码允许的 import；
- 不引入对 Studio 私有组件或 Tauri API 的依赖；
- UI 在 1280x720、1920x1080、960x540 和 1024x768 舞台尺寸下可用；
- 小尺寸下菜单内容可滚动，不能溢出舞台；
- 录制模式继续隐藏玩家 HUD 和帮助提示。

## 9. 错误、并发与可访问性

- save/load/delete/settings update 必须串行或显式拒绝重入。
- load/rollback 期间禁用推进、选择和其他恢复操作。
- 每个失败操作显示用户可读错误，同时保留结构化 error code 供测试。
- 覆盖、删除、重开和 rollback 使用确认步骤。
- 菜单按钮使用真实 `<button>`，range/input 使用关联 label。
- `Escape` 关闭最上层弹窗或菜单；存在未确认操作时不得直接穿透关闭全部层级。
- 焦点不得因舞台根节点点击推进而丢失。
- 弹层打开时背景舞台不可被鼠标或键盘推进。

## 10. Requirement-To-Test Matrix

实施必须先添加或更新下列测试，并确认缺失行为会正确失败，再改生产代码。

| ID | 需求 | 首选自动化验证 |
| --- | --- | --- |
| UX-01 | 默认 renderer 提供菜单、快存、快读、历史、auto/read-skip/all-skip 入口 | renderer static render + default renderer source build test |
| UX-02 | 菜单/弹窗交互不会推进剧情 | 真实浏览器点击菜单并断言 story point 不变 |
| SAVE-01 | 12 个手动槽位可保存、覆盖、读取和删除 | default renderer save controller test + browser smoke |
| SAVE-02 | quick save/load 使用固定 `quick` 槽位并处理缺失槽位 | runtime service test + renderer controller test |
| SAVE-03 | save preview 包含当前文本和背景 id | renderer save options unit test |
| SAVE-04 | load warning/error 在 UI 可见且失败不破坏当前状态 | renderer model test + web runtime restore test |
| AUTO-01 | 新节点稳定点写 `auto:node`，choice 后稳定点写 `auto:choice` | GraphNovelPlayer/host fake adapter test |
| AUTO-02 | restore/rollback/debug jump 不触发 auto save，重复 subscription 不重复写 | player lifecycle regression test |
| HIST-01 | 历史页展示真实 backlog，空历史有空状态 | renderer static/model test |
| HIST-02 | voice replay 不推进，rollback 恢复并关闭菜单 | engine regression + browser behavior test |
| SKIP-01 | read/all/off 与 auto 互斥且 UI 反映 player 真实状态 | player state test + renderer model test |
| SKIP-02 | read skip 在未读处停止，all skip 在 choice/pause 处停止 | 保留并扩展现有 GraphNovelPlayer tests |
| SET-01 | persisted settings 启动时在首次 mount 前加载 | Web runtime instance restart test |
| SET-02 | 音量更新持久化并立即影响 AudioEngine | runtime settings + AudioEngine spy test |
| SET-03 | text speed 更新影响 typing timer，不重置剧情状态 | GraphNovelPlayer fake timer test |
| SET-04 | auto delay 更新影响尚未触发的 auto timer | GraphNovelPlayer fake timer test |
| SET-05 | 设置 UI 展示有效值并串行处理保存失败 | renderer settings model test |
| PREVIEW-01 | Studio preview 中菜单可工作，但重建 preview 后不承诺正式持久存档 | Studio preview integration test |
| TEMPLATE-01 | canonical/template/sample renderer 文件列表和字节完全一致 | `pnpm run check:renderer-template` |
| EXPORT-01 | 导出游戏通过默认 UI 完成快存、推进、快读、历史打开和设置持久化 | real Chrome release smoke |
| COMPAT-01 | 自定义 contract v1 renderer 仍可只使用现有 controls/runtime，不要求默认 UI | renderer compile/contract tests |

不得用以下测试替代行为验证：

- 只检查源代码包含某个字符串；
- 只检查按钮文件名存在；
- 只检查 TypeScript 类型可以编译；
- 只直接调用 runtime service，而不验证默认 renderer 的公开操作路径。

## 11. 建议实施顺序

### Phase A — 设置生效与启动加载

1. 为 player runtime timing 添加失败测试。
2. 实现 text speed/auto delay 的有效值和 live update。
3. Web boot 读取 persisted settings 后再 mount。
4. 补 Studio preview 的同契约应用逻辑。

### Phase B — 默认 Renderer 菜单模型

1. 先实现无 React 依赖或低耦合的菜单状态、槽位映射和异步操作 controller。
2. 覆盖 busy、confirm、error、load warning 和状态同步测试。
3. 再实现 HUD、菜单、存档、历史和设置 React UI。

### Phase C — Auto Save 与真实状态同步

1. 增加明确 player lifecycle/checkpoint 事件测试。
2. 接入 `auto:node` / `auto:choice`。
3. 将 skip mode 暴露为 renderer 可读真实状态。

### Phase D — 导出行为验收

1. 同步 canonical/template/sample renderer。
2. 扩展 Web behavior probe，使用默认 UI 而不是直接调用 service。
3. 验证 reload 后 save/settings 仍存在。
4. 运行真实 Chrome smoke 和 macOS Tauri bundle；Windows 由 CI matrix 验证。

## 12. 完成定义

只有同时满足以下条件，本 spec 才能归档：

1. 新建项目默认 renderer 无需手改代码即可使用本期全部玩家控制。
2. Web 导出通过真实 UI 完成快存、推进、快读和设置持久化。
3. 历史、语音重播、rollback、read skip 和 all skip 有行为级测试。
4. text speed 和 auto delay 不再只是持久化字段，而是真正改变 player 行为。
5. auto save 有真实稳定触发点，不在 restore/replay 中误写。
6. 所有错误在 UI 可见，不依赖开发者控制台。
7. 默认 renderer 三份镜像无漂移。
8. TypeScript、Rust、CLI、release smoke 和本机可执行平台 bundle 验收通过。

## 13. 验证命令

实施完成后至少运行：

```bash
pnpm --filter @vibegal/engine test
pnpm --filter @vibegal/studio test
pnpm build
pnpm run check:renderer-template
pnpm run check:schemas
pnpm smoke:release

cargo fmt --check --manifest-path packages/studio/src-tauri/Cargo.toml
cargo check --locked --all-targets --manifest-path packages/studio/src-tauri/Cargo.toml
cargo test --locked --manifest-path packages/studio/src-tauri/Cargo.toml

pnpm tauri build
git diff --check
```

Windows bundle 和安装版 CLI/browser smoke 由 CI matrix 执行；本机必须完成当前平台的真实 Web 导出和浏览器行为验收。

## 14. 后续任务建议

完成本 spec 后，下一批建议创建：

```text
Spec 14 — Gallery Replay Music Room And Extended Asset Authoring
```

其范围包括：

- CG Gallery；
- 回想启动、退出和返回原游戏上下文；
- 音乐鉴赏的指定曲目播放控制；
- 结局列表；
- CG/video/font/uiSkin/animationAtlas/unlock registry 的完整资产和项目设置 UI。

Spec 14 依赖本 spec 提供的统一玩家菜单容器、错误处理和默认 renderer UI 基础。

## 15. 完成记录

- 2026-07-10：默认 renderer 增加 `player-ui-v1` 玩家 HUD 与统一菜单，覆盖快存/快读、手动存读删、历史、语音重播、rollback、auto、read/all skip、设置和系统重开。
- 2026-07-10：`GraphNovelPlayer` 支持运行时文字速度与 auto delay 覆盖；auto 与 skip 互斥，真实 `skipMode` 暴露到 `NovelState.flags`。
- 2026-07-10：Web runtime 在首屏挂载前读取持久化 settings，并将有效值同步到 player/audio；Studio preview 使用同一有效设置逻辑但保持会话内存级 persistence。
- 2026-07-10：接入稳定 checkpoint 自动存档槽 `auto:node` / `auto:choice`，并避免 restore、rollback、debug jump、重复订阅误写自动存档。
- 2026-07-10：默认 renderer canonical、template、sample 三份镜像同步；真实 Web 导出 smoke 通过默认 UI 验证快存、推进、快读、历史 rollback 和设置持久化。
- 2026-07-10：归档前已通过 `pnpm --filter @vibegal/engine test`、`pnpm --filter @vibegal/studio test`、`pnpm build`、`pnpm run check:renderer-template`、`pnpm run check:schemas`、`pnpm run check:doc-contract`、`pnpm smoke:release`、真实 Web build/smoke、`cargo fmt --check`、`cargo check --locked --all-targets`、`cargo test --locked`、`pnpm tauri build` 和 `git diff --check`。

这是一个交付单元；后续如继续扩展 Gallery、回想、音乐鉴赏或标题画面，应另开 spec，避免把本期默认玩家控制闭环继续扩张。
