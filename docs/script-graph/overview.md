# Overview — 横切决策与统一模型

> 本文档锁定所有 phase spec 共享的横切决策。**每个 phase spec 都假设你已读过本文。**
> 锁定项标注 🔒（实现时不应随意偏离）；标注 🟡 的为「当前如此，可 revisit」。

## 1. 已锁定的横切决策

### 🔒 1.1 节点文件复用引擎现有指令数组格式

节点文件（`content/nodes/<id>.json`）存的就是引擎现有的指令数组：

```json
[
  { "t": "bg", "id": "ocean_night", "trans": "fade", "ms": 1200 },
  { "t": "say", "who": "protagonist", "expr": "default", "text": "……我是谁？", "ms": 1800 }
]
```

- **格式 = `Instruction[]`**，沿用 `packages/engine/src/schema.ts` 的 `t` 判别联合（`bg`/`bgm`/`sfx`/`voice`/`char`/`say`/`narrate`/`wait`/`effect`/`transition`）。
- **否决**早期草案里的 `{ "type": "say", "speaker": ... }`。那只是示意，不是契约。
- 好处：`validateContent`、`NovelPlayer`、`InstructionSchema`、`useProjectPlayer` 全部零改写复用；
  外部 AI agent 写节点时可直接参考既有 schema，且预览/校验链路天然打通。

### 🟡 1.2 节点粒度由作者决定（推荐场景级）

不强制「节点 = 章节」或「节点 = 场景」。一个节点就是一段 `Instruction[]`，长短随意。
- **迁移约定**：从既有 `meta.chapters` 合成线性图时，按 **1 章 = 1 节点**（见 Phase 2）。
- 创作时作者可把一章拆成多个节点，也可把多章合一个节点。

### 🔒 1.3 预览只播放「选中节点」

- 把选中节点当作**单章节**喂给 `NovelPlayer` 播放（`chapters: [{ file: node.file, data: nodeData }]`）。
- 整图从 entry 遍历播放留作后续扩展（引擎当前无 `choice` 分支指令，无法沿 edge 分支推进）。
- meta 级播放参数（`typingSpeedCps` 等）仍从 `content/meta.json` 取。

### 🔒 1.4 画布用 React Flow (`@xyflow/react`)

- Phase 3 起引入 `@xyflow/react` 作为画布库（当前前端**零 UI 依赖**，这是第一个）。
- 选型理由：节点编辑器事实标准，内置 pan/zoom/connect/minimap/键盘。
- 约定：把 `project.graph` 通过纯函数映射成 React Flow 的 `nodes`/`edges`，
  编辑动作（拖拽/连线/删除）反向写回 `project.graph` 再落盘。映射层是纯函数、可单测。

### 🟡 1.5 edge.condition 当前恒为 null

- `graph.json` 的 `edge.condition` 字段保留为 `null`，引擎目前没有 `choice` 指令，无法表达分支条件。
- spec 中保留该字段位，分支/选项作为后续扩展点显式标注，本期不实现分支语义。

### 🔒 1.6 热重载无需新增 watch 路径

新增的 `content/graph.json` 与 `content/nodes/*.json` 都落在 watcher 现有的
`content/` → `Content` 分类分支内（见 `lib.rs:626-647` 的 `classify_project_watch_path`）。
**Phase 2 不改 watcher**，仍走既有 300ms debounce → `project_changed` 事件链路。

---

## 2. 统一数据模型（全 phase 共用）

### 2.1 磁盘结构

```text
content/
  manifest.json          # 已有，资源表（不动）
  meta.json              # 已有，全局播放参数（不动）
  chapters/              # 已有，旧章节（兼容保留）
    ch01.json
  graph.json             # 【新】叙事结构图（可选）
  nodes/                 # 【新】节点指令文件目录（可选）
    prologue.json
    first_meeting.json
```

`graph.json` 与 `nodes/` 都是**可选**的。判据见 §2.3。

### 2.2 `graph.json` schema

