# Phase 7+ — 借鉴 Everything2Galgame 的流程图增强计划

> Source study: `/Users/pixelsama/Dev/Github/Everything2Galgame` main branch.
> Scope: 研究 Everything2Galgame 的 Story Flow，从功能和前端两个方面提炼可迁移方案，并结合 GalStudio 当前 Script Graph 架构规划下一阶段。

## 1. 结论

Everything2Galgame 的流程图设计最值得借鉴的不是具体代码，而是产品层级：

```text
Story Flow 先搭剧情地图
  -> 双击节点进入单个剧情单位
  -> 节点内再写具体演出/台词
```

这与 GalStudio 已经确定的 Script Graph 心智一致。GalStudio 应继续保留现有的 `@xyflow/react` 方案，不照搬 Everything2Galgame 的手写 SVG 画布；但要吸收它在「创建入口、右键菜单、节点状态、inspector、自动排布、安全删除、节点进入体验」上的成熟交互。

## 2. Everything2Galgame 的实现摘要

### 2.1 功能层

核心源码：

- `packages/editor-electron/src/shared/flowModel.ts`
- `packages/editor-electron/src/renderer/StoryWorkspace.tsx`
- `packages/editor-electron/src/renderer/features/story/StoryScriptEditorView.tsx`
- `packages/editor-electron/src/renderer/features/story/SceneCanvasView.tsx`

它的模型是从 `Story.scenes` 派生一张故事流程图：

- 一个流程图节点 = 一个 scene。
- 边来自 frame 的跳转、选择、条件分支或章节跳转。
- 节点状态包括 start、linear、branch、condition、ending、empty、orphan。
- 节点卡片会显示背景预览图、入口/出口数量、是否为起点/终点。
- inspector 显示入边、出边、未连接选择、结构警告。
- 双击节点进入脚本/场景编辑。
- 支持自动排布、拖动节点、从节点出口拖线、创建后续节点、复制、删除。

它还有一条重要产品规则：流程图负责「场景之间怎么走」，节点内部负责「这一段戏怎么演」。这个边界很清楚。

### 2.2 前端层

Everything2Galgame 没有用 React Flow，而是自己实现：

- 自绘 SVG path 和箭头。
- 自己维护缩放、滚动、拖拽、连接预览。
- 自己实现浮动菜单定位、右键菜单、删除弹窗。
- 画布工具层固定悬浮，不跟随画布缩放。
- 节点尺寸固定，状态色区分分支/终点/孤立节点。

值得保留的前端经验：

- 创建入口不能伪装成节点，应是画布控制层里的固定按钮。
- 右键空白处是画布菜单，右键节点是节点菜单。
- 自动排布是整理工具，新建是创作工具，两者不要混在一个按钮里。
- inspector 可以默认关闭或可收起，避免初始画布太窄。
- 菜单必须做 viewport 内定位，避免弹出到窗口外。
- 节点卡片需要稳定尺寸，避免标题或状态变化导致画布跳动。

不适合直接搬的部分：

- 手写 SVG 画布成本高，GalStudio 已经有 React Flow，继续用 React Flow 更稳。
- Everything2Galgame 的 scene/frame/capability runtime 与 GalStudio 的 `Instruction[]` 节点模型不同，不能照搬 choice/terminator 的语义。
- Scene Canvas 的所见即所得编辑很强，但对当前 GalStudio 是后续大功能，不应阻塞流程图 V1。
- 它的 Electron UI adapter、完整 i18n、复杂菜单系统偏重，GalStudio 当前阶段应先做轻量版本。

## 3. GalStudio 当前状态

GalStudio 已具备流程图地基：

- `content/graph.json` + `content/nodes/*.json` 数据契约。
- 旧章节合成线性图，且不自动改写磁盘。
- watcher + debounce 自动刷新 `content/` 和 `renderers/`。
- `@xyflow/react` 画布。
- 节点新增、删除、重命名、拖动、连线、固化合成图。
- 单节点 JSON 指令编辑和单节点预览。
- 图 issues 面板和同步状态。
- 顶部 Render / Script / Assets 工作台。

下一阶段不应该重写这些基础，而是把 Script Graph 从「能用」打磨成「像专业创作工具」。

## 4. 迁移原则

1. React Flow 继续作为画布核心。
2. `graph.json` 继续是人工与外部工具/Agent 都可读写的真实源。
3. 节点文件继续复用 `Instruction[]`，不引入 `{ type, speaker }` 新格式。
4. 预览仍以「选中节点」为最小播放单元，整图播放后续再做。
5. 所有图编辑动作先走纯函数 reducer，再落盘，保持可测试。
6. 外部工具/Agent 改文件后，UI 要快速刷新并尽量保留用户当前视角和选中态。

## 5. 建议实施路线

### Phase 7: 画布交互增强

目标：让图视图从基础 React Flow 变成稳定创作画布。

任务：

- 把「新建节点」从普通 toolbar 升级为画布右下角固定创建按钮。
- 增加空白处右键菜单：新建节点、自动排布、重置视图。
- 增加节点右键菜单：进入编辑、重命名、复制、创建后续节点、删除。
- 删除节点使用自绘确认弹窗，替换 `window.confirm`。
- 增加 `fit view`、重置 zoom、定位到入口节点按钮。
- 让节点创建位置优先使用当前视口中心或右键处的画布坐标。

测试：

- 纯函数：菜单落点坐标、节点默认落点、复制节点 id/file 生成。
- 组件手动验收：右键菜单不超出窗口，创建后自动选中新节点。

### Phase 8: 节点状态和图结构可读性

目标：让作者一眼看懂剧情地图是否健康。

任务：

- 在 `graphMapping.ts` 中派生节点 view status：
  - entry
  - normal
  - missing-file
  - orphan
  - branch
  - ending
  - duplicate
