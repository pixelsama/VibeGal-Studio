# Phase 3 — 脚本图视图（Script Graph View）规格

> 状态：完成。
> 前置：Phase 1（工作台导航）、Phase 2（图数据契约，`project.graph`/`project.nodes` 就位）、
> 已读 [overview.md](./overview.md)（§1.4 React Flow、§3 类型）。
> 本阶段把 Script 工作台过渡视图升级为**图视图**。本期为**只读展示 + 导航**，图编辑留 Phase 5。

## 1. 需求

Script 工作台默认打开**图概览**：

- 渲染节点（标题 + 状态），渲染边。
- 支持画布 pan / zoom。
- 单击节点 → 选中 + 右侧 inspector 显示节点属性。
- 双击节点 → 进入节点（Phase 4 的节点编辑器；本期占位）。
- 面包屑/返回按钮回到图概览。
- 外部文件改动 → 经热重载刷新图。

布局（图概览态）：

```text
┌─ Script 工作台 ────────────────────────────────────┐
│ 左：节点/章节大纲列表        │ 中：图画布          │ 右：inspector │
│                             │  (React Flow)       │  (节点属性)    │
└─────────────────────────────┴──────────────────────┴───────────────┘
```

## 2. 新增依赖

`packages/studio/package.json` 增加：

```json
"dependencies": {
  "@xyflow/react": "^12.x"
}
```

- 这是当前前端**第一个 UI 库**（既有前端零 UI 依赖）。
- React Flow v12 包名是 `@xyflow/react`（v11 是 `reactflow`，不要装错）。
- 需引入其样式 `@xyflow/react/dist/style.css`（在 `ScriptWorkspace` 顶部 import）。
- 主题：用 `colorMode="dark"` 或自定义 node/edge 样式匹配既有深色（背景 `#0e1116`、边框 `#232a38`、强调 `#9fc8e3`/`#3a6ea5`）。

## 3. 目录与组件

```text
packages/studio/src/features/script/
├── ScriptWorkspace.tsx        # Phase 1 立的壳；本阶段替换其内部为图视图
├── GraphCanvas.tsx            # React Flow 画布封装
├── GraphNodeView.tsx          # 自定义 node 类型组件
├── NodeInspector.tsx          # 右侧节点属性面板
├── NodeOutline.tsx            # 左侧大纲列表
├── graphMapping.ts            # 【纯函数】project.graph ⇄ React Flow nodes/edges
├── graphMapping.test.ts       # 纯函数单测
└── Breadcrumb.tsx             # 面包屑（图概览 / 节点内）
```

`ScriptWorkspace` 对外 props 边界（Phase 1 已定）保持不变：

```ts
interface ScriptWorkspaceProps {
  project: ProjectData;
  rendererId: string;
  refreshKey: number;
  onSaved: () => void;
}
```

内部新增状态：

```ts
type ScriptView = "graph" | "node";
const [view, setView] = useState<ScriptView>("graph");
const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
```

- `view === "graph"` → 三栏布局（大纲 + 画布 + inspector）。
- `view === "node"` → 节点编辑器（Phase 4 实现；Phase 3 占位「节点编辑器 · Phase 4」+ 返回按钮）。

## 4. 纯函数映射层 `graphMapping.ts`（核心，可单测）

把 `ProjectGraph` 与 React Flow 数据双向映射。**所有图→画布的转换逻辑集中在此，不散落组件里。**

```ts
import type { Node, Edge } from "@xyflow/react";
import type { ProjectGraph, GraphNode } from "../../lib/types";

export const NODE_TYPE = "galNode";

/** graph node → React Flow node */
export function mapGraphToFlow(graph: ProjectGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((n) => ({
    id: n.id,
    type: NODE_TYPE,
    position: n.position,
    data: { title: n.title, fileId: n.file, isEntry: n.id === graph.entryNodeId },
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: "smoothstep",           // 直角折线，适合流程图
    data: { condition: e.condition },
  }));
  return { nodes, edges };
}

/** 当前选中节点对象 */
export function findNode(graph: ProjectGraph, id: string | null): GraphNode | null {
  if (!id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}
```

> 反向映射（React Flow 编辑 → ProjectGraph）在 Phase 5 的 `graphEditing.ts` 里，
  本期 `graphMapping.ts` 只做**只读**方向。

## 5. 组件规格

### 5.1 `GraphCanvas.tsx`

```tsx
<ReactFlow
  nodes={flow.nodes}
  edges={flow.edges}
  nodeTypes={{ [NODE_TYPE]: GraphNodeView }}
  onNodeClick={(_, n) => onSelect(n.id)}            // 单击选中
  onNodeDoubleClick={(_, n) => onEnter(n.id)}       // 双击进入
  fitView                                            // 打开自适应
  proOptions={{ hideAttribution: false }}            // 遵守 React Flow 许可，保留 attribution
>
  <Background />
  <Controls />
  <MiniMap nodeColor={…} maskColor="rgba(0,0,0,0.6)" />
</ReactFlow>
```

