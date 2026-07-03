# Phase 6 — 外部数据操作（External Data Operations）规格

> 前置：Phase 2（数据契约）、Phase 5（图编辑/写入）。
> 已读 [overview.md](./overview.md)（§1.6 热重载、§5 热重载约定）。
> 本阶段面向外部工具/Agent 直接编辑项目数据的工作流：可操作的校验错误 + 外部刷新指示 + schema 文档。
> 后端扩展 `open_project` 输出校验问题（叠加式，不阻断加载），前端展示。

GalStudio 的产品边界是项目数据的可视化、编辑、校验和热重载。外部 Agent 可以直接修改 `content/` 与
`renderers/` 下的项目文件；GalStudio 不内置 AI 调用、不生成 AI 任务文件、不提供 AI 连接入口。

这不是“不服务 AI coding”。相反，外部 AI coding 体验是一等目标；增强方式应落在清晰的数据契约、稳定的文件布局、
schema 文档、校验报告、热重载、CLI 校验命令、机器可读错误和可预测的落盘行为上，而不是在编辑器内增加一个需要用户再回到
Codex/Claude Code 的中转按钮，也不是让用户复制问题文本在应用之间搬运。

## 1. 需求

1. 图/节点数据有问题时，给出**精确、可操作**的错误（指到具体 node id / edge id / 字段）。
2. 外部工具/Agent 改动文件后，界面有**可见的刷新/同步状态指示**。
3. 文档化 graph/节点 schema（供外部工具/Agent 和人工编辑参考）。
4. 提供有利于外部 AI coding 的 CLI 校验闭环，但不提供任何应用内 AI 协作入口；外部 Agent 的工作方式是直接改项目数据文件。

校验是**非致命**的：坏图仍能加载（带 issues），让用户或外部工具看到「哪里坏」而不是黑屏报错。

## 2. 后端：`graphIssues` 扩展（`lib.rs`）

### 2.1 数据结构

```rust
#[derive(Serialize, Clone, Copy)]
pub enum GraphIssueSeverity { #[serde(rename="error")] Error, #[serde(rename="warn")] Warn }

#[derive(Serialize, Clone)]
pub struct GraphIssue {
    pub severity: GraphIssueSeverity,
    pub code: String,            // 稳定错误码，如 "dangling_edge"/"missing_node_file"
    pub message: String,         // 人类可读（中文），含具体 id/字段
    #[serde(rename = "nodeId", skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(rename = "edgeId", skip_serializing_if = "Option::is_none")]
    pub edge_id: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct GraphReport {
    #[serde(rename = "graphIssues")]
    pub graph_issues: Vec<GraphIssue>,
}
```

`ProjectData` 增加可选字段：

```rust
#[serde(skip_serializing_if = "Option::is_none")]
pub graph_report: Option<GraphReport>,
```

### 2.2 校验函数 `validate_graph`

新增纯函数（不依赖 IO，便于单测）：

```rust
/// 校验图结构一致性。nodes_data 用于判断节点文件是否存在。
fn validate_graph(
    graph: &ProjectGraph,
    nodes_data: &[NodeEntry],   // 与 graph.nodes 同序
) -> Vec<GraphIssue>
```

校验项（每项独立、叠加）：

| code | severity | 触发条件 | message 示例 |
|------|----------|----------|-------------|
| `duplicate_node_id` | error | 两个 node 同 id | `节点 id 重复：prologue` |
| `missing_node_file` | warn | 节点对应 NodeEntry.data == None | `节点「序章」的文件 nodes/x.json 不存在` |
| `dangling_edge` | warn | edge.from 或 to 指向不存在的 node id | `边的端点不存在：edge prologue__x 引用了缺失节点 x` |
| `missing_entry_node` | error | entryNodeId 非空但不在 nodes 中 | `入口节点 entry 不存在` |
| `empty_entry` | warn | entryNodeId == "" 且 nodes 非空 | `未设置入口节点` |
| `duplicate_edge_id` | warn | 两个 edge 同 id | `边 id 重复：a__b` |

- 重复 id 只报一次（去重后报告）。
- severity=error 的项**不**阻断加载（仍返回图 + issues），仅用于高亮提示。
  （区别于 Phase 2 的硬错误：JSON 非法/路径越界/必填缺失仍 `Err`。）

### 2.3 接入 `open_project`

在 Phase 2 图加载（§3.1-3.3）之后调用：

```rust
let issues = validate_graph(&graph, &nodes_data);
let graph_report = GraphReport { graph_issues: issues };
// 塞入 ProjectData.graph_report
```

- 合成图（`synthetic: true`）也校验（理论上不会有悬空边/缺失文件，但重复 stem id 兜底去重后仍可能有 `duplicate_node_id` 残留——实际 `ensure_unique` 已防住，校验作为二次保险）。
- `graph_report` 始终存在（图模式下），即使 issues 为空数组。

