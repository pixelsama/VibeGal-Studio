# Spec 17 — Appearance Design Module（外观设计模块）

> 状态：已记录，暂缓开发（2026-07-18 第三次修订：场景扩充机制、skin 选择规则、自定义 fixtures 路径与格式定点，宫格并入步骤 3，待排期）。
> 目标：为"渲染器外观设计"提供交互式编辑能力，替代纯提示词 + 预览的 vibe 设计流程，同时不破坏数据优先、渲染器自由、No In-App AI 三条产品边界。

## 1. 背景与动机

当前项目渲染器（`renderers/<id>/index.tsx`）的外观几乎全部由外部 Agent 通过提示词生成 TSX 代码，再在 Studio 预览中查看效果。实测痛点：

- 微调成本高：改一个对话框圆角、透明度、位置都要一轮"提示词 → 生成 → 预览"；
- 不可视：无法直接在舞台上看着效果拖、拉、调色；
- 设计决策都埋在代码里，没有一份可 diff、可校验的"外观数据"。

2026-07 针对"能否嵌入开源设计工具"做了一轮调研，结论：**不嵌入任何现成项目，候选方案是自研 Token 化 + 外观面板（本文第 3 节）**。调研对象与排除理由见第 8 节。

### 1.1 2026-07-18 修订背景：Agent 闭环已落地，差距重新定位

自初稿以来，渲染层的 Agent 反馈闭环已经实现并合入：

- 项目内类型环境（`.galstudio/types/engine.d.ts` + react shim + tsconfig），Agent 可在项目目录自跑 `tsc --noEmit`；
- `vibegal-cli renderer-check`：静态契约检查 + 经 bundled worker 的真实编译/类型检查；
- `vibegal-cli renderer-snapshot`：把渲染层无头挂载到内置场景（对话/旁白/选项/多立绘，见 `packages/studio/src/export/snapshotScenes.ts`）并用 headless Chrome/Edge 输出 PNG 截图。

这使"外部 Agent 出图"的效率显著提升（原触发条件之一被部分触发），但也把差距定位得更清楚：

- **Studio 预览仍是剧情驱动**：要看选项/多立绘等界面状态必须把剧情播到对应位置，没有设计视角的"跳到任意 UI 状态"；
- **人与 Agent 看的不是同一组画面**：Agent 看 snapshot fixtures，用户看剧情播放，沟通效果时缺少共同参照；
- 微调成本与"外观数据缺失"两条原痛点不受闭环影响，依旧成立。

因此修订后的判断是：**Agent 效率提升不替代设计面板，但设计要求前置一块"场景刷"基建**；同时把用户强需求的舞台拖拽从可选升级转为正式步骤（第 3 节、第 7 节）。

## 2. 产品边界

本方案必须守住：

- **数据优先**：Studio 编辑的是项目数据文件（manifest / uiSkins / fixtures），不是渲染器源码；外观面板本质是一个针对外观契约的结构化编辑器，与 graph 编辑器同性质。
- **渲染器自由**：token 协议、`data-ui-part` 部件标注、uiHint 通道都是渲染器**可选择消费**的约定，不是强制 UI 框架。默认渲染器消费它们作为参考实现；第三方渲染器可以忽略、部分消费、或定义自己的扩展 key；不消费时 Studio 对应能力优雅退化为提示态。
- **No In-App AI 不变**：外观面板与拖拽是纯交互 UI，不引入任何 AI 按钮、agent 会话、模型设置。
- **Agent 友好不变**：外观数据与自定义 fixtures 都落地为 JSON，外部 Agent 与 Studio 读写同一份文件，走既有 revision 冲突检测。
- **场景单源**：Studio 场景刷、CLI `renderer-snapshot`、项目自定义 fixtures 必须共用同一份场景来源（内置 fixtures 为 `packages/studio/src/export/snapshotScenes.ts`；自定义 fixtures 为项目内 `content/fixtures/*.json`），不允许各自维护场景定义而漂移。

