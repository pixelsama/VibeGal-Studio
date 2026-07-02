# Phase 5 — 图编辑（Graph Editing）规格

> 前置：Phase 3（图视图）、Phase 4（节点编辑器）、Phase 2（数据契约）。
> 已读 [overview.md](./overview.md)（§4 路径安全、§1.2 节点粒度）。
> 本阶段让用户能**创建 / 移动 / 连线 / 重命名 / 删除**节点，并持久化。**含后端新命令，严格 TDD。**

## 1. 需求

- 创建节点：工具栏「+ 新建节点」→ 生成图节点 + 空 `[]` 节点文件。
- 重命名：inspector 改节点标题（改 `node.title`，**不**改 id/文件名，避免引用断裂）。
- 移动：拖拽节点改 `position`，防抖落盘。
- 连线：React Flow `onConnect` → 新增 edge。
- 删除：选中节点/边 + 删除（节点删除带确认）。
- 持久化：上述编辑写回 `content/graph.json`（必要时新建/删节点文件）。
- 「转为图项目」固化：合成图（`synthetic: true`）下提供显式「固化图结构」动作，把合成图落盘为 `graph.json`。

## 2. 后端新命令（`lib.rs`）

### 2.1 `save_graph`

```rust
#[tauri::command]
fn save_graph(
    project_path: String,
    graph: ProjectGraphInput,        // 前端传完整图（见下）
) -> Result<(), String>
```

`ProjectGraphInput`（Deserialize）：

```rust
#[derive(Deserialize)]
pub struct ProjectGraphInput {
    pub version: u32,
    #[serde(rename = "entryNodeId")]
    pub entry_node_id: String,
    pub nodes: Vec<GraphNodeInput>,
    pub edges: Vec<GraphEdgeInput>,
}
#[derive(Deserialize)]
pub struct GraphNodeInput {
    pub id: String,
    pub title: String,
    pub file: String,
    pub position: GraphPositionIn,   // { x: f64, y: f64 }
}
#[derive(Deserialize)]
pub struct GraphEdgeInput {
    pub id: String,
    pub from: String,
    pub to: String,
    pub condition: serde_json::Value,
}
```

行为：

```text
1. project_path = canonical_project_root(project_path)?
2. content_root = content/.canonicalize()?
3. 路径安全预检：对每个 node.file 调 resolve_relative_under(&content_root, &file)?
   （越界直接 Err，不写盘。任何 node 非法 → 整体回滚不写。）
4. 构造 graph.json 的 serde_json::Value：
     { version, entryNodeId, nodes:[{id,title,file,position}], edges:[{id,from,to,condition}] }
5. write_json(&content_dir.join("graph.json"), &value)?   // 复用既有 write_json（pretty）
```

**校验策略**（保守、可操作）：
- 必填字段缺失（id/file/from/to）→ `Err`，信息指明哪个节点/边。
- `node.file` 越界 → `Err("路径越界：{file}")`。
- **不**校验 id 唯一/entry 存在/边悬空（Phase 6 的 `graphIssues` 负责，写入不阻断——允许用户存中间态）。
- **不**在此命令里创建/删除节点文件（文件生命周期由 `save_file`/`delete_file` 显式管理，职责单一）。

### 2.2 `delete_file`

删除 `content/` 下的单个文件（删节点文件用）：

```rust
#[tauri::command]
fn delete_file(project_path: String, rel_path: String) -> Result<(), String>
```

行为：

```text
1. project_path = canonical_project_root(project_path)?
2. content_root = content/.canonicalize()?
3. target = resolve_relative_under(&content_root, &rel_path)?
4. if target.exists(): ensure_existing_path_within(&content_root, &target)?  // 复用，防符号链接/父目录替换
5. if target.exists(): fs::remove_file(&target)?           // 仅删文件，不递归删目录
   else: Ok(())                                             // 不存在视为已删，幂等
```

- **保守**：只删单个文件，`fs::remove_file`（非 `remove_dir_all`），避免误删目录。
- 路径安全三段式与 `save_file` 完全对齐。

### 2.3 注册

在 `lib.rs:756-766` 的 `invoke_handler!` 加入 `save_graph`、`delete_file`。

## 3. 前端包装（`lib/tauri.ts`）

```ts
export async function saveGraph(projectPath: string, graph: ProjectGraph): Promise<void>
// → "save_graph"

export async function deleteFile(projectPath: string, relPath: string): Promise<void>
// → "delete_file"
```

`saveGraph` 入参直接用 `ProjectGraph` 类型（去掉 `synthetic` 字段传或不传都行，后端 Deserialize 忽略多余字段）。

## 4. 前端图编辑逻辑（纯函数 + 组件）

### 4.1 新增 `features/script/graphEditing.ts`（纯函数 reducer，可单测）