```json
{
  "version": 1,
  "entryNodeId": "prologue",
  "nodes": [
    { "id": "prologue", "title": "序章", "file": "nodes/prologue.json",
      "position": { "x": 120, "y": 180 } }
  ],
  "edges": [
    { "id": "prologue__first_meeting", "from": "prologue", "to": "first_meeting",
      "condition": null }
  ]
}
```

- `node.id`：稳定标识（kebab/snake_case，文件名友好的片段）。id 全局唯一。
- `node.file`：相对 `content/` 根的路径（如 `nodes/prologue.json`），受路径安全约束（§4）。
- `node.position`：画布坐标 `{x, y}`，单位 px。
- `edge.id`：稳定标识，约定 `<from>__<to>`（双下划线分隔，避免与 id 内的 `_` 冲突）。
- `edge.condition`：当前恒为 `null`，保留位。
- `entryNodeId`：起点节点 id，必须在 `nodes` 中存在。

### 2.3 判据：图模式 vs 旧章节模式（非破坏式）

打开项目时后端按以下顺序判定，**绝不擅自改写既有项目文件**：

1. `content/graph.json` 存在 → **图模式**：加载图 + 按 `node.file` 读节点文件。
2. `graph.json` 缺失但 `content/meta.json` 有 `chapters` → **合成模式**：在内存合成线性图
   （1 章 = 1 节点，id = 文件名 stem 去重，位置自动网格铺排，entry = 首节点，线性 edges），
   **不写盘**。`project.graph.synthetic = true` 标记。
3. 两者都没有 → 空图（`nodes: []`）。

「转为图项目」的显式落盘动作留作后续（见 Phase 5 的「固化」操作），不在打开时触发。

### 2.4 `open_project()` 响应扩展

`ProjectData` 新增两个可选字段（**不新增命令**，只扩字段，旧前端忽略多余字段不受影响）：

```ts
// 前端 lib/types.ts
export interface ProjectData {
  path: string;
  meta: ProjectMeta;
  content: { manifest: unknown; meta: unknown; chapters: { relPath: string; data: unknown }[] };
  rendererIds: string[];
  // ── 新增 ──
  graph?: ProjectGraph;        // 图结构；合成模式下 synthetic=true
  nodes?: NodeEntry[];          // 各节点的指令数据（按 graph.nodes 的 file 读取）
}
```

完整 TS 类型见 §3。

---

## 3. 共享 TS / Rust 类型定义

> 这些定义在 Phase 2 落地（`lib/types.ts` + `lib.rs`），后续 phase 直接引用。

### 3.1 前端（`packages/studio/src/lib/types.ts`）

```ts
/** 图节点（graph.json 中的一项） */
export interface GraphNode {
  id: string;
  title: string;
  file: string;                 // 相对 content 根，如 "nodes/prologue.json"
  position: { x: number; y: number };
}

/** 图边 */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  condition: unknown | null;     // 当前恒 null
}

/** 完整图 */
export interface ProjectGraph {
  version: number;
  entryNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** true = 内存从 chapters 合成，graph.json 不存在 */
  synthetic?: boolean;
}

/** 单个节点的指令数据（open_project 已读好的） */
export interface NodeEntry {
  relPath: string;               // = graph node 的 file
  data: unknown | null;          // null = 文件缺失/读取失败
}
```

### 3.2 后端（`packages/studio/src-tauri/src/lib.rs`）

```rust
#[derive(Serialize, Clone)]
pub struct GraphPosition { pub x: f64, pub y: f64 }

#[derive(Serialize, Clone)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub file: String,
    pub position: GraphPosition,
}

#[derive(Serialize, Clone)]
pub struct GraphEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub condition: serde_json::Value,   // Value::Null
}

#[derive(Serialize, Clone)]
pub struct ProjectGraph {
    pub version: u32,
    #[serde(rename = "entryNodeId")]
    pub entry_node_id: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub synthetic: bool,
}

#[derive(Serialize, Clone)]
pub struct NodeEntry {
    #[serde(rename = "relPath")]
    pub rel_path: String,
    pub data: Option<serde_json::Value>,   // None = 文件缺失
}
```