## 3. 方案概述（路径 A：场景刷 + Token 化 + 面板 + 拖拽 + 自定义 fixtures）

五个递进步骤，可独立交付：

1. **场景刷（fixture 场景预览）**：Studio 预览面板增加场景切换，把当前渲染层挂载到固定场景（对话/旁白/选项/多立绘）而非只能播放剧情。内置 fixtures 唯一来源是 `packages/studio/src/export/snapshotScenes.ts`（与 CLI `renderer-snapshot` 共用），runtime 复用 `createInMemoryRuntimeServices` 挂载，热重载链路不变。价值：设计视角的即时预览，且**用户与外部 Agent 看到同一组场景**。内置场景目录扩充（面板类场景）机制见第 4.1 节。
2. **Token 协议 + 默认渲染器改造**：定义有文档、有默认值的 design token，落在既有 `manifest.uiSkins` 的 `tokens` 槽位（`packages/contracts/src/schema.ts` 已定义 `uiSkins: { name?, assets, tokens?: Record<string, string|number> }`，schema 与 Rust 校验均已就绪，目前无消费者）；**几何 token 先行**（步骤 4 的拖拽依赖几何语义）。默认渲染器（`packages/studio/templates/default-renderer/` 及其同构镜像）把对话框、名字框、选项按钮、HUD 等硬编码样式值改为读取 token，缺失时回退现状值（旧项目像素级不变），并给部件根元素加 `data-ui-part` 标注（第 7 节）。
3. **Studio 外观面板**：第 5 个 workspace tab（渲染 / 脚本 / 资产 / 项目 / 外观；接入点 `src/lib/navigation.ts` 与 `src/Workspace.tsx`，仿照 assets tab），左侧属性分组编辑 token（颜色/数值/字体/几何），右侧为第 1 步的场景刷，**自带宫格视图**（改 token → 全部场景同屏刷新，一眼看全）；持久化走 `save_manifest`（带 revision）。
4. **舞台拖拽 overlay**（正式步骤，机制见第 7 节）：设计模式下在 StageFrame 上叠加拖拽层，对声明 `data-ui-part` 的几何部件做移动/缩放，写回几何 token。
5. **项目自定义 fixtures**：`content/fixtures/*.json`（格式见第 4.2 节），作为"设计意图即数据"：Agent 先声明每个界面的目标状态，渲染层照它实现；Studio 场景刷与 CLI snapshot 单源读取。配套 `fixture.schema.json` 进入 `.galstudio/schemas/`。实施时确认项目 loader 对 `content/` 下该新目录不产生误报（`chapters/` 是被单独点名的遗留目录，其它未知目录应天然忽略）。

后续可选升级（单独评估）：

- 多渲染层并排对比（变体选择 UX；当"Agent 生成多个候选渲染层再挑选"成为高频工作流时再做）；
- 多 uiSkin 预设与一键切换（token 生态验证后再说）；
- bottom 锚定等更丰富的几何锚点语义（见第 4 节未决项）；
- token 协议与 `data-ui-part` 约定向第三方渲染器推广的文档化（默认渲染层消费稳定后再做，排在最后）。

## 4. Token 协议草案

命名建议采用分层点号 key，值限定为 `string | number`（受现有 schema 约束）：

```text
dialogueBox.x / .y / .width / .height      舞台坐标系内几何（px）
dialogueBox.bgColor / .bgOpacity / .radius / .padding / .borderColor
dialogueBox.textColor / .fontSize / .fontFamily / .lineHeight
nameBox.x / .y / .width / .height
nameBox.bgColor / .textColor / .fontSize / .visible
choiceButton.bgColor / .textColor / .hoverColor / .radius / .fontSize
hud.textColor / .bgColor / .fontSize / .visible
stage.fontFamily                           全局字体（可引用 manifest.fonts 的 family）
```

约定：

