# Spec 21 — Title Screen（标题画面 / 游戏主界面）

> 状态：已实施并归档（2026-07-20 当天定点、实施、全量验证通过；实施记录与偏差见第 11 节）。
> 目标：让默认渲染层拥有一个数据可塑、被 Studio 预览/截图/外观编辑完整覆盖的标题画面（开始 / 继续 / 读档 / 设置），同时守住数据优先、渲染器自由、No In-App AI 三条产品边界；engine 与 renderer 契约 v1 不变。

## 1. 背景与动机

标题画面是 galgame 的标准部件，但当前四层都没有它：

- **引擎**：`NovelState` 无任何标题/场景类型字段；`loadGraph` 后播放器直接停在 `graph.entryNodeId` 第 0 条指令等 advance（`packages/engine/src/graphPlayer.ts:97,115`），没有"故事开始前"阶段或 startup 钩子。
- **契约**：15 种指令（`packages/contracts/src/schema.ts:126-142`）无 menu/title 类；`ManifestSchema` 与 `MetaSchema` 均无标题画面配置位（`meta.title` 仅是窗口标题字符串）。
- **默认渲染层**：`Stage` 挂载后直接渲染背景+立绘+对话框（`packages/studio/templates/default-renderer/Stage.tsx:393-397`）；`PlayerMenu` 是游戏内覆盖菜单，不是标题画面。
- **历史定位**：归档 spec 01（:29,255）、13（:75,456）、15（:51）、17（:87）均把标题画面列为范围外或"另开 spec"；spec 02（:37-45）指明 renderer 可自行实现并调用 runtime API。本 spec 即 13/17 预留的"另开 spec"。

2026-07-20 的代码核查确认了两件事：

1. **渲染层单边即可实现完整标题画面**：`runtime.save.listSlots/load`（`packages/engine/src/renderer.ts:67-75`）、`controls.advance/restart`、uiSkins token 存取通道（`save_manifest` 对 token key 无白名单，`appearanceTokens.ts:45-61,82-95`；contracts 侧 `UiSkinSchema.tokens` 为开放 record，`schema.ts:202-206`）全部现成，engine 与 contracts 均无需改动。
2. **两个宿主面会被标题门卡住**，需要 Studio 小改：
   - **fixture 宿主**：场景刷与 CLI snapshot 是静态挂载、假设渲染层立即呈现给定 state（`SceneFixtureView.tsx:74-81,102-116`；`snapshotHost.ts:199-219`）。4 个剧情场景不带任何 uiHint，宿主会删除 `window.__VIBEGAL_FIXTURE_UI__`（`snapshotHost.ts:193-195`），渲染层今天无法区分"剧情 fixture"与"真实开局"——加标题门后 11 个内置场景 + 项目自定义 fixture 的截图/预览/外观宫格全部停在标题页。
   - **导出 UI smoke**：`?vibegalSmoke=1` 时 `runWebRuntimeUiBehaviorSmoke` 硬编码"点舞台立即推进剧情"（`webRuntimeHost.ts:528-545`），标题门会让第一阶段超时失败（web 与桌面同路，`build-desktop-export.mjs:264`）。

## 2. 产品边界

- **引擎不做"故事前阶段"**：标题画面是渲染层内部 UI 状态，不是引擎场景类型、不是指令、不是 graph 概念。守住 spec 01/02 的架构定位，renderer 契约 v1 不变，`rendererPublic.ts` 与 `.galstudio/types/engine.d.ts` 不增字段。
- **数据优先**：标题画面外观走既有 `manifest.uiSkins` 的 `tokens`/`assets` 槽位，Studio 编辑的是项目数据文件，不是渲染器源码。
- **渲染器自由**：uiHint 扩展与 smoke 选择器都是渲染层**可选择消费**的约定，第三方渲染层可忽略；不消费时 Studio 优雅退化（标题页场景截图即渲染层真实输出）。
- **No In-App AI 不变**。
- **场景单源**：标题页场景加入 `packages/studio/src/export/snapshotScenes.ts` 单源，Studio 场景刷、CLI `renderer-snapshot`、外观宫格共用。

## 3. 方案概述（三步，可独立交付）