- `GraphNodeView` 显示入口徽标、状态点、入边/出边数量。
- `NodeInspector` 显示 incoming / outgoing 摘要。
- `GraphIssuesPanel` 点击 issue 后定位节点或边，并在画布上高亮。
- 支持设置入口节点，避免 entryNodeId 悬空只能靠手改 JSON。

测试：

- `deriveGraphNodeStatus()` 单测覆盖入口、孤立、缺文件、重复 id、终点标记。
- `setEntryNode()` reducer 单测。

### Phase 9: 自动排布与布局持久化

目标：解决用户或外部工具/Agent 批量新增节点后画布混乱的问题。

任务：

- 引入轻量自动排布策略，优先使用 React Flow 可接受的 dagre/elk 布局库。
- 若暂不加依赖，先做确定性分层布局：
  - 从 `entryNodeId` BFS 分层。
  - 同层按 title/id 排序。
  - 不可达节点放到底部单独区域。
- 自动排布只修改 `position`，不改节点 id/file/edge。
- 自动排布后一次性保存 `graph.json`。
- 提供「只整理当前选中子图」作为后续扩展，不放 V1。

测试：

- 自动排布纯函数：入口在左，后继在右，不可达节点位置稳定。
- 重复运行同一图得到相同 position。

### Phase 10: 节点内编辑体验升级

目标：保留 JSON 控制权，同时降低写剧本门槛。

任务：

- 在 JSON 编辑器上方增加简单的块级大纲，只读展示 `say/narrate/bg/bgm/choice-like comment`。
- 支持从大纲定位到 JSON 中对应指令。
- 增加常用插入按钮：旁白、台词、背景、等待、BGM。
- 插入仍写 `Instruction[]`，不创造新 DSL。
- 未保存时外部更新，保留当前「提示载入」策略，不静默覆盖。

测试：

- `summarizeInstructions()` 单测。
- `insertInstructionAt()` 单测。
- 非法 JSON 不写盘。

### Phase 11: 外部数据协作增强

目标：让外部工具/Agent 更容易安全地改图，同时保持 GalStudio 不接入 AI 的产品边界。这里的重点是降低外部 AI coding
出错概率，而不是在编辑器里增加一个需要用户再切回 Codex/Claude Code 的中转操作。

任务：

- 为 `graph.json` 和节点文件生成 JSON Schema 或 Zod schema 导出，供外部工具校验。
- 在文档中补充“外部工具/Agent 直接改文件”的安全操作范式。
- 增加 CLI 校验命令，例如 `galstudio validate <project-path> --format json`，让外部 Agent 能直接读取结构化错误并自主迭代。
- CLI 校验失败时使用非零退出码，错误中包含 node id、edge id、文件路径、JSON path 和稳定错误码。
- 保持图文件格式稳定，减少外部 Agent 修改后的 diff 噪音。
- 继续禁止应用内 AI 按钮、prompt 生成、provider 设置、token 存储或 Agent 会话管理。

测试：

- schema 导出、CLI 输出格式和退出码用测试覆盖，避免遗漏关键路径安全约束。

### Phase 12: 后续大功能候选

这些功能有价值，但不建议现在做：

- 整图播放：需要明确 edge.condition/分支语义。
- 节点分组/章节泳道：需要先稳定节点粒度。
- Scene Canvas 所见即所得：需要资产系统和渲染层交互协议更成熟。
- 多选批量操作：等基础右键和安全删除稳定后再做。
- Undo/redo：建议等 graph reducer 动作类型收敛后统一实现。

## 6. 前端目标形态

Script Graph 的目标布局：

```text
┌─ Script ──────────────────────────────────────────────────────────┐
│ 左：节点大纲        │ 中：React Flow 画布                 │ 右：Inspector │
│ entry / status      │ 画布控制层：zoom / auto layout       │ 节点属性       │
│ 搜索/过滤           │ 右下：+ 新建                         │ 连接摘要       │
│                     │ 右键：空白菜单 / 节点菜单            │ Issues         │
└─────────────────────┴────────────────────────────────────┴────────┘
```

节点卡片建议信息层级：

```text
┌────────────────────────┐
│ 起  序章               │
│ nodes/prologue.json    │
│ ● 已有内容   in 0 out 1│
└────────────────────────┘
```

颜色语义：

- 蓝色：当前选中 / 入口。
- 绿色：内容正常 / 终点。
- 黄色：分支、待连接、警告。
- 红色：缺文件、重复 id、悬空边。

## 7. 明确不做的移植

| Everything2Galgame 做法 | GalStudio 处理 |
| --- | --- |
| 手写 SVG 边和 pan/zoom | 不移植，继续用 React Flow |
| scene/frame/capability 状态机 | 不移植，继续用 `Instruction[]` |
| choice 必须是 scene terminator | 暂不采纳，GalStudio 当前没有正式分支指令 |
| 背景缩略图作为节点主视觉 | 后续资产系统成熟后再做 |
| 章节切换器和 story states panel | 暂不做，节点粒度先稳定 |
| 大型 WYSIWYG Scene Canvas | 作为远期候选，不进入近期流程图计划 |

## 8. 第一批落地建议

最推荐先做 Phase 7 + Phase 8。

原因：

- 它们不改变数据协议，风险低。
- 能显著改善用户直觉：在哪里新建、怎么连接、哪里有问题。
- 纯函数测试比例高，符合当前项目 TDD 方式。
- 对外部自动化很友好：外部工具改出坏图时，用户能马上看到并定位。

完成 Phase 7 + Phase 8 后，GalStudio 的 Script Graph 就会从「数据可视化」进入「可日常使用的剧情流程工具」阶段。