- 所有 key 可选；渲染器对缺失 key 使用内置默认值（即当前视觉）；
- **几何语义（已定点）**：坐标原点为**舞台左上角**，`x`/`y` 为**部件左上角**在舞台坐标系中的位置，`width`/`height` 为部件尺寸，单位均为舞台坐标 px；坐标系即 `content/meta.json` 的 `stage`，与渲染器契约的 stage 约定一致；
- **skin 选择规则（已定点）**：渲染器消费 id 为 `"default"` 的 uiSkin；注册表无 `"default"` 时回退到第一个条目并给出 warn 级提示。不依赖 JSON 遍历序作为首选语义，Agent 可预测；
- 颜色值为 CSS 颜色字符串，由渲染器自行解析；
- 协议以默认渲染器实际消费的 key 为准，在本文档与 renderer-contract 文档中同步维护；
- token key 与 `data-ui-part` 值一一对应（`dialogueBox.x` ↔ `data-ui-part="dialogueBox"`）。

**未决项（实施后评估）**：是否需要 bottom 锚定（如对话框贴底边、随舞台高度自适应）。舞台尺寸是项目级常量，该需求只在渲染层跨舞台尺寸移植时才真实出现；V1 只做左上角语义（任何未来锚点方案的真子集，向后兼容），倾向的方向是渲染器声明锚点（如 `data-ui-anchor`）、数据只存偏移量，届时再评审。

### 4.1 面板类场景扩充机制（已定点）

场景目录从 4 个剧情场景扩到面板类界面：**存档面板、历史面板、设置面板、Gallery 四页（CG/replay/music/endings）**。默认渲染层没有独立"主菜单"概念（故事直接开始，菜单即覆盖层），不做标题页场景。

可行性拆解：

- **数据侧**：面板依赖的 unlock 状态与存档数据全部走 `persistent`/`gallery`/`save` runtime 服务，fixture 注入瘦身快照即可（格式见第 4.2 节），`createInMemoryRuntimeServices` 已有 `initialGlobalPersistent` 通道；
- **可见性侧**：面板开合是渲染层内部 React state，不在 `NovelState` 里。为此引入 **uiHint 通道**（渲染层可选消费，契约不变）：宿主在挂载前设置 `window.__VIBEGAL_FIXTURE_UI__ = { panel: "<id>" }`，渲染层把它当作初始 UI 状态读取。沿用仓库既有先例（`__VIBEGAL_SELECTED_RENDERER_ID__`），Studio 场景刷与 CLI snapshot 同一宿主逻辑，第三方渲染层自愿跟进。

### 4.2 自定义 fixtures 格式（已定点）

`content/fixtures/*.json`，每个文件一个场景：

```json
{
  "title": "第一章高潮对话",
  "state": { "...": "NovelState 字段（必需）" },
  "persistent": {
    "unlock": { "cg": ["smoke_ocean"], "music": [], "replay": [], "endings": [] }
  },
  "uiHint": { "panel": "gallery" }
}
```

- `state` 必需，为 NovelState 快照；`title`、`persistent`、`uiHint` 可选；
- `persistent.unlock` 是**瘦身形**（不照搬 `GlobalPersistentRecord` 全形，作者与 Agent 都更好写），宿主负责映射进 `initialGlobalPersistent`；后续可按需扩展存档槽位等字段；
- `uiHint` 透传到第 4.1 节的全局通道；
- 校验：`fixture.schema.json` 随 `.galstudio/schemas/` 分发，CLI validate 与 Studio 共用。

## 5. 默认渲染器改造点

- 新增 `useUiTokens(manifest)` 之类的 hook：按第 4 节 skin 选择规则取 skin，把 token map 解析为带默认值的结构化对象；
- `DialogueBox.tsx`、`Stage.tsx` 内的名字框/选项按钮/HUD 等硬编码 inline style 值替换为 token 读取；
- 可拖拽部件的根元素加 `data-ui-part="<partName>"`，且该部件的位置与尺寸必须完全由几何 token 决定（绝对定位），否则不得声明；
- 面板组件读取 `window.__VIBEGAL_FIXTURE_UI__` 作为初始 UI 状态（无该全局时行为与现状一致）；
- `index.tsx` 的 manifest 增加 `layout-parts-v1` capability 声明（见第 7 节）；
- token 缺失时输出必须与改造前像素级一致（回退值即现状值）。

