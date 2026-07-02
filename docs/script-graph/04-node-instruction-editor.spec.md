# Phase 4 — 节点指令编辑器（Node Instruction Editor）规格

> 前置：Phase 3（图视图，双击进入节点的占位替换为本编辑器）、Phase 2（`project.nodes`）。
> 已读 [overview.md](./overview.md)（§1.1 节点=Instruction[]、§1.3 预览播放选中节点）。
> 本阶段把双击进入的节点视图做成**可编辑的指令流编辑器 + 单节点预览**。

## 1. 需求

每个叙事节点可作为一个本地指令流（`Instruction[]`）编辑：

- 进入节点（Phase 3 的双击/inspector「进入编辑」）后，显示 JSON 文本编辑器，数据源为该节点的 `nodes[].data`。
- 编辑后保存，写入 `content/nodes/<file>`（即 graph node 的 `file`）。
- 保存后刷新项目数据（复用 `Workspace.handleSaved` → `refreshProject`），右侧/同屏预览刷新。
- 外部改动同一节点文件 → 热重载刷新编辑器内容与预览。
- JSON 编辑优先（既有风格）；指令级可视化块留作后续。

## 2. 受影响 / 新增代码

| 文件 | 改动 |
|------|------|
| `features/script/ScriptWorkspace.tsx` | `view === "node"` 分支从占位换成 `<NodeEditor>` |
| `features/script/NodeEditor.tsx` | **新增**，派生自既有 `ScriptEditor` |
| `features/script/useNodePreview.ts` | **新增** hook，单节点预览 |
| `features/editor/ScriptEditor.tsx` | **不动**（旧章节编辑器保留兼容） |

## 3. `NodeEditor.tsx` 规格

### 3.1 与 `ScriptEditor` 的关系

`ScriptEditor`（`features/editor/ScriptEditor.tsx`）当前数据源是 `project.content.chapters`，
按 `selectedRel` 选章节、`saveFile(project.path, relPath, ...)` 保存。
`NodeEditor` **结构同构**，但数据源切到 `project.nodes`，且「选哪个节点」由 Script 工作台的
`selectedNodeId`（进入节点时已定）决定，而非左侧列表自选。

```ts
interface NodeEditorProps {
  project: ProjectData;
  node: GraphNode;            // 来自 project.graph，定位 file/id/title
  nodeData: unknown | null;   // 来自 project.nodes（按 node.file 匹配）
  onSaved: () => void;
}
```

### 3.2 布局（节点内视图）

```text
┌─ 节点编辑器 ────────────────────────────────────────┐
│ 面包屑：Script / 流程图 / <节点标题>    [未保存][保存]│
├─ 左：指令大纲（可选，本期可省） ─┬─ 中：JSON 编辑 ──┴─ 右：单节点预览 ─┐
│                                │ textarea(JSON)      │ <Preview> 单节点 │
└────────────────────────────────┴──────────────────────┴──────────────────┘
```

- **中：JSON 编辑** —— 直接复刻 `ScriptEditor` 的 `<textarea>` 风格（monospace、深色）。
- **右：单节点预览** —— `useNodePreview`（§4）驱动的 `<Preview>`（复用既有渲染层）。
- 左侧指令大纲本期可省（JSON 优先）；预留位置，后续做指令块时填。

### 3.3 数据水合（hydrate）

```ts
const [text, setText] = useState("");
const [dirty, setDirty] = useState(false);

useEffect(() => {
  // project 或 node 变化（含热重载刷新 project）时重新水合
  setText(nodeData == null ? "[]" : JSON.stringify(nodeData, null, 2));
  setDirty(false);
}, [nodeData, project]);   // 依赖 project 以响应热重载
```

- `nodeData == null`（文件缺失）时初始为 `"[]"`，保存即创建文件。
- 热重载刷新 `project` → `nodeData` 变 → effect 重水合。
  - **注意脏数据保护**：若 `dirty === true`（用户有未保存改动），重水合会覆盖。本期策略：
    `dirty` 时**不**自动覆盖，改为在编辑器顶栏提示「外部已更新，点击载入」让用户主动 `setText`。
    （避免静默吞掉用户输入，符合 AGENTS.md「保守对待用户文件」。）

### 3.4 保存

```ts
const handleSave = async () => {
  const parsed = JSON.parse(text);                 // 校验 JSON 合法性（非法→状态栏报错，不写盘）
  await saveFile(project.path, `content/${node.file}`, JSON.stringify(parsed, null, 2));  // 复用既有 saveFile
  setDirty(false);
  setStatus("已保存 ✓");
  onSaved();                                        // → Workspace.refreshProject
};
```

- 复用 `lib/tauri.ts` 的 `saveFile(project.path, relPath, content)`。
  注意：`node.file` 是**相对 `content/` 根**的路径，而现有 `saveFile` 的 `relPath` 是**相对项目根**，
  所以这里必须传 `content/${node.file}`。**不新增后端命令**。
  `saveFile` 内部已做 `canonical_project_root` + `resolve_relative_under` + `ensure_existing_path_within`，路径安全天然覆盖。
- 保存成功 → `onSaved` → `refreshProject` → `openProject` 重读 → `project.nodes` 更新 → 预览刷新。

