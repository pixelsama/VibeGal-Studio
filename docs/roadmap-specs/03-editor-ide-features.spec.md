# Spec 03 — Studio IDE Features

> 状态：已决策，待开发。
> 目标：把 GalStudio 从“能编辑 graph 和节点”推进到“可日常创作、检查、调试大型 gal 项目”的工程 IDE。

## 1. 背景

当前 Studio 已有：

- Render / Script / Assets / Project 工作台；
- graph canvas；
- node editor；
- Scenario DSL；
- asset workspace；
- project reports；
- renderer management；
- hot reload。

下一阶段编辑器本体最有价值的工作，是增强创作、验证和调试能力，而不是内置正式 gal UI。

## 2. 产品边界

Studio 应实现：

- 图结构编辑体验；
- 静态分析；
- 调试预览；
- 资源使用分析；
- renderer 编译/加载诊断。

Studio 不应实现：

- 正式标题菜单；
- 正式存档菜单；
- 正式 backlog 菜单；
- 正式设置菜单；
- 正式 CG 鉴赏界面。

## 3. 功能范围

### 3.1 Graph Undo/Redo

已有 `docs/script-graph/16-graph-undo-redo.spec.md`，本阶段应优先落地。

覆盖操作：

- add node；
- remove node；
- connect；
- remove edge；
- rename；
- move / position patch；
- set entry；
- auto layout。

要求：

- graph 编辑入口收敛为 command；
- 每个 command 有 inverse；
- undo/redo 只改内存 draft；
- save 仍走现有安全持久化；
- 外部 revision 变化后旧 undo 栈不能继续应用。

### 3.2 Graph Auto Layout

增强自动排布：

- 从 entry BFS 分层；
- 不可达节点放独立区域；
- 同层排序稳定；
- 重复运行结果稳定；
- 只修改 `position`；
- 不修改节点 id/file/edge。

后续可引入 dagre/elk，但 V1 可先做确定性分层布局。

### 3.3 Route Analysis

新增静态检查：

- unreachable node；
- dead-end route；
- missing entry；
- branch without default；
- choice label missing；
- linear multiple outgoing；
- auto condition never matched candidate；
- cycle warning，若没有显式设计为循环。

结果进入 `projectReport`，并可从状态面板点击定位到 graph node/edge。

### 3.4 Route Coverage

为作者提供路线覆盖视图：

- 总节点数；
- reachable 节点数；
- ending 节点数；
- orphan 节点数；
- 每个 choice 分支是否最终到达 ending；
- 每个 auto 分支是否有 default。

V1 可静态分析，不要求运行所有路径。

### 3.5 Variable Table

扫描全项目：

- `set` 指令写点；
- edge condition 读点；
- 每个变量的类型集合；
- 未写先读；
- 写了未读；
- 类型冲突；
- 条件表达式解析失败。

展示：

- 变量名；
- 推断类型；
- 写点列表；
- 读点列表；
- issue 状态；
- 点击跳转 node/instruction 或 edge。

### 3.6 Preview From Any Point

支持：

- 从任意 node 开始预览；
- 从任意稳定 story point 开始预览；
- 带初始 vars 预览；
- 模拟选择路线。

依赖：

- Spec 01 的稳定位置标识；
- 可重放模型；
- runtime snapshot。

V1 如果 Spec 01 未完成，可先提供 node-level preview。

### 3.7 Runtime State Inspector

Studio preview 中显示：

- current node；
- current story point；
- vars；
- active sprites；
- background；
- audio state；
- choice state；
- decision log；
- read status if available。

此面板是 debug UI，不是导出游戏 UI。

### 3.8 Search and Navigation

支持：

- 搜索节点标题/id；
- 搜索台词文本；
- 搜索角色 id；
- 搜索背景/音频引用；
- 搜索变量；
- 搜索 edge condition；
- 引用跳转。

### 3.9 Asset Usage Analysis

分析：

- manifest 声明但未使用；
- 磁盘存在但未注册；
- 剧本引用但不存在；
- manifest 注册路径缺失；
- 资源被哪些 node/instruction 使用。

展示：

- 未使用资源清理建议；
- 缺失资源定位；
- 引用列表；
- 批量整理入口。

### 3.10 Renderer Diagnostics

增强 renderer 加载错误定位：

- 哪个 renderer；
- 哪个文件；
- 编译错误行列；
- unsupported bare import；
- missing default export；
- wrong manifest id；
- contract version mismatch；
- runtime compiler stack trace 精简展示。

## 4. 非目标

- 不设计正式游戏菜单。
- 不做 WYSIWYG 舞台编辑器。
- 不做多人协同。
- 不做 CRDT。
- 不做 Git 可视化。
- 不做复杂脚本运行器。

## 5. 验收标准

- graph undo/redo 可覆盖核心 graph 操作。
- route issues 进入 `projectReport`。
- variable table 能列出 set/condition 读写关系。
- node/edge issue 可点击定位。
- 能从至少任意 node 预览。
- runtime state inspector 可显示当前 state。
- asset usage report 能定位未使用/缺失资源。
- renderer compile errors 更可读。

## 6. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `undoRedoGraphCommandRestoresPreviousGraph` | graph command undo/redo 正确 |
| `undoStackClearsAfterNewCommand` | undo 后执行新 command 清空 redo |
| `routeAnalysisFindsUnreachableNodes` | 从 entry 不可达节点被标记 |
| `routeAnalysisFindsDeadEnds` | 非 ending 死路被标记 |
| `variableTableFindsReadBeforeWrite` | condition 读未写变量被标记 |
| `variableTableFindsTypeConflict` | 同变量多类型写入被标记 |
| `assetUsageFindsUnregisteredDiskAssets` | 磁盘资产未注册被发现 |
| `assetUsageFindsUnusedManifestEntries` | manifest 未使用资源被发现 |
| `rendererDiagnosticsReportsUnsupportedBareImport` | unsupported import 定位清晰 |

## 7. V1 决策

- V1 用“reachable 且无 outgoing edge”的节点推断 ending。暂不新增显式 `node.kind`；未来如果需要 true/bad/normal ending 分类，再由 Data Contract spec 增加 ending metadata。
- Route coverage 不做完整 auto condition 可满足性证明。V1 只解析条件、检查语法、变量读写、缺 default、明显常量 false/重复条件等可确定问题；无法证明的分支标记为 `unknown`，不报 error。
- Variable condition 必须先转 AST 再分析。禁止用正则从 condition 字符串猜变量；AST parser 应在 engine 侧共享，Studio 和 CLI 复用同一套读点提取逻辑。
- Asset cleanup V1 只给建议和定位，不自动改 manifest 或删除磁盘文件。后续批量清理必须有明确确认、预览 diff、并走安全持久化。
- 缺稳定 `id` 的旧项目只能降级到 node-level preview；当前编辑会话内可临时使用 `nodeId + instructionIndex` 跳转，但该定位不可写入 save/backlog/read status，并且 UI/报告必须提示“需要补齐 instruction id”。