- `nodes`/`edges` 来自 `useMemo(() => mapGraphToFlow(project.graph), [project.graph])`。
- 画布**只读**：本期不接 `onNodesChange`/`onEdgesChange`/`onConnect`（Phase 5 才开编辑）。
  React Flow 默认仍允许 pan/zoom（交互不等于编辑数据）。
- 选中高亮：用 React Flow 的 `selected`（点击后自动标），`GraphNodeView` 据 `selected` 加边框高亮。
- 空图（`graph.nodes.length === 0`）：画布上方居中提示「暂无节点」（合成空图也走这里）。

### 5.2 `GraphNodeView.tsx`（自定义 node）

显示：
- 节点标题（`data.title`）。
- entry 标记：`data.isEntry` 时节点左上角小圆点/徽标「起」。
- 状态指示：根据 `project.nodes` 中对应 `data.fileId` 的 `data` 是否为 `null`，
  显示「✓ 已有内容 / ⚠ 文件缺失」小图标（与 Phase 2 的 `data: None` 呼应）。
- selected 态：边框 `#9fc8e3` + 微抬亮。

### 5.3 `NodeInspector.tsx`（右栏）

显示选中节点（`findNode(project.graph, selectedNodeId)`）的属性：
- 标题、id、file 路径、是否 entry、position。
- 节点文件状态（有/无内容）。
- 「进入编辑」按钮 → `onEnter(id)`（等价双击）。
- 未选中：占位「选择一个节点查看属性」。

### 5.4 `NodeOutline.tsx`（左栏）

- 列出 `project.graph.nodes`（标题 + 状态点），点击 = 选中（同步画布选中 + 滚动到该节点）。
- entry 节点置顶/标记。
- 与画布选中状态双向同步：大纲选中 ↔ 画布 `selectedNodeId`。

### 5.5 `Breadcrumb.tsx`

- `view === "graph"`：显示「Script / 流程图」。
- `view === "node"`：显示「Script / 流程图 / **{节点标题}**」，点击「流程图」返回 `setView("graph")`。

## 6. 数据流与热重载

- `project`（含 `graph`/`nodes`）从 `Workspace` 透传；外部改 `graph.json`/节点文件 →
  `project_changed` → `Workspace.refreshProject` → `openProject` 拿新 `project` →
  `ScriptWorkspace` 收到新 `project` → `mapGraphToFlow` 重算 → 画布更新。
- 选中态 `selectedNodeId` 在刷新后尽量保留：若新图仍有该 id 则保持选中，否则置 null。
  （`useEffect` 依赖 `project.graph` 校验 `selectedNodeId` 是否仍存在。）

## 7. 测试清单（TDD）

### 前端纯函数（Vitest，`graphMapping.test.ts`）

| 测试名 | 断言要点 |
|--------|---------|
| `mapGraphToFlow maps nodes with position and type` | 节点 id/position/type=galNode 正确，data 含 title/fileId/isEntry |
| `mapGraphToFlow marks entry node` | 只有 entryNodeId 对应节点 `data.isEntry === true` |
| `mapGraphToFlow maps edges with smoothstep type` | edge source/target/id/type 正确 |
| `mapGraphToFlow handles empty graph` | 空 nodes/edges 返回空数组，不抛 |
| `findNode returns node by id` | 命中返回节点，不存在返回 null，null id 返回 null |

> React Flow 组件本身不单测（既有前端无 testing-library）。映射纯函数是可测的核心逻辑。

## 8. 验收标准

1. 打开一个含 `graph.json` 的示例项目，Script 工作台显示对应节点 + 连线。
2. 画布可拖拽平移、滚轮缩放，minimap 可见。
3. 单击节点：左大纲 + 右 inspector 同步显示该节点。
4. 双击节点：进入节点占位视图，面包屑出现节点名；点面包屑「流程图」返回。
5. 外部新增一个 `content/nodes/x.json` + 改 `graph.json`：保存后画布出现新节点（无需重开项目）。
6. 空项目（无 graph）：画布显示「暂无节点」，不报错。

## 9. 边界情况

| 情况 | 处理 |
|------|------|
| `project.graph` 为 undefined（理论不会，Phase 2 总返回） | 当作空图，显示「暂无节点」 |
| 节点文件缺失（`data: null`） | 节点上显示「⚠ 文件缺失」，双击进入显示提示而非崩溃 |
| 边指向不存在的节点（悬空边） | 本期 React Flow 会渲染异常边；Phase 6 校验会标红。本期至少不崩溃 |
| 重复 node id（损坏数据） | React Flow 按 id 去重显示；Phase 6 校验标错 |

## 10. 不在本期范围

- 节点内**指令编辑器**（Phase 4，本期双击只到占位）。
- 图**编辑**：拖动改位置、连线、新建/删除节点（Phase 5）。
- 单节点**预览**（Phase 4 的 `useNodePreview`）。