## 4. `useNodePreview.ts`（单节点预览）

把选中节点当作**单章节**喂给引擎播放。复用既有 `validateContent` / `NovelPlayer` / `AudioEngine`，
结构同 `useProjectPlayer`，但 chapters 只有一个、来自当前节点。

```ts
export function useNodePreview(
  project: ProjectData,
  node: GraphNode | null,
  nodeData: unknown | null,
): ProjectPlayerResult {   // 返回类型与 useProjectPlayer 一致，Preview 组件可直接消费
  // ...
  const validated = validateContent({
    meta: project.content.meta,
    manifest: project.content.manifest,
    chapters: nodeData == null ? [] : [{ file: node!.file, data: nodeData }],
  });
  const player = new NovelPlayer({ meta, manifest });
  player.load(validated.chapters);   // 单章节
  // contentBase = convertFileSrc(`${project.path}/content`)
  // subscribe / audio.sync 同 useProjectPlayer
}
```

- `node == null` 或 `nodeData == null` → 返回初始态 + 提示「节点无内容」，不抛。
- 复用 `RendererProps` 组装，与既有 `Preview` 完全兼容。

### 4.1 预览容器

`NodeEditor` 右栏渲染：

```tsx
<NodePreviewPanel project={project} rendererId={rendererId} node={node} nodeData={nodeData} refreshKey={refreshKey} />
```

内部用 `useNodePreview` 拿 player，再 `loadRenderer(project.path, rendererId)` 拿渲染层组件，
渲染 `<Renderer {...rendererProps} />`（复用 `Preview.tsx` 的渲染层加载逻辑，可抽公共）。
建议把 `Preview.tsx` 里「加载渲染层 + 处理 loading/error」那段抽成 `useRendererComponent` hook，
供既有 `Preview` 与新的 `NodePreviewPanel` 共用。

## 5. 与 Phase 3 的接线

`ScriptWorkspace.tsx`：

```tsx
{view === "node" && selectedNode && (
  <NodeEditor
    project={project}
    node={selectedNode}
    nodeData={findNodeData(project.nodes, selectedNode.file)}
    onSaved={handleSaved}
  />
)}
```

- `selectedNode = findNode(project.graph, selectedNodeId)`。
- `findNodeData(nodes, file)` = `nodes?.find(n => n.relPath === file)?.data ?? null`（新增小 helper，放 `graphMapping.ts` 或独立 util）。

## 6. 测试清单（TDD）

### 前端（Vitest）

| 测试名 | 断言要点 |
|--------|---------|
| `findNodeData locates data by node file` | 命中返回 data；缺失返回 null；nodes 为 undefined 返回 null |
| `useNodePreview treats node as single chapter` | chapters 长度为 1（有数据）/ 0（null 数据），不抛 |

> `useNodePreview` 涉及 `NovelPlayer`，已有 engine 测试覆盖 player 行为；hook 层测试可用现有
> `validateContent` fixture 风格。若 hook 难单测（副作用多），至少保证 `findNodeData` 纯函数有测。
> 组件渲染（`NodeEditor` 脏数据保护、保存）本期无 testing-library，验收靠手动（§7）。

### 后端

**无新增后端改动**（保存走既有 `save_file`，加载走 Phase 2 的 `open_project`）。
但需在 Phase 2 测试基础上确认：保存节点文件后 `open_project` 能正确读回（已被 Phase 2 覆盖）。

## 7. 验收标准

1. 图视图双击节点 → 进入节点编辑器，textarea 显示该节点 JSON。
2. 编辑 + 保存 → 写入 `content/nodes/<file>`；项目数据刷新后预览更新。
3. 非法 JSON 保存 → 状态栏报错、不写盘。
4. 节点文件原本缺失（`data: null`）→ 编辑器初始为 `[]`，保存后文件创建、状态变「已有内容」。
5. 外部编辑同一节点文件 → 热重载后：
   - 编辑器无未保存改动 → 自动载入新内容。
   - 编辑器有未保存改动 → 提示「外部已更新，点击载入」，不静默覆盖。
6. 单节点预览能播放该节点指令（背景/立绘/台词等正常）。
7. 面包屑返回图视图，选中态保留。

## 8. 边界情况

| 情况 | 处理 |
|------|------|
| 节点文件缺失（`data: null`） | 初始 `"[]"`，保存即创建 |
| 节点 JSON 非法（手改坏） | Phase 2 的 `open_project` 已会 Err；编辑器侧若仍能进入（旧 project 缓存），保存前 `JSON.parse` 会拦 |
| 用户未保存时外部更新 | 顶栏提示，不静默覆盖（§3.3） |
| 节点指令引用 manifest 不存在的 id | `validateContent` 抛 → 预览显示错误信息（既有行为） |
| 合成图节点（file 指向 chapters/旧文件） | 正常：file 就是 `chapters/ch01.json`，编辑即改旧章节文件。语义一致 |
| 空 `nodeData`（`[]`） | 编辑器显示 `[]`，预览显示空场景 |

## 9. 不在本期范围

- 指令级可视化块编辑器（本期 JSON textarea 优先）。
- 图编辑（拖位置/连线/增删节点，Phase 5）。
- 多节点预览 / 整图播放（§overview 1.3，留后续）。