把图编辑动作建模为对 `ProjectGraph` 的不可变变换：

```ts
export function addNode(graph: ProjectGraph, opts: { id: string; title: string; file: string; position?: {x;y} }): ProjectGraph
export function removeNode(graph: ProjectGraph, nodeId: string): { graph: ProjectGraph; removedFile: string | null }
//   删节点同时删其关联边；返回被删节点 file 供调用方决定是否删盘
export function connectNodes(graph: ProjectGraph, from: string, to: string): ProjectGraph
//   edge id = `${from}__${to}`；若已存在同 from→to 的边则幂等返回
export function renameNode(graph: ProjectGraph, nodeId: string, title: string): ProjectGraph
export function moveNode(graph: ProjectGraph, nodeId: string, position: { x: number; y: number }): ProjectGraph
export function removeEdge(graph: ProjectGraph, edgeId: string): ProjectGraph
export function generateNodeId(graph: ProjectGraph, base: string): string
//   "node"、"node_2"、"node_3"… 去重
export function defaultPosition(graph: ProjectGraph): { x: number; y: number }
//   新节点落点：现有节点重心 + 偏移，避免压在已有节点上
```

### 4.2 持久化协调（`ScriptWorkspace`）

编辑是「内存图 + 落盘」两步。落盘分两类：

**a) 图结构变更（增/删节点、连线、删边、重命名、固化）** → 立即 `saveGraph`：

```ts
const persistGraph = async (next: ProjectGraph) => {
  await saveGraph(project.path, next);
  onSaved();   // → refreshProject → 重新 openProject 拿最新 graph/nodes
};
```

**b) 拖拽移动（高频）** → 防抖 `saveGraph`：

```ts
const debouncedSavePosition = useMemo(() => debounce(persistGraph, 400), [project.path]);
// onNodesChange 的 position drag → moveNode → debouncedSavePosition
```

（`debounce` 可用一个极简自实现 util 或装 `lodash.debounce`；优先自实现避免新依赖。）

**c) 新建节点的文件创建** → 先 `saveFile` 写空 `[]`，再 `saveGraph`：

```ts
const handleCreateNode = async () => {
  const id = generateNodeId(graph, "node");
  const file = `nodes/${id}.json`;
  await saveFile(project.path, `content/${file}`, "[]");  // 建空文件；saveFile 的 relPath 相对项目根
  const next = addNode(graph, { id, title: id, file, position: defaultPosition(graph) });
  await persistGraph(next);
};
```

**d) 删除节点** → 确认后删盘文件 + 存图：

```ts
const handleDeleteNode = async (nodeId: string) => {
  if (!confirm(`确定删除节点「${findNode(graph, nodeId)?.title}」？`)) return;
  const { graph: next, removedFile } = removeNode(graph, nodeId);
  if (removedFile) {
    try { await deleteFile(project.path, removedFile); }
    catch (e) { console.warn("删除节点文件失败（图已更新）:", e); }
    // 注：即使文件删除失败，图仍更新。文件可残留，避免图与文件不一致时阻断用户
  }
  await persistGraph(next);
  if (selectedNodeId === nodeId) setView("graph"), setSelectedNodeId(null);
};
```

### 4.3 React Flow 接线（`GraphCanvas.tsx` 升级）

Phase 3 是只读；本阶段开启编辑回调：

```tsx
<ReactFlow
  nodes={flow.nodes}
  edges={flow.edges}
  nodeTypes={{ [NODE_TYPE]: GraphNodeView }}
  onNodesChange={handleChange}            // 处理 position drag（防抖存图）；selection 变化
  onEdgesChange={handleChange}            // 边选中
  onConnect={(c) => onConnect(c.source, c.target)}
  onNodeClick={...} onNodeDoubleClick={...}
  deleteKeyCode={["Backspace", "Delete"]} // 选中后按删除键
  fitView
>
```

- `handleChange`：用 React Flow 的 `applyNodeChanges`/`applyEdgeChanges` 维护受控 nodes/edges，
  其中 position 变化提取出来走 `moveNode` + 防抖存图。
- 删除：React Flow 选中 + Delete 键触发 `onNodesDelete`/`onEdgesDelete` → 走 §4.2 的删节点/删边。
- 工具栏：画布上方加「+ 新建节点」「固化图结构（仅合成图显示）」按钮。

### 4.4 「转为图项目」固化

仅当 `project.graph.synthetic === true` 时，inspector 或工具栏显示「固化图结构」按钮：

```ts
const handleMaterialize = async () => {
  const { synthetic, ...rest } = project.graph;   // 去掉 synthetic 标记
  await saveGraph(project.path, { ...rest, synthetic: false } as ProjectGraph);
  onSaved();   // 刷新后 graph.synthetic === false（graph.json 已存在）
};
```