1. **默认渲染层标题画面（renderer-only）**：`Stage` 增加标题门内部状态，挂载先渲染 `TitleScreen` 组件（开始游戏 / 继续游戏 / 读取存档 / 设置），进入故事后不再出现。部件根元素 `data-ui-part="titleScreen"`，几何完全由 `titleScreen.*` token 驱动——外观工作区的 DOM 扫描与未知部件几何兜底（`appearanceTokens.ts:256-274`）使拖拽、几何编辑零改动可用。
2. **uiHint 扩展 + 标题页 fixture 场景（Studio 小改）**：`FixtureUiHint` 增加可选 `screen` 字段；内置场景目录新增第 12 个场景"标题画面"；4 个剧情场景注入 story 语义 hint，保证任何 fixture 挂载都不会卡在标题页。透传层（`snapshotHost.ts`、`SceneFixtureView.tsx`、`Preview.tsx`、`AppearanceWorkspace.tsx`）不改，改动集中在 `snapshotScenes.ts` 与渲染层 `playerUiModel.ts`。自定义 fixture 的 `screen` 声明本期同步做（contracts 扩展，第 4 节）。
3. **smoke 契约更新（Studio 小改）**：UI smoke 第一阶段改为先断言标题页出现、点击"开始游戏"按钮再进入剧情断言——标题门从"smoke 的破坏者"变成"smoke 的被测路径"。

配套收尾（随各步合入）：三份 default-renderer 镜像同步（`scripts/check-default-renderer-drift.mjs` 强制 `src-tauri/resources/default-renderer` = `templates/default-renderer` = `examples/sample-novel/renderers/default`）；Studio 侧直接挂载默认渲染层的测试（`defaultRendererPlayerUi.test.tsx`、`defaultRendererUiTokens.test.tsx`）注入 uiHint 或更新断言。

## 4. uiHint 扩展（已定点）

形状扩展：

```text
FixtureUiHint = { panel?: FixtureUiPanel; screen?: "title" | "story" }
```

语义（渲染层在挂载初始化期读一次，沿用现状 `Stage.tsx:43` → `playerUiModel.ts:57-64`）：

| uiHint 内容 | 渲染层行为 |
|---|---|
| 全局不存在 | 真实启动：显示标题画面 |
| `{ screen: "title" }` | 显示标题画面（fixture 预览标题页） |
| `{ screen: "story" }` 或携带 `panel` | 跳过标题门，直接呈现给定 state（`panel` 同时预开对应面板，现状语义不变） |

定点理由：

- `panel` 语义即"剧情中某面板"，天然蕴含 story；7 个面板场景无需改 shape。
- 4 个剧情场景当前不带 uiHint（宿主删全局），与"真实启动"无法区分——所以由 `snapshotScenes.ts` 为它们注入 `{ screen: "story" }`，这是本方案唯一的 Studio 侧必须改动。
- `screen` 为可选字段，旧 fixture 与旧渲染层双向兼容：旧渲染层不读 `screen`，行为同现状；旧 fixture 在新渲染层上按上表退化。

自定义 fixture 的 `screen` 声明（已定点，本期做）：contracts `FixtureUiHintSchema`（`packages/contracts/src/fixtures.ts:122-124`）同步增加可选 `screen` 字段（`z.enum(["title", "story"])`），并再生成 `.galstudio/schemas/fixture.json`（Studio 模板与示例项目 `.galstudio/schemas/` 同步分发），让项目自定义 fixture 也能预览标题页。实施时确认 Rust 侧 fixture 校验是否镜像该 schema，若镜像则同步更新并跑 Rust 测试。

## 5. 标题页 fixture 场景与渲染层改造点

**场景目录**：`snapshotScenes.ts` 新增内置场景"标题画面"（`uiHint: { screen: "title" }`，state 给最小背景/空对话即可），使标题页进入场景刷、宫格视图与 CLI snapshot 的固定参照——用户与外部 Agent 看同一组画面。

**渲染层改造点**（`templates/default-renderer/` 及两份镜像）：

- 新增 `TitleScreen` 组件：标题文本（取 `manifest.name`，缺失回退项目通用默认文案）、菜单按钮（开始游戏 / 继续游戏 / 读取存档 / 设置）；
- **继续游戏（已定点）**：取 `runtime.save.listSlots()` 中 `updatedAt` 最新的槽位直进（**含 auto/quick 槽**——auto 槽按节点持续写，最新槽即"上次玩到的位置"）；按钮副标题显示该槽时间与 label；无存档时禁用；
- **读取存档**：打开现有 `SaveLoadPanel`（load 模式）；**设置**：打开现有设置面板；无存档时"继续/读档"禁用；
- **回到标题（已定点最小版）**：`SystemPanel` 增加"回到标题"按钮——渲染层内部切回标题屏，不 reset player，点"开始游戏"再继续；结局后自动回标题本期不做；`restart`（从头开始）维持"直进故事"语义不变；
- 标题门状态机：挂载读 uiHint（第 4 节表）决定初始屏；`controls.advance()` 进入故事；标题状态为组件内 React state，不进 `NovelState`；
- 键盘：标题页在 capture 阶段拦截 Space/Enter（与 `Stage.tsx:331-369` 现状一致），避免与宿主 bubble 阶段的全局 advance（`webRuntimeHost.ts:955-959`）冲突；
- token 消费：新增 `titleScreen.*` key（第 6 节），缺失回退内置默认值；根元素 `data-ui-part="titleScreen"`，位置尺寸完全由几何 token 决定；
- 按钮带 `data-title-action="start|continue|load|settings"`（smoke 契约与第三方宿主共用）；
- capability 不新增：`layout-parts-v1` 已覆盖拖拽发现；`player-ui-v1` 语义不变。

