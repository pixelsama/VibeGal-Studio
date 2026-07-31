# 34 Renderer 预览标识位（spec 33 §6.5）

## 1 问题

`packages/engine/src/renderer.ts:221-239` 的 `RendererProps` 没有任何字段能让界面风格（渲染层）知道自己运行在编辑器预览中。这不只影响 HUD——**任何「预览态应当收敛的 chrome」都没有表达手段**。属接口层缺口，非 UI 密度问题，spec 33 §6.5 留档建议单开本条。

## 2 环境差异二分法（本条的设计决议）

「预览 vs 真实游戏」的差异分两类，表达手段**必须分开**，防止把环境判断塞进渲染层：

| 类型 | 例子 | 表达手段 | 渲染层职责 |
|---|---|---|---|
| **能力型** | 退出游戏、存档、播放控制 | 宿主能力自带语义（runtime 服务在预览中降级/unavailable） | 无脑调用，零环境判断 |
| **呈现型** | 跳过入场动画、调试网格/热区可视化、远程资源占位 | `preview?: boolean` | 渲染层自行决策 |

能力型先例：spec 33 已定「Studio preview 必须提供完整字段，可用结构化 unavailable 表示未落地能力」——渲染层调用 `controls.quit()` / 存档服务时不需要知道自己在哪，**宿主注入行为**。

呈现型是宿主能力表达不了的：跳过动画、叠加调试信息是渲染层内部逻辑，只能由渲染层问环境。

## 3 变更（本轮施工范围）

### 3.1 engine 契约

`RendererProps` 增加可选字段：

```ts
/**
 * 是否运行在编辑器预览中（Studio 预览 / 场景 fixture / CLI 快照）。
 * 只用于**呈现型**差异（动画、调试信息、资源占位等渲染层内部决策）；
 * 能力型差异一律由宿主能力表达（runtime 服务降级），不得用本字段判断。
 * 缺省 undefined = 非预览（发布后的真实游戏）。
 */
preview?: boolean;
```

- 可选字段，现有渲染层（含 bundled default renderer）零破坏
- `rendererPublic.ts` 已 re-export `renderer.ts`，自动进入 `.galstudio/types/engine.d.ts` 生成入口

### 3.2 Studio 侧传递（三处构造 `RendererProps` 的点都传 `preview: true`）

| 位置 | 场景 |
|---|---|
| `packages/studio/src/features/preview/useProjectPlayer.ts:68` `createProjectRendererProps` | 预览工作台（真实剧情预览） |
| `packages/studio/src/features/preview/SceneFixtureView.tsx:161` | 外观工作区场景宫格 / 单场景设计面 / 场景 scrubber |
| `packages/studio/src/export/snapshotHost.ts:209` | CLI 快照（`vibegal-cli renderer-snapshot`） |

### 3.3 语义指引（写入 renderer.ts 注释，渲染层遵守）

`preview: true` 时渲染层**可以**收敛：入场动画、调试信息/热区可视化、远程资源替换为本地占位。

**不得**收敛：玩家控制（HUD/菜单——预览需要真实操作测试）、外观 token 可视化（外观工作区调整 `hud` 等组 token 依赖预览中看到真实 chrome）。

### 3.4 契约生成与漂移检查

- `node packages/studio/scripts/generate-engine-types.mjs` 重新生成 engine.d.ts
- `pnpm check:engine-types` 漂移检查
- `engine-types.test.mjs`（fixture 项目 + bundled default renderer 必须 typecheck）

### 3.5 bundled default renderer

**零行为变化**。理由：
- HUD 不能收敛（外观工作区 `hud` 组 token 编辑依赖预览中看到 HUD；预览需要真实玩家操作测试）
- default renderer 的收敛需求已被现有机制覆盖：`state.flags.isRecording`（录屏收敛，Stage.tsx:71）、`hud.visible` token、`uiHint.panel` fixture 场景
- 任何「预览下自动隐藏 X」的默认行为都会与外观工作区 / CLI 快照的「真实画面」预期冲突

## 4 后续 backlog：游戏退出能力（本轮不做，独立一轮）

退出按钮是 preview flag 的教科书级「能力型」用例——**它不靠 flag 判断环境，靠宿主能力注入行为**：

1. `RuntimeControls.quit()` 新方法（`renderer.ts:46-54` 现有：advance/choose/submitName/setAutoPlay/setSkipMode/rollbackTo/restart）
2. 宿主实现：
   - 真实游戏（桌面）：关闭应用窗口（Tauri）
   - 真实游戏（web）：无操作或提示（关标签页语义，待定产品形态）
   - Studio 预览：no-op + toast「预览中无法退出」（能力在，行为降级）
   - CLI 快照：no-op
3. 渲染层：TitleScreen / PlayerMenu 加「退出游戏」按钮，**只调 `controls.quit()`，零 preview 分支**
4. 待定产品语义：桌面版退出是否需确认框、web 版是否提供退出入口

现状核实（2026-07-31）：default renderer 标题画面只有「开始游戏」（`data-title-action="start"`）、菜单只有关闭按钮，**无退出按钮**；`RuntimeControls` 无 quit 能力——发布后的游戏目前只能靠系统级关闭（Alt+F4/窗口红绿灯）。

## 5 不做的事

- 不给 default renderer 加任何预览收敛行为（见 3.5）
- 退出能力（§4）不在本轮
- 不引入「环境枚举」（`environment: "studio" | "runtime"`）——布尔字段够用，缺省即非预览

## 6 验证

- engine 类型测试：`preview` 字段存在且可选（缺省渲染层可编译）
- 三处传递断言：`createProjectRendererProps` / `SceneFixtureView` / `snapshotHost` 构造的 props 含 `preview: true`
- `generate-engine-types.mjs` + `check:engine-types` 通过
- `tsc -b` / `pnpm test` / `check:vocabulary` / `qa:agent:quick` 全绿