固化后 `graph.json` 落盘，下次打开为「真实图项目」。**不**移动/复制 chapters 文件——
合成图的 `node.file` 本就指向 `chapters/*.json`，固化后图引用旧文件，语义不变。

## 5. 路径安全（overview §4）

- `save_graph` 对每个 `node.file` 走 `resolve_relative_under` 预检（§2.1 步骤 3）。
- `delete_file` 走完整三段式（§2.2）。
- 新建节点 `file = nodes/${id}.json`：`id` 经 `generateNodeId` 生成，且 `validate_plain_name(id)`
  保证无路径分隔符（前端生成时就用 `[a-z0-9_-]`，后端 `save_graph` 的 `resolve_relative_under` 兜底）。

## 6. 测试清单（TDD）

### Rust（`lib.rs` 内联 `mod tests`）

新增 helper：

```rust
fn write_graph_project_with_files(dir, graph_json, node_files: &[(&str, &str)])
```

| 测试函数名 | 断言要点 |
|-----------|---------|
| `save_graph_writes_graph_json` | 存图后 `content/graph.json` 存在、内容（pretty）含正确 nodes/edges |
| `save_graph_overwrites_existing_graph_json` | 已有 graph.json 被新内容覆盖 |
| `save_graph_rejects_untrusted_project_root` | project_path 非 GalStudio 项目 → `is_err()` |
| `save_graph_rejects_node_file_outside_content_dir` | 某节点 file=`"../../x"` → `is_err()`，且**不**写盘（graph.json 不变） |
| `delete_file_removes_target_under_content` | 删 `nodes/a.json` → 文件消失 |
| `delete_file_is_idempotent_for_missing_file` | 删不存在的文件 → `Ok(())` |
| `delete_file_rejects_path_traversal` | rel=`../../x` → `is_err()` |
| `delete_file_rejects_untrusted_project_root` | 非 GalStudio 项目 → `is_err()` |
| `save_graph_then_open_project_roundtrip` | save_graph 后 open_project 读回的 graph 与存入一致（synthetic=false） |

### 前端（Vitest，`graphEditing.test.ts`）

| 测试名 | 断言要点 |
|--------|---------|
| `addNode appends node with given id/file` | 节点入列，id/file 正确 |
| `removeNode removes node and its edges` | 节点消失，关联边（from/to=该 id）也消失，返回 removedFile |
| `removeNode returns null removedFile when node missing` | 不存在节点 → 图不变，removedFile=null |
| `connectNodes adds edge with stable id` | edge id=`from__to`，重复连接幂等 |
| `renameNode updates title only` | title 变，id/file/position 不变 |
| `moveNode updates position` | 仅目标节点 position 变 |
| `removeEdge removes by id` | 指定边消失 |
| `generateNodeId dedupes against existing` | "node"→"node_2"→"node_3" |
| `defaultPosition offsets from existing nodes` | 非负、与已有节点不重叠（基本断言） |

## 7. 验收标准

1. 「+ 新建节点」→ 画布出现新节点 + `content/nodes/<id>.json`（内容 `[]`）创建 + graph.json 更新。
2. 拖动节点改位置 → 停下约 400ms 后 graph.json 的 position 更新（防抖）；重开项目位置保留。
3. 从节点 A 拉到节点 B → 出现边；graph.json 出现对应 edge；重复拉不产生重复边。
4. inspector 改标题 → 保存后 graph.json 的 title 更新，id/文件名不变。
5. 选中节点 + Delete → 确认后节点+关联边消失 + 节点文件删除；graph.json 更新。
6. 选中边 + Delete → 边消失，节点保留。
7. 合成图项目：inspector/工具栏出现「固化图结构」→ 点击后 `content/graph.json` 生成，重开为真实图项目。
8. `node.file` 越界的图保存被后端拒绝（前端显示错误，不破坏现有 graph.json）。

## 8. 边界情况

| 情况 | 处理 |
|------|------|
| 节点文件删除失败（权限等） | 图已更新，文件残留并 warn；不阻断用户（§4.2d） |
| 拖拽中外部更新图 | 防抖存图可能覆盖外部改动；本期接受（外部改 graph.json 时用户也在编辑属冲突，Phase 6 提示） |
| 删除 entry 节点 | 允许删，entryNodeId 可能变悬空；Phase 6 校验标错并提示重设 |
| 自环边（from==to） | 前端 `connectNodes` 允许（流程图偶有自环）；Phase 6 可校验 |
| 删除被边引用的节点 | `removeNode` 自动清关联边（§4.1） |
| 合成图固化后仍指向 chapters 文件 | 正常，语义一致（§4.4） |

## 9. 不在本期范围

- `graphIssues` 校验与可操作错误（Phase 6）。
- 撤销/重做。
- 拖拽冲突的细粒乐观锁（本期接受「最后写入胜」）。
- 批量操作。