## 6. token 协议扩充与资产约定（已定点）

沿用 spec 17 的分层点号约定，值限定 `string | number`：

```text
titleScreen.x / .y / .width / .height        标题页容器几何（舞台坐标 px，可拖拽）
titleScreen.bgColor / .bgOpacity             无标题美术时的底色
titleScreen.titleColor / .titleFontSize / .titleFontFamily
titleScreen.buttonBgColor / .buttonTextColor / .buttonHoverColor
titleScreen.buttonRadius / .buttonFontSize
```

约定与 spec 17 一致：全部可选、缺失回退现状视觉、颜色为 CSS 字符串、key 与 `data-ui-part` 对应。

**标题美术与 BGM 的资产约定（已定点）**：采用 uiSkin `assets` 槽位约定键——`titleBackground` / `titleBgm`，value 为 manifest 注册表（`backgrounds` / `audio`）中的**资产 id**，渲染层解析 id → 路径 → `contentBase` 加载；`titleBackground` 缺失时回退 `titleScreen.bgColor` 底色，`titleBgm` 缺失时无标题 BGM（进入故事后由剧情 `bgm` 指令接管）。语义为"skin assets = 语义槽位 → 项目资产 id 的绑定表"，后续可复用于对话框贴图等；该约定写进 renderer-contract 文档。

## 7. Studio 改动清单

| 改动 | 文件 | 说明 |
|---|---|---|
| uiHint shape + 剧情场景注入 + 新场景 | `src/export/snapshotScenes.ts` | `FixtureUiHint` 加 `screen`；4 剧情场景注 `{ screen: "story" }`；新增"标题画面"场景 |
| 自定义 fixture 的 screen 声明 | `packages/contracts/src/fixtures.ts`、`.galstudio/schemas/fixture.json`（模板 + 示例项目） | `FixtureUiHintSchema` 加可选 `screen`；再生成 schema；确认 Rust 侧镜像 |
| 渲染层读 hint | `templates/default-renderer/playerUiModel.ts`（及镜像） | 按第 4 节表读取 |
| UI smoke 第一阶段 | `src/export/webRuntimeHost.ts:525-634` | 先断言 `[data-title-action="start"]` 出现并点击，再做 stage-click 推进断言；web/桌面同路 |
| 外观面板分组 | `src/features/appearance/appearanceTokens.ts:148-231,241-247` | 补 titleScreen 非几何 token 分组（含 stage 级以外的部件注册） |
| 测试 | `src/export/defaultRenderer*.test.tsx` 等 | 挂载时注入 `{ screen: "story" }` 或按新初始屏更新断言；新增标题页场景/smoke/hint 读取/继续游戏策略的用例 |
| 镜像同步 | 三份 default-renderer 目录 | `pnpm check:renderer-template` 必须绿 |

明确不改：engine（`graphPlayer`/`renderer.ts`）、`rendererPublic.ts` 与 engine.d.ts、`prepare-web-exporter.mjs`（无新 exporter 脚本）、contracts 除第 4 节定点扩展外的部分。透传层中 `snapshotHost.ts`/`Preview.tsx`/`AppearanceWorkspace.tsx` 不改；`SceneFixtureView.tsx` 实施时确认为必要例外（见第 11 节）。

## 8. 测试与验收

- 渲染层：uiHint 四种取值分别呈现标题/故事（含 panel 预开回归）；token 缺失时与内置默认视觉一致；无存档时"继续/读档"禁用；"继续游戏"取 `updatedAt` 最新槽（含 auto/quick）；"回到标题"切回标题屏且不 reset player；
- Studio：`renderer-snapshot` 对 12 个内置场景出图，剧情场景不再卡标题页，标题页场景呈现标题画面；场景刷与外观宫格同；自定义 fixture 声明 `uiHint.screen` 可过校验；
- 导出：`?vibegalSmoke=1` web 与桌面均绿，且 smoke 覆盖"标题 → 开始 → 剧情推进"完整路径；
- 回归：`pnpm check:renderer-template`、`pnpm check:engine-types`、Rust 测试不动仍绿；
- TDD：uiHint 扩展、smoke 契约、渲染层标题门均先写失败测试。

## 9. 已排除的备选方案