## 3. 前端：问题面板与刷新指示

### 3.1 类型（`lib/types.ts`）

```ts
export type GraphIssueSeverity = "error" | "warn";
export interface GraphIssue {
  severity: GraphIssueSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}
export interface GraphReport { graphIssues: GraphIssue[]; }
// ProjectData 增加 graphReport?: GraphReport;
```

### 3.2 `GraphIssuesPanel.tsx`（新增，右栏 inspector 下方或独立区）

- 列出 `project.graphReport.graphIssues`，按 severity 分组（error 红、warn 黄）。
- 每条可点击：若带 `nodeId` → 选中该节点 + 滚动画布到该节点；若带 `edgeId` → 选中该边。
- 无问题：显示「✓ 图结构正常」。
- 与 NodeInspector 共存：inspector 显示选中节点属性，issues 面板显示全局问题。

### 3.3 画布上的问题可视化

- `dangling_edge` / 悬空：对应 edge 染红 + 虚线（在 `mapGraphToFlow` 时据 issues 标记 `data.suspicious`，`GraphCanvas` 据此设 `style`/`className`）。
- `missing_node_file`：节点 `GraphNodeView` 已在 Phase 3 显示「⚠ 文件缺失」，复用。
- `duplicate_node_id`：重复节点边框闪烁/标红。

### 3.4 刷新/同步指示器（顶栏）

`Workspace.tsx` 顶栏加一个同步状态点：

```text
[● 已同步]   或   [⟳ 同步中…]   或   [⚠ 刷新失败]
```

状态机：

| 状态 | 触发 | 显示 |
|------|------|------|
| `synced`（默认） | 初始 / 刷新成功 | 绿点「已同步」 |
| `syncing` | 收到 `project_changed` 事件、`refreshProject` 进行中 | 旋转「同步中…」 |
| `error` | `refreshProject` 抛错 | 红点「刷新失败（点击重试）」 |

实现：`Workspace` 加 `const [syncState, setSyncState] = useState<"synced"|"syncing"|"error">("synced")`，
在 `refreshProject` 前后置位。这让外部工具/Agent 改动文件时用户**看得见**「同步中→已同步」跳变（AGENTS.md 热重载可见性要求）。

### 3.5 明确不做：应用内 AI 协作

GalStudio 不实现以下能力：

- 不在工具栏、右键菜单或命令面板提供“让 AI 扩展/生成/修复”的入口。
- 不写入 `content/.gal/ai-task.md` 或类似的 AI 任务文件。
- 不连接远程/本地 AI 服务，不保存 AI token，不管理 Agent 会话。

需要 AI 或脚本自动化时，由外部 Agent 直接读写项目数据文件；GalStudio 通过 watcher、schema 文档、issues 面板和 CLI 校验反馈结果。

推荐增强方向：

- issues 面板的每条问题都能暴露稳定 code、nodeId、edgeId、相关文件路径和人类可读 message。
- 文档和 schema 能让外部 Agent 不需要打开应用源码，也能知道怎么新增/修改/删除节点。
- 提供 Agent 可直接调用的 CLI，例如 `galstudio validate <project-path> --format json`。
- CLI 校验失败时使用非零退出码，并向 stdout 输出结构化 JSON：`severity`、`code`、`message`、`nodeId`、`edgeId`、`file`、`jsonPath`。
- CLI 不要求 GalStudio UI 正在运行；它应复用后端项目加载、路径安全和图校验逻辑，避免出现 UI 与 CLI 两套规则。
- 图编辑落盘保持格式稳定，减少外部 diff 噪音。
- 外部改动后尽快刷新，同时尽量保留当前视角、选中节点和错误定位。

## 4. 文档化 schema（供外部工具/Agent）

在 `docs/script-graph/` 新增 `node-and-graph-schema.md`（本 spec 的产出之一，或并入 overview）：

- graph.json 字段表（id/title/file/position/condition/version/entryNodeId）。
- 节点文件 = `Instruction[]`，链接到 `packages/engine/src/schema.ts` 的 `t` 判别联合。
- 一份最小完整示例（graph.json + 一个 node json）。
- 「外部工具/Agent 操作流程」：改 graph.json + 写 nodes/<id>.json → 保存 → GalStudio 自动热重载；
  越界/非法路径会被拒；坏数据进 issues 不崩。

> 本 phase spec 的 §5 即承担此文档职责；如需独立文件，实现时拆出。

## 5. 测试清单（TDD）

### Rust（`lib.rs` 内联 `mod tests`）

`validate_graph` 是纯函数，重点单测（构造 graph + nodes_data 即可，无需 IO）：

