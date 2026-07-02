# Phase 2 — 图数据契约（Graph Data Contract）规格

> 前置：已读 [overview.md](./overview.md)（尤其 §2 数据模型、§3 类型、§4 路径安全）。
> 本阶段是**后端核心**，几乎所有后续 phase 依赖它。**严格 TDD**（AGENTS.md 要求）。

## 1. 需求

后端能：

1. 当 `content/graph.json` 存在时，加载图结构并按 `node.file` 读取各节点指令文件。
2. 当 `graph.json` 缺失但 `content/meta.json` 有 `chapters` 时，在**内存**合成线性图（不写盘）。
3. 缺节点文件时跳过并告警，不整体失败。
4. 复用既有路径安全防护，拒绝 `node.file` 越界。

前端拿到扩展后的 `ProjectData`（多 `graph` + `nodes` 字段）。

## 2. 数据模型变更

### 2.1 Rust（`lib.rs`）

新增结构（定义见 [overview.md §3.2](./overview.md)）：`GraphPosition`、`GraphNode`、`GraphEdge`、
`ProjectGraph`、`NodeEntry`。

`ProjectData` 增加两个字段，Rust 侧用 `Option` 表达兼容空间；Phase 2 的 `open_project()` 正常应始终填入
`Some(graph)` / `Some(nodes)`，即使只是从旧章节合成的空图：

```rust
#[derive(Serialize, Clone)]
pub struct ProjectData {
    pub path: String,
    pub meta: ProjectMeta,
    pub content: ProjectContent,
    #[serde(rename = "rendererIds")]
    pub renderer_ids: Vec<String>,
    // ── 新增：图模式数据；Phase 2 起由 open_project 填 Some(...) ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph: Option<ProjectGraph>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<NodeEntry>>,
}
```

> `skip_serializing_if` 是兼容兜底；真实 Phase 2 行为以 §3.6 为准：旧章节项目也返回 `synthetic: true` 的图。

### 2.2 前端（`lib/types.ts`）

新增类型 `GraphNode` / `GraphEdge` / `ProjectGraph` / `NodeEntry`（见 [overview.md §3.1](./overview.md)）。
`ProjectData` 的前端类型可暂写成 `graph?` / `nodes?`，但 Phase 2 之后的正常后端响应应带上这两个字段。

## 3. 行为规格：`open_project()` 扩展

在既有 `open_project`（`lib.rs:183-259`）**末尾、构造 `ProjectData` 之前**插入图加载逻辑。
**不新增命令**，只扩字段。既有 chapters/manifest/meta 加载逻辑**不动**（合成模式会复用已加载的 chapters）。

### 3.1 判定主流程

```text
graph_path = content_dir.join("graph.json")
if graph_path.is_file():
    mode = GraphMode::File            # 读 graph.json
else:
    mode = GraphMode::Synthetic       # 从 chapters 合成
```

### 3.2 GraphMode::File（有 graph.json）

```text
1. graph_raw = read_json(graph_path)            # 复用既有 read_json，JSON 非法直接 Err
2. version = graph_raw["version"].as_u64().unwrap_or(1)
3. entry_node_id = graph_raw["entryNodeId"].as_str()  (必填，缺失 → Err)
4. nodes[]:
     for n in graph_raw["nodes"]:
         id    = n["id"]   (必填非空 str)
         title = n["title"].as_str().unwrap_or(&id)   # 缺失用 id 兜底
         file  = n["file"] (必填 str)
         pos   = n["position"]["x"/"y"].as_f64().unwrap_or(0.0)
         → 推入 GraphNode
5. edges[]:
     for e in graph_raw["edges"]:
         id    = e["id"]
         from  = e["from"]
         to    = e["to"]
         cond  = e.get("condition").unwrap_or(Null)
         → 推入 GraphEdge
6. 读取节点指令文件：
     nodes_data = []
     for node in nodes:
         node_path = resolve_relative_under(&content_root, &node.file)?   # 路径安全
         if node_path.exists():
             data = read_json(&node_path)?                                # 复用
             nodes_data.push(NodeEntry{ rel_path: node.file, data: Some(data) })
         else:
             log::warn!("节点 {} 的文件 {} 不存在，已跳过", node.id, node.file)
             nodes_data.push(NodeEntry{ rel_path: node.file, data: None })
7. graph = ProjectGraph { version, entry_node_id, nodes, edges, synthetic: false }
```

