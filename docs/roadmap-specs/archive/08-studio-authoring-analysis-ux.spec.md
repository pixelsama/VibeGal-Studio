# Spec 08 — Studio Authoring Analysis UX

> 状态：已归档。
> 前置：[Spec 03](../archive/03-editor-ide-features.spec.md)、[Spec 07](./07-playback-history-rollback-and-skip.spec.md) 的 stable story point 能力。
> 目标：把 V1 的 Studio 分析数据层推进到作者日常会用的创作 UX。

## 1. 背景

V1 已实现：

- graph history 的可测试数据层；
- route analysis warning；
- variable analysis；
- asset usage 最小报告；
- runtime state inspector 最小入口；
- 节点搜索和变量过滤。

但 V1 刻意没有做满：

- 全项目全文搜索；
- 从 stable story point 预览；
- 带初始 vars 的路线模拟；
- 完整 route branch coverage UI；
- asset cleanup dry-run + confirm；
- graph draft 与显式保存模式。

本 spec 做 Studio 编辑器体验，不做最终游戏 UI。

## 2. 产品边界

Studio 应实现：

- 搜索、定位、过滤；
- 路线覆盖视图；
- 预览起点控制；
- 资产清理建议与安全确认；
- graph 编辑安全体验。

Studio 不实现：

- 正式玩家标题菜单；
- 正式存档/backlog/settings/gallery UI；
- 多人协作；
- Git 可视化；
- CRDT。

## 3. V1.1 决策

- 全项目搜索先做 read-only 定位，不做批量替换。
- Preview from stable story point 依赖 Spec 07 的 story cursor；旧项目缺 instruction id 时仍降级到 node-level。
- Route branch coverage 用静态图分析 + 条件 AST，不做完整 SAT/SMT 求解；无法证明的分支显示 `unknown`。
- Asset cleanup 先做 dry-run diff，用户确认后才改 manifest；永不自动删除磁盘文件。
- Graph draft 模式作为可选增强：当前即时保存流保留，draft/commit 先只覆盖 graph canvas 编辑。

## 4. 功能范围

### 4.1 Full Project Search

搜索范围：

- node id/title；
- say/narrate 文本；
- character id/name；
- background/audio/cg/video/font/ui skin id/path/name/tags；
- variable writes；
- edge conditions；
- unlock/replay/ending id。

搜索结果必须可定位到 node、instruction、edge 或 manifest entry。

### 4.2 Preview From Point

支持：

- 从任意 node 开始；
- 从 stable story point 开始；
- 设置初始 vars；
- 模拟 choice 路线。

### 4.3 Route Branch Coverage UI

展示：

- reachable/orphan/ending counts；
- 每个 choice 分支的 ending reachability；
- auto 分支 default 状态；
- unknown condition 标记；
- issue 跳转。

### 4.4 Asset Cleanup Dry-run

提供：

- unused manifest entries；
- missing files；
- unregistered disk files；
- cleanup proposal；
- diff preview；
- explicit confirm。

## 5. 非目标

- 不做全文替换。
- 不做磁盘文件自动删除。
- 不做复杂定理证明。
- 不做大型舞台 WYSIWYG。

## 6. 验收标准

- 搜索结果覆盖文本、资源、变量、条件，并可定位。
- 可以从 stable story point 预览。
- 初始 vars 能影响 auto route preview。
- route coverage UI 能展示每个 choice 分支的 ending reachability。
- asset cleanup dry-run 不改文件，confirm 后只改 manifest。
- graph draft 模式不会覆盖外部 revision。

## 7. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `projectSearchFindsDialogueText` | 搜索台词并定位 node/instruction |
| `projectSearchFindsAssetReference` | 搜索资源 id/path 并定位引用 |
| `previewFromStoryPointStartsAtInstruction` | 从 stable story point 开始预览 |
| `previewWithInitialVarsAffectsAutoRoute` | 初始 vars 改变 auto route |
| `routeCoverageReportsChoiceBranchEndings` | 每个 choice 分支展示 ending reachability |
| `assetCleanupDryRunDoesNotMutateManifest` | dry-run 不修改 manifest |
| `assetCleanupConfirmRemovesManifestEntryOnly` | confirm 只安全修改 manifest entry |
| `graphDraftRejectsStaleExternalRevision` | 外部 revision 变化后 draft commit 失败 |

## 8. 归档记录

- 2026-07-08：新增全项目搜索数据层，覆盖 node、instruction、edge、manifest entry，并可定位到具体对象。
- 2026-07-08：Studio 节点搜索入口升级为项目级搜索入口，支持文本、资源、变量、条件、unlock/replay/ending 检索。
- 2026-07-08：预览支持从 stable story point 切片开始，并支持 initial vars 影响 auto route preview。
- 2026-07-08：route coverage 增加 choice/auto branch ending reachability、unknown/default/invalid condition 标记，并在分析面板展示。
- 2026-07-08：资产 cleanup dry-run 会生成 diff proposal；confirm 只移除 manifest entry，不删除磁盘文件。
- 2026-07-08：graph draft commit 增加 stale revision guard，外部 revision 改变时拒绝覆盖。