- **引擎侧"故事前场景类型"**：违背 spec 01/02 的架构定位（标题属于 renderer 职责），且要动契约版本、graph schema、播放器生命周期，代价远大于收益。
- **graph 节点伪标题页**（入口节点 bg+bgm + 自循环 choice）：无需任何代码、今天可用，但选项只能走对话式 choiceBox 样式、无法访问 `runtime.save` 做"继续/读档"，且占用剧情入口节点。保留为文档中的无代码 workaround，不作为产品方案。
- **manifest 顶层 `titleScreen` 配置块**（数据驱动菜单项/标题文案）：本期渲染层 + tokens 已够；若"项目级自定义菜单项"成为强需求再开 spec 评审。

## 10. 定点记录（2026-07-20 全部定点）

- 标题美术/BGM 资产约定：**uiSkin `assets` 槽位约定键 `titleBackground`/`titleBgm`，value 为 manifest 注册表资产 id**（第 6 节）；
- "继续游戏"的存档选择策略：**最新 `updatedAt` 槽直进（含 auto/quick），读档走 `SaveLoadPanel`**（第 5 节）；
- "回到标题"入口：**本期只做 `SystemPanel` 按钮最小版**；结局后自动回标题不做，结局行为维持现状；标题门在启动与"回到标题"时出现（第 5 节）；
- 项目自定义 fixture 的 `screen` 声明：**本期做**，contracts `FixtureUiHintSchema` 扩展 + schema 再生成（第 4 节）。

## 11. 实施记录（2026-07-20）

**交付**

- contracts：`FixtureUiHintSchema` 扩为 `{ panel?, screen? }`（refine 至少其一），新增 `FIXTURE_UI_SCREENS` 等导出；生成物再生成（`fixture.schema.json`、contract-manifest、docs 镜像），`check:schemas` 通过；
- `snapshotScenes.ts`：内置场景 11 → 12（4 剧情场景注 `{ screen: "story" }`，新增 `title` 场景）；自定义 fixture 校验支持 `screen`；
- 默认渲染层（三份镜像字节一致，漂移检查 17 文件通过）：`playerUiModel.ts` 新增 `readFixtureUiHintScreen()`/`pickContinueSlot()`/`formatSlotTime()`；`useUiTokens.ts` 新增 `TitleScreenTokens`（含默认值与 null 默认提示登记）与 `resolveUiSkinAssets()`；新组件 `TitleScreen.tsx`（`data-ui-part="titleScreen"` 全几何 token 驱动、四按钮 `data-title-action`、无存档禁用态、可选全舞台标题背景图）；`Stage.tsx` 标题门（`screen` state、`hasEnteredStoryRef`、标题 BGM 循环与进故事停止、键盘/点击门控、`data-player-screen`/`data-player-blocking`、PlayerMenu 两屏共享）；`PlayerMenu.tsx` SystemPanel 新增「回到标题」（`data-system-action="return-to-title"`）；
- 外观模块：`titleScreen`（9 字段）与 `titleScreenButton`（5 字段）两个 token 组注册进外观工作区；
- 导出 smoke：两阶段均先点「开始游戏」并等标题关闭，再等首行 `fullyRevealed` 作为打字机稳定基准；
- 文档：`docs/renderer-contract.md` 新增本 spec 章节（token、uiHint 语义、资产约定、`data-title-action`、快照场景清单），同步示例项目 `.galstudio/`；示例 fixture `dawn-reunion.json` 补 `{ screen: "story" }`。

**验证（全部通过）**

- `pnpm -r test`（contracts 36 + engine 108 + studio vitest 679/75 文件 + node 脚本测试）；
- `check:renderer-template` / `check:engine-types` / `check:schemas` / `check:doc-contract` / `check:versions`；
- `pnpm -r build`（tsc + vite）；`cargo test`（src-tauri，282 项）；
- CLI `renderer-snapshot` 真实 Chrome 13/13 场景出图，标题屏目检符合设计（磨砂面板、禁用态按钮）；
- web 导出 + `smoke --target web`、桌面导出 + `smoke --target desktop --runtime electron`（Electron 43.1.1）均绿，覆盖"标题 → 开始 → 剧情 → HUD/存档/历史"全链路。

**与 spec 的偏差**

- `SceneFixtureView.tsx`（第 3 节称"透传层不改"）：实施时确认必须在渲染体内自注入 `scene.uiHint`（首挂载 stash、scene 切换覆写、卸载恢复）——外观宫格同时挂载 12 个场景且全局被删除，不注入则每张宫格卡都停在标题门，违反第 8 节验收。`Preview.tsx`/`AppearanceWorkspace.tsx` 的既有注入保留为无害冗余。

**遗留备注（非本 spec 范围）**

- 桌面导出排查发现一个仓库级坑：`vibegal-cli build --target desktop` 只设 `VIBEGAL_DESKTOP_WORKER` 而未设 `VIBEGAL_EXPORT_WORKER` 时，CLI 会按候选顺序命中 `target/debug/exporter/` 的旧副本，打进过时的 Web 载荷。建议另开 issue 审视分发脚本的 worker 解析顺序。