**容错策略**（关键设计）：
- JSON 非法（`graph.json` 整体解析失败）→ **整体 Err**（让用户/外部 agent 知道图坏了）。
- 单个节点**文件缺失** → **不**整体失败，`data: None`，warn。（节点文件可由外部 agent 稍后生成。）
- 单个节点**文件 JSON 非法** → **整体 Err**，与既有 chapter 读取行为一致，避免坏指令被静默吞掉。
- `node.file` **越界**（路径安全）→ **整体 Err**（潜在攻击/损坏，必须暴露）。
- `entryNodeId` 缺失/指向不存在的 node → 本阶段**不**校验（Phase 6 的 `graphIssues` 负责），但 `entry_node_id` 字段必须能从 JSON 取到（取不到则 Err）。

### 3.3 GraphMode::Synthetic（无 graph.json，有 chapters）

复用**已加载的** `chapters: Vec<ChapterEntry>`（§3.1 之前已加载完），合成：

```text
synthetic_nodes = []
synthetic_edges = []
prev_id = None
for (i, ch) in chapters.enumerate():
    # id = 文件名 stem，去重
    stem = ch.rel_path 文件名去扩展名            # "chapters/ch01.json" → "ch01"
    id = ensure_unique(stem, 已用 id 集合)        # 冲突则 "_2"、"_3"…
    title = stem.clone()
    file = ch.rel_path.clone()
    position = auto_layout(i)                     # 网格铺排，见 §3.4
    push GraphNode{ id, title, file, position }
    if let Some(prev) = prev_id:
        push GraphEdge{ id: format!("{}__{}", prev, id), from: prev, to: id, condition: Null }
    prev_id = Some(id)

entry_node_id = synthetic_nodes.first().id  (无节点则 "")
graph = ProjectGraph {
    version: 1,
    entry_node_id,
    nodes: synthetic_nodes,
    edges: synthetic_edges,
    synthetic: true,
}
nodes = chapters.map(|ch| NodeEntry{ rel_path: ch.rel_path, data: Some(ch.data.clone()) })
```

- `synthetic: true` 让前端能区分「这是临时合成」vs「真实图项目」。
- `data` 直接复用已读到的 `ch.data`，不重复读盘。
- **空 chapters** → `nodes: []`、`edges: []`、`entry_node_id: ""`，仍返回 `synthetic: true` 的图。

### 3.4 `auto_layout(i)` 网格铺排

固定网格，避免节点重叠：

```text
COLS = 3
GAP_X = 260.0
GAP_Y = 160.0
MARGIN = 80.0
row = i / COLS
col = i % COLS
position = { x: MARGIN + col * GAP_X, y: MARGIN + row * GAP_Y }
```

常量在文件顶部，便于测试断言。

### 3.5 `ensure_unique`

```text
base = stem
candidate = base
n = 2
while candidate ∈ used:
    candidate = format!("{}_{}", base, n)
    n += 1
used.insert(candidate)
return candidate
```

### 3.6 既无 graph.json 也无 chapters

仍返回一个合成空图（`synthetic: true`, `nodes: []`），而不是 `None`——
让前端始终能拿到 `project.graph`，简化下游判空。`entry_node_id = ""`。

## 4. 路径安全（复用，overview §4）

- `node.file` 一律经 `resolve_relative_under(&content_root, &node.file)`。
  内部 `safe_relative_path` 拒绝 `..`/绝对/前缀路径，越界返回 `Err("路径越界：...")`。
- **不**新增任何路径校验函数。

## 5. 前端包装

`lib/tauri.ts` 的 `openProject()` **签名不变**（返回类型仍是 `Promise<ProjectData>`，
只是 `ProjectData` 多了可选字段）。无需新增包装函数。

前端本期**暂不消费** `graph`/`nodes`（Phase 3+ 才用），但类型先就位，便于 Phase 3 直接用。