| 测试函数名 | 断言要点 |
|-----------|---------|
| `validate_graph_flags_dangling_edge` | edge.to 指向不存在节点 → 一条 `dangling_edge` warn，edgeId 正确 |
| `validate_graph_flags_missing_node_file` | NodeEntry.data == None → `missing_node_file` warn，nodeId 正确 |
| `validate_graph_flags_duplicate_node_ids` | 两个同 id 节点 → `duplicate_node_id` error |
| `validate_graph_flags_missing_entry_node` | entryNodeId 不在 nodes → `missing_entry_node` error |
| `validate_graph_flags_empty_entry_when_nodes_exist` | entryNodeId=="" 且有节点 → `empty_entry` warn |
| `validate_graph_flags_duplicate_edge_id` | 两条同 id 边 → `duplicate_edge_id` warn |
| `validate_graph_clean_graph_has_no_issues` | 合法图 → issues 为空 |
| `open_project_includes_graph_report` | 有 graph.json 的项目 → ProjectData.graph_report 存在（即使空 issues） |
| `validate_graph_does_not_block_loading` | 有 error 级 issue 的图 → open_project 仍 Ok（issues 在 report 里） |

### CLI（后续新增）

| 测试名 | 断言要点 |
|--------|---------|
| `validate_cli_exits_zero_for_clean_project` | 合法项目 → exit 0，JSON 中 issues 为空 |
| `validate_cli_exits_nonzero_for_graph_issues` | 有 `missing_entry_node`/`dangling_edge` → exit 非 0，stdout JSON 含稳定 code 和定位字段 |
| `validate_cli_reuses_path_safety` | 越界 node.file → exit 非 0，错误结构可被 Agent 读取 |
| `validate_cli_does_not_require_window` | 无 Tauri 窗口 / UI 未启动时仍可运行 |

### 前端（Vitest）

| 测试名 | 断言要点 |
|--------|---------|
| `issueTargetsNode returns nodeId for selection` | 带 nodeId 的 issue 可用于定位（纯 helper） |
| `mapGraphToFlow marks suspicious edges from issues` | dangling_edge 对应边 data.suspicious=true |

> 刷新指示器为 UI 行为，验收靠手动（§6）。

## 6. 验收标准

1. 手造一个有悬空边的 graph.json → 打开后画布该边标红，issues 面板列出 `dangling_edge`，点击可定位。
2. 节点文件缺失 → issues 面板列出 `missing_node_file`，节点显示「⚠ 文件缺失」。
3. 外部删一个节点文件 + 改 graph.json → 顶栏状态点跳「同步中…→已同步」，issues 更新。
4. `entryNodeId` 指向不存在节点 → issues 列 `missing_entry_node`（error），但图仍加载、不崩。
5. 合法图 → issues 面板显示「✓ 图结构正常」。
6. `galstudio validate <project-path> --format json` 能在 UI 未启动时校验项目；有问题时非零退出并返回结构化错误。
7. 工具栏、右键菜单和命令面板不出现任何内置 AI 协作入口，也不会写入 AI 任务文件。
8. `docs` 中存在面向外部工具/Agent 的 schema 说明。

## 7. 边界情况

| 情况 | 处理 |
|------|------|
| 多种问题同时存在 | issues 全部列出，不互相抑制 |
| error 级问题 | 不阻断加载，仅高亮（§2.2） |
| 合成图的问题 | 理论无悬空边；`ensure_unique` 防住重复 id；校验作二次保险 |
| 外部改动在 `syncing` 中到达 | debounce 合并，仍一次刷新；状态点最终回 synced |
| 刷新失败（如 graph.json 被改成非法 JSON） | `open_project` Err → 顶栏「刷新失败」+ 保留上次可用 project 不崩 |

## 8. 不在本期范围

- 自动修复建议（点击 issue 直接修）。
- schema 的严格 JSON Schema（.json schema 文件）——本期用 markdown 文档化即可。
- issues 的本地化多语言（本期中文 message）。

---

## 9. 外部 Agent 操作速查

| 想做的事 | 操作 |
|---------|------|
| 新增一个叙事节点 | 1) 写 `content/nodes/<id>.json`（`Instruction[]`，用 `t` 判别联合）<br>2) 改 `content/graph.json`：nodes 加一项 `{id,title,file:"nodes/<id>.json",position}`，必要时 edges 加 `{id,from,to,condition:null}` |
| 修改某节点剧情 | 直接改 `content/nodes/<id>.json` |
| 删除节点 | 删 `nodes/<id>.json` + 从 graph.json 的 nodes/edges 移除引用 |
| 改流程顺序 | 改 graph.json 的 edges |
| 注意 | `file` 必须在 `content/` 下；越界会被拒；坏数据进 issues 不崩；改完 GalStudio 自动热重载，无需重启 |