## 6. Studio 外观面板

- 位置：第 5 个 workspace tab（渲染 / 脚本 / 资产 / 项目 / 外观），复用既有 `.gs-*` 样式与 CSS 变量主题；
- 布局：左侧属性分组（对话框 / 名字框 / 选项 / HUD / 字体），右侧为第 1 步的场景刷预览（单场景切换 + **宫格同屏**）；修改 token → `save_manifest`（带 revision）→ watcher/刷新链路触发预览更新；
- 控件：颜色选择、数值滑杆、字体下拉（候选来自 `manifest.fonts`）、几何数值输入；
- 空态：项目无 `uiSkins` 时提供"启用外观编辑"按钮，写入一个带注释性 name 的空 skin，不覆盖任何现有文件。

## 7. 舞台拖拽 overlay（机制约定）

拖拽是 token 协议的舞台侧交互，与渲染器完全解耦：

**渲染器侧（可选约定，capability 探测）**

- `RendererManifest.capabilities` 声明 `layout-parts-v1` 表示本渲染层支持 Studio 舞台拖拽；
- 可拖拽部件满足两条：① 位置/尺寸完全由几何 token 驱动（舞台坐标系绝对定位，缺失回退默认值）；② 部件根元素带 `data-ui-part="<partName>"`，与 token key 一一对应。

**Studio 侧**

- 设计模式下在 StageFrame 上盖透明 overlay，按 `[data-ui-part]` 在舞台 DOM 中定位部件，绘制选框与缩放手柄；
- 指针位移按舞台缩放比（letterbox scale，StageFrame 已有）换算回舞台坐标；拖动/缩放过程中**只改内存里的 token 预览值**（manifest prop 逐帧下发，渲染器自然跟手重绘），松手才 `save_manifest` 落盘（带 revision 冲突检测）；
- 多部件重叠时按 DOM 顺序取最上层，Tab 键循环选择；V1 只做单选 + 移动 + 四角缩放手柄；
- 渲染器未声明 `layout-parts-v1` 时，拖拽入口显示"此渲染层未声明可拖拽部件"提示态，不报错；
- 部件未按约定由 token 完全驱动时不得标注 `data-ui-part`（否则拖拽值与视觉错位），这条写进 renderer-contract 文档。

## 8. 已排除的备选方案（调研存档）