`ProjectData` 增加 `#[serde(skip_serializing_if = "Option::is_none")]` 的 `graph` 与 `nodes` 字段。

---

## 4. 路径安全约定（全 phase 复用）

所有涉及 `content/` 下文件读写的操作**必须复用** `lib.rs` 既有的集中式防护，**不得另起炉灶**：

| 操作 | 复用函数 |
|------|----------|
| 校验项目根 | `canonical_project_root` |
| 解析相对路径（graph node.file、节点 rel_path） | `resolve_relative_under`（内部用 `safe_relative_path`） |
| 写文件前再校验落点 | `ensure_existing_path_within` |
| 单段名校验（新建节点 id） | `validate_plain_name` |

- `node.file` 必须解析后落在 `content/` canonical 根之下。越界（如 `../../etc/x`）直接报错，
  复用既有错误信息风格（中文，含「路径越界」）。
- 新增命令（Phase 5 的 `save_graph` / `delete_file`）沿用同样的三段式：`canonical_project_root`
  → `resolve_relative_under` → `ensure_existing_path_within`。

---

## 5. 热重载约定

- **新增文件无需改 watcher**（§1.6）：`content/graph.json`、`content/nodes/*` 已被现有
  `content/` 递归 watch 覆盖。
- `project_changed` 事件触发后，前端 `refreshProject()` 重新 `openProject()`，自动拿到最新
  `graph` + `nodes`，图视图/节点编辑器/单节点预览随之刷新（靠 `refreshKey` remount）。
- 外部 AI 新建节点文件 + 改 graph.json 的场景：一次 debounce 合并 → 一次 `project_changed`
  → 一次全量刷新。无需重开项目。

---

## 6. 测试约定（TDD，遵守 AGENTS.md）

- **Rust**：沿用 `lib.rs:771` 的内联 `#[cfg(test)] mod tests`，行为命名（`fn xxx_yyy_zzz`），
  纳秒时间戳临时目录（`unique_temp_dir`），用完 `fs::remove_dir_all`。每个新增命令/分支必须有对应测试。
- **前端**：Vitest。纯逻辑 helper（图映射、布局、编辑 reducer）单测；React 组件本期不加
  testing-library（既有前端测试都是纯逻辑、`environment: node`）。
- 每个 phase spec 的「测试清单」章节列出**测试函数名**与断言要点，作为 TDD 先写测试的依据。

---

## 7. 命名与目录约定

- 后端命令：Rust `snake_case`，`#[tauri::command]` 暴露同名 JS；前端 `lib/tauri.ts` 用 `camelCase` 包装。
- 前端目录：新工作台相关放 `packages/studio/src/features/script/`（图视图、节点编辑器、hooks）；
  `Workspace.tsx` 留作顶栏壳。
- 组件命名：`export function` 具名导出（沿用既有约定），hook 用 `useXxx.ts` 放在消费者旁。
- 样式：沿用内联 `React.CSSProperties` + 模块级 `const xxxStyle`，深色主题色值与 `Workspace.tsx` 一致
  （背景 `#0e1116`、边框 `#232a38`、强调 `#9fc8e3`/`#3a6ea5`）。

---

## 8. 未解决问题（plan 文档 Open Questions 的处置）

| plan 提出的问题 | 本规格的处置 |
|----------------|--------------|
| 节点 = 章/场景/任意？ | 🟡 任意，推荐场景级；迁移时 1 章=1 节点（§1.2） |
| 选项放节点内/边上/两者？ | 🔒 当前放节点内（沿用 `Instruction`，引擎暂无 choice）；edge.condition 保留位，分支留后续 |
| 预览播放选中节点还是整图？ | 🔒 选中节点（§1.3），整图播放留后续 |
| Render 是工作台还是右侧面板？ | 🟡 Phase 1 先做成工作台（保住既有预览体验），后续可降级为面板 |