## 6. 测试清单（TDD，先写测试）

全部加在 `lib.rs` 的 `#[cfg(test)] mod tests`（`lib.rs:771`），复用既有 `unique_temp_dir` /
`write_text` / `write_minimal_project` helper。可能需要**新增一个**测试 helper：

```rust
/// 写一个带 graph.json + nodes/ 的完整图项目到 dir
fn write_graph_project(dir: &Path, graph_json: serde_json::Value, nodes: &[(&str, serde_json::Value)])
```

### Rust 测试

| 测试函数名 | 断言要点 |
|-----------|---------|
| `open_project_loads_graph_when_present` | 有 `graph.json` + 2 节点文件 → `graph.synthetic == false`，`nodes` 含两条 data，entry 正确 |
| `open_project_synthesizes_linear_graph_from_chapters` | 无 graph.json，meta.chapters 有 3 章 → `graph.synthetic == true`，3 节点 + 2 线性边，entry=首节点 |
| `open_project_synthesizes_graph_even_when_no_chapters` | 无 graph.json 无 chapters → `graph.synthetic == true`, `nodes.is_empty()`, `entry_node_id == ""` |
| `open_project_rejects_graph_node_file_outside_content_dir` | node.file = `"../../outside.json"` → `is_err()`（复用既有路径越界断言风格） |
| `open_project_skips_missing_node_file_with_warning` | graph 声明 2 节点但只存在 1 文件 → 不 err，对应 `nodes` 条目 `data.is_none()`，另一条 `data.is_some()` |
| `open_project_rejects_graph_json_without_entry_node_id` | graph.json 缺 `entryNodeId` → `is_err()` |
| `synthesized_graph_assigns_unique_node_ids` | 两个章节文件名 stem 相同（如 `a/ch01.json` 和 `b/ch01.json`）→ 合成 id 不重复（第二个变 `ch01_2`） |
| `synthesized_graph_auto_layout_is_deterministic` | 节点 i 的 position 仅依赖 i，符合 §3.4 公式（断言第 0 个在 margin，第 3 个换行） |
| `open_project_graph_mode_does_not_mutate_disk` | 图模式 + 合成模式分别打开后，`content/` 下**不**新增 `graph.json`（非破坏式） |

> 既有测试（`open_project_rejects_meta_chapter_paths_outside_content_dir` 等）必须**继续通过**——
> 扩字段是叠加式改动，不动既有 chapters 加载。

## 7. 验收标准

1. `cargo test` 全绿（含上述新测试 + 既有 6 个测试）。
2. `examples/sample-novel`（无 graph.json）打开后返回 `graph.synthetic === true` 的线性图，
   节点数 = chapters 数，不产生 `content/graph.json` 文件。
3. 手造一个带 `graph.json` + `nodes/` 的项目，打开后 `graph.synthetic === false`，节点数据正确。
4. 手造 `node.file` 越界的 graph.json，打开报「路径越界」错。
5. 前端 `tsc` 通过（类型就位），既有预览/编辑行为不回归（Phase 1 的三工作台正常）。

## 8. 边界情况汇总

| 情况 | 处理 |
|------|------|
| `graph.json` 整体 JSON 非法 | `Err`（暴露损坏） |
| `graph.json` 缺 `entryNodeId` | `Err` |
| `graph.json` 的 node 缺 `id`/`file` | `Err`（必填字段缺失） |
| `graph.json` 的 node 缺 `title`/`position` | title 用 id 兜底，position 用 0,0 兜底 |
| 节点文件缺失 | `data: None` + warn，不 err |
| 节点文件 JSON 非法 | `Err`（`read_json` 抛）—— 与 chapter 行为一致，损坏即暴露 |
| `node.file` 越界 | `Err`（路径安全） |
| 无 graph.json 无 chapters | 合成空图，`entry_node_id == ""` |
| 重复 stem 的章节 | `ensure_unique` 去重 |

## 9. 不在本期范围

- 前端消费 `graph`/`nodes`（Phase 3）。
- 图/节点的**写入**命令（Phase 5）。
- `graphIssues` 校验（Phase 6）。
- 「转为图项目」显式落盘（Phase 5）。