- **嵌入 nexu-io/open-design**（[repo](https://github.com/nexu-io/open-design)，Apache-2.0，TypeScript）：它是完整的独立桌面应用，核心价值在 agent 编排（MCP 接入 22 种 CLI、skills、模型路由），删除这些后只剩 iframe 预览壳（我们已有）；且把 agent 工作台塞进 app 直接违反 No In-App AI 边界。
- **嵌入 manalkaff/opendesign**（[repo](https://github.com/manalkaff/opendesign)，MIT）：本质是 markdown 提示词技能包，没有交互式设计界面，不解决痛点。零成本替代用法：装进外部 Agent（Claude Code / Codex 等）提升 vibe 渲染出图质量，无需改本仓库代码。
- **嵌入 GrapesJS / Craft.js 等搭建库**：组件模型与"TSX 渲染器契约"不匹配，底层仍需先做 token 数据模型，额外只买到一块画布。
- **Onlook 式可视化改写 TSX 源码**：需 AST 解析 + source map + 代码回写，工作量以周计且脆弱；编辑的是代码不是数据，违反"编辑器不拥有渲染器视觉 UI"的护栏。
- **独立设计稿产物**（先画 mock 再生成渲染层）：需要自带格式/schema/预览器，且与最终渲染层必然漂移；"每个界面一张稿"的需求由场景刷 + 项目自定义 fixtures 承接（第 3 节步骤 1、5），用真实渲染层出图，永不脱节。

## 9. 验证与测试（实施时）

按仓库 TDD 约定，行为变更先写测试：

- 场景刷：预览面板能把渲染层挂载到 fixtures 场景；Studio 场景刷与 CLI `renderer-snapshot` 引用同一 fixtures 模块（单源，靠 import 关系而非测试约束）；`createInMemoryRuntimeServices` 挂载路径与剧情播放互不干扰；
- 面板类场景：瘦身 unlock 快照 → `initialGlobalPersistent` 映射正确；uiHint 全局通道注入后默认渲染层对应面板初始可见，无注入时行为与现状一致；
- 自定义 fixtures：`content/fixtures/*.json` 经 `fixture.schema.json` 校验（CLI validate 与 Studio 一致）；loader 不误报；
- engine/contracts：`uiSkins.tokens` 解析与校验测试（多数已有，补齐 token 值类型边界）；
- 默认渲染器：token 缺失时渲染输出与现状一致的快照/结构测试；token 提供时正确覆盖；`data-ui-part` 标注与 token key 一致；skin 选择规则（`"default"` 命中、缺失回退 + warn）；
- Studio：外观面板的 manifest 编辑走 `save_manifest` 且处理 revision 冲突；宫格视图与场景刷联动；拖拽 overlay 的舞台缩放换算、几何 token 写回、未声明 capability 时的退化提示；
- 验证命令：`pnpm test`、`pnpm --filter @vibegal/studio build`、`cd packages/studio/src-tauri && cargo test`、`pnpm run check:schemas`、`pnpm run check:doc-contract`。

## 10. 重新评估记录与触发条件

**2026-07-18 重估（已执行）**：原触发条件"外部 Agent + 提示词技能包实测已能满足设计效率需求"因 Agent 闭环（类型环境 / renderer-check / renderer-snapshot）落地而**部分触发**。结论：Agent 出图效率提升不取消本 spec——它解决的是"Agent 写得快"，不解决"人没有设计视角的查看面"与"外观无数据落点"；分期前置场景刷，舞台拖拽按用户需求转为正式步骤，并新增"场景单源"边界（第 2 节）。

满足以下任一条件时再次重估本 spec：

- 场景刷落地后实测 fixtures 覆盖不足（如高频需要 CG/视频/特效等更多场景形态），说明 fixtures 需扩展而非直接进入 token 阶段；
- 默认渲染器外观 token 化覆盖率实测（硬编码样式值中可被 token 化的比例）低于预期（< 70%），说明协议设计需返工；
- 外部 Agent + 场景刷实测已被用户接受为"够用"的设计流程，面板价值下降；
- 出现更贴合本项目渲染器契约的可嵌入设计工具。

## 11. 修订记录

- 2026-07-18 首次修订：前置"场景刷"分期；新增"场景单源"边界；外观面板预览改为场景刷；记录 2026-07-18 重估结论；背景补充 Agent 闭环现状（第 1.1 节）。
- 2026-07-18 第二次修订：定稿五步分期（场景刷 → token+改造 → 外观面板 → 拖拽 overlay → 自定义 fixtures）；舞台拖拽从可选升级转为正式步骤并补机制约定（第 7 节）；几何 token 语义定点为"舞台左上角原点 + 部件左上角 x/y"，bottom 锚定记为未决项（第 4 节）；新增 `layout-parts-v1` capability 与 `data-ui-part` 约定；已排除方案补"独立设计稿产物"；第 5 节增加 capability 与部件标注改造点。
- 2026-07-18 第三次修订：面板类场景扩充机制定点（第 4.1 节：瘦身 unlock 快照 + `__VIBEGAL_FIXTURE_UI__` uiHint 通道，场景清单改为存档/历史/设置/Gallery 四页，明确无"主菜单"）；自定义 fixtures 路径与格式定点（第 4.2 节：`content/fixtures/*.json`）；skin 选择规则定点（`"default"` 约定 id，回退第一个 + warn，第 4 节）；宫格视图从可选升级并入步骤 3 面板自带能力；第 5 节补 uiHint 读取改造点；验证节补面板场景/自定义 fixtures/skin 规则测试约定。
