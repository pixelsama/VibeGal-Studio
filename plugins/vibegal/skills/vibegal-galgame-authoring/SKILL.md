---
name: vibegal-galgame-authoring
description: 在 VibeGal-Studio galgame 项目（含 gal.project.json 与 content/graph.json 的目录）中创作、修改、校验剧情时使用。覆盖 graph-first 数据模型、章节规则、节点正文写法与校验工作流。Use when authoring or editing a VibeGal-Studio galgame project.
---

# VibeGal-Studio galgame 创作指引

## 先读契约（信息单一源在项目文件里）

动手前按顺序确认上下文；本技能只是入口，**完整契约以项目内文件为准**：

1. 项目根目录 `AGENTS.md` —— 产品模型与硬性规则
2. `.galstudio/README.md` —— 文件布局与数据契约总览（MCP 资源 `vibegal://readme`）
3. `.galstudio/schemas/*.json` —— 各 JSON 文件的 schema（MCP 资源 `vibegal://schemas/*`）
4. 如需改渲染层：`.galstudio/renderer-contract.md`（MCP 资源 `vibegal://renderer-contract`）

## 数据模型（graph-first，违反即数据损坏）

- `content/graph.json` 是图的**唯一事实来源**：`chapters[]` 声明章节、`nodes[]` 声明节点、`edges[]` 声明流转。
- 每个节点指向一个 `content/nodes/*.json` 文件，内容是 `Instruction[]`（结构见 `vibegal://schemas/nodeFile`）。
- **每个节点必须归属恰好一个已声明章节**（`nodes[].chapterId` ∈ `chapters[].id`）。
- 不要复活 legacy `content/chapters/` 目录或 `meta.json` 的 `chapters` 字段——它们应作为项目问题暴露。

## 工具使用顺序

1. `nodes_list` / `graph_read` —— 先看清现有结构再动笔
2. `node_read` —— 读要修改的节点正文
3. `graph_write` —— 新增节点（到已声明章节）或连线、删除连线；白名单式，不删除节点/章节
4. `node_write` —— 覆盖写入节点正文（Instruction[]；身份 id 自动补齐；写后自动复检）
5. `project_validate` —— 每轮修改后必须重跑，issues 清零才算完成

## 硬性边界

- 新增节点两步走：先 `graph_write.addNodes` 注册图结构，再 `node_write` 填正文；`node_write` 只能写 `graph.json` 中已声明的节点文件。
- `graph_write` 只允许新增节点/连线与删除连线；删除节点或章节是破坏性操作，请提示用户在 VibeGal-Studio 图编辑中做。
- `renderers/` 下的代码修改前必须先读 renderer-contract.md，改完跑 `vibegal-cli renderer-check`。
- 资产生效前要在 manifest 登记；不要引用不存在的资产路径，最后用 `project_validate` 兜底。

## 与用户协作

- 用与用户相同的语言交流。
- 大改（新增章节、重写多节点）前先给计划，确认后再执行。
- 完成后用一两句话说明改了哪些文件、`project_validate` 的最终状态。
