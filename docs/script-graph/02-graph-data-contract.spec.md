# Phase 2 — 图数据契约（Graph Data Contract）规格

> 状态：完成。
> 前置：已读 [overview.md](./overview.md)（尤其 §2 数据模型、§3 类型、§4 路径安全）。
> 本阶段定义的是**当前真实契约**：`content/graph.json` 是入口；缺失时报 issue，不再合成旧 chapters。

## 1. 需求

后端能：

1. 当 `content/graph.json` 存在时，加载图结构并按 `node.file` 读取各节点指令文件。
2. 当 `content/graph.json` 缺失时，返回空图，并在 `graphReport` / `projectReport` 中记录 `missing_graph`。
3. 当 `content/meta.json` 仍带 `chapters` 或存在 `content/chapters/` 时，记录 `legacy_chapters_not_supported`，但**不**读取、不合成。
4. 复用既有路径安全防护，拒绝 `node.file` 越界。
5. 单个节点文件缺失时不整体失败，返回 `NodeEntry.data = None` 并给出告警。

前端拿到扩展后的 `ProjectData`（`graph`、`nodes`，以及 `graphReport` / `projectReport`）。

## 2. 数据模型变更

### 2.1 Rust（`lib.rs`）

新增结构（定义见 [overview.md §3.2](./overview.md)）：`GraphPosition`、`GraphNode`、`GraphEdge`、`ProjectGraph`、`NodeEntry`。

`ProjectData` 增加两个主要字段，Rust 侧用 `Option` 表达兼容空间；`open_project()` 正常会填入 `Some(graph)` / `Some(nodes)`：

```rust
#[derive(Serialize, Clone)]
pub struct ProjectData {
    pub path: String,
    pub meta: ProjectMeta,
    pub content: ProjectContent,
    #[serde(rename = "rendererIds")]
    pub renderer_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graph: Option<ProjectGraph>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodes: Option<Vec<NodeEntry>>,
    #[serde(rename = "graphReport", skip_serializing_if = "Option::is_none")]
    pub graph_report: Option<GraphReport>,
    #[serde(rename = "projectReport", skip_serializing_if = "Option::is_none")]
    pub project_report: Option<ProjectReport>,
}
```

### 2.2 前端（`lib/types.ts`）

新增类型 `GraphNode` / `GraphEdge` / `ProjectGraph` / `NodeEntry`（见 [overview.md §3.1](./overview.md)）。
`ProjectData` 的前端类型使用 `graph?` / `nodes?` / `graphReport?` / `projectReport?`。

## 3. 行为规格：`open_project()` 扩展

`open_project` 的图数据加载逻辑由 `load_project_graph_data()` 负责。
与旧方案不同的是：**不存在 `graph.json` 时不合成旧 chapters**，而是返回空图 + issue。

### 3.1 判定主流程

```text
graph_path = content_dir.join("graph.json")
if graph_path.is_file():
    load graph.json + node files
else:
    return empty graph + missing_graph issue
```

### 3.2 `graph.json` 存在时

```text
1. 读取 graph.json
2. 解析 version / entryNodeId / nodes / edges
3. 逐个读取 node.file 对应的节点指令文件
4. 对缺失文件返回 NodeEntry.data = None，不整体失败
5. 对越界路径、JSON 非法、必填字段缺失返回 Err
6. 返回 ProjectGraph + Vec<NodeEntry> + graph issues
```

当前契约中，`entryNodeId` 缺失字段仍是硬错误；若字段存在但指向不存在节点，则保留到 `graphReport` 里报 `missing_entry_node`。

### 3.3 `graph.json` 缺失时

```text
graph = empty_project_graph()
nodes = []
graph_issues = [missing_graph]
```

空图的 `entryNodeId` 为空字符串，方便下游统一判空；但这不是“合成图”，只是缺省返回值。

### 3.4 旧 chapters

只要 `content/meta.json` 里出现 `chapters` 或磁盘上存在 `content/chapters/`，就记录 `legacy_chapters_not_supported`。
它们是历史数据，不再参与加载路径，也不会驱动 UI。

### 3.5 路径安全

`node.file` 一律经 `resolve_relative_under(&content_root, &node.file)`。
内部 `safe_relative_path` 拒绝 `..` / 绝对路径 / 驱动器前缀，越界返回 `Err("路径越界：...")`。

## 4. 前端包装

`lib/tauri.ts` 的 `openProject()` 签名不变（`Promise<ProjectData>`）。
前端本期已经可以消费 `graph` / `nodes` / `graphReport`，`refreshProject()` 通过 `openProject()` 重读最新项目数据。

## 5. 测试清单（TDD，先写测试）

### Rust 测试

| 测试函数名 | 断言要点 |
|-----------|---------|
| `open_project_loads_graph_when_present` | 有 `graph.json` + 2 节点文件 → `graph` / `nodes` 正常，`graph_report` 存在 |
| `open_project_reports_missing_graph_without_fallback` | 无 `graph.json` → 返回空图，`graphIssues` 含 `missing_graph` |
| `open_project_reports_legacy_chapters_as_issue_only` | 仅有 `chapters` → 报 `legacy_chapters_not_supported`，不合成图 |
| `open_project_rejects_graph_node_file_outside_content_dir` | `node.file = "../../outside.json"` → `is_err()` |
| `open_project_skips_missing_node_file_with_warning` | graph 声明 2 节点但只存在 1 文件 → 不 err，对应 `NodeEntry.data` 一条为 `None` |
| `open_project_rejects_graph_json_without_entry_node_id` | graph.json 缺 `entryNodeId` → `is_err()` |
| `open_project_reports_missing_entry_node_in_graph_report` | `entryNodeId` 指向不存在节点 → `open_project` 仍 `Ok`，但 `graph_report` 含 `missing_entry_node` |
| `open_project_does_not_mutate_disk` | 打开项目不会写入 `content/graph.json` 或改写旧文件 |

> 既有测试（例如 legacy chapters 的 issue 报告）必须继续通过，且不再出现旧章节合成图的断言。

## 6. 验收标准

1. 打开含 `graph.json` 的项目时，`graph` 与 `nodes` 正常返回，节点文件缺失只报 issue。
2. 打开缺少 `graph.json` 的项目时，不会合成旧 chapters，只返回空图 + `missing_graph`。
3. 旧 `chapters` 数据只进入 issue，不进入 UI 数据源。
4. `node.file` 越界依然会被拒绝。
5. 前端 `tsc` 通过，后续 phase 直接消费 `project.graph` / `project.nodes` / `graphReport`。

## 7. 不在本期范围

- 图/节点的写入命令（Phase 5）。
- `graphIssues` 的细化可视化（Phase 6）。
- 整图播放与分支语义（后续 phase）。
