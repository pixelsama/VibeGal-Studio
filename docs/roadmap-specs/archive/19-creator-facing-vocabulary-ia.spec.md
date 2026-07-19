# Spec 19 — Creator-Facing Vocabulary & Preview/Appearance IA（创作者词汇与预览/外观信息架构）

> 状态：已实施并归档（2026-07-19 定稿，当日全部落地：commit 415936c）。本 spec 源于 2026-07-19 与用户的界面概念复盘讨论，决策已在讨论中逐条确认。
> 目标：让创作者面对的界面词汇全部为「用户意图词」，隐藏实现术语；预览/外观/资产三个工作区职责不交叉；渲染层（界面风格）的获取路径明确转向「AI 生成、文件系统自动发现」。

## 1. 背景与动机

实测复盘发现的困惑点：

1. 顶部 tab「渲染」是实现术语，其他 tab（脚本/资产/项目/外观/导出）都是用户意图词；
2. 「场景刷」是黑话（scrubber 直译），用户不知道是什么，且与外观的「单场景」看起来重复；
3. 「UI Skin」英文术语混在中文 UI 里，且资产页的「UI Skin 登记」与「外观」tab 指向同一个 manifest 字段（`uiSkins`），关系不可见；
4. 「风格」与「皮肤」两个词不编码层级关系——更糟的是，中文软件语境里「换皮肤」（QQ 皮肤、输入法皮肤）指整体界面大换样，语义上更接近我们的渲染层，用户语感会把两个概念理解颠倒；
5. 预览里的渲染层侧栏提供「新建/复制/重命名/删除」，本质是文件系统操作的 UI 包装，暗示创作者应手工管理渲染层——与目标工作流（外部 AI 在 `renderers/` 下生成，watcher 自动发现）相反。

讨论中确认的心智模型：**渲染层 = 风格与交互的结构性来源（低频大决策）；skin = 渲染层暴露的参数空间内的数值微调（高频小调整）**。两者是层级关系而非平行系统。但与其找一对能传达层级的名词，不如把用户需要理解的概念从两个减到一个。

## 2. 产品边界

- **纯 Studio 界面信息架构调整**：manifest schema、`renderers/` 目录契约、`activeRendererId`、CLI（`renderer-check` / `renderer-snapshot` / `validate`）、`.galstudio` 文档全部不动；外部 Agent 工作流零影响；
- **不引入 in-app AI**：AI 生成界面风格的引导只做到文档级文案（指向 `renderers/` 目录与 `.galstudio/README.md`），不加 AI 按钮、不做 prompt 交接；
- **单 skin 收敛只收敛 UI**：`uiSkins` 保持 record 结构，检测到多套时出 project issue 提示，不强制迁移、不静默忽略；
- **信任门禁不动**：AI 生成的界面风格首次被选中时仍走 `RendererTrustPrompt`，这是安全阀。

## 3. 词汇定稿

用户-facing 中文词汇表（内部标识符、目录名、CLI、契约名一律不变）：

| 旧文案 | 新文案 | 位置 |
| --- | --- | --- |
| 顶部 tab「渲染」 | 「预览」 | `Workspace.tsx` 导航（workspace id `render` 不变） |
| 「当前渲染层」 | 「界面风格」 | 顶栏选择器 label |
| 渲染层侧栏（整个面板） | 移除，见 §4.2 | 预览 tab 左栏 |
| 「场景刷」 | 「场景快照」 | `Preview.tsx` 工具条 tab |
| 资产侧栏「UI Skin」 | 「外观资源」 | `AssetsSidebar.tsx` |
| 「导入UI Skin」 | 「导入外观资源」 | `AssetsToolbar.tsx` |
| 「UI Skin 登记」 | 「外观资源登记」 | `AssetsWorkspace.tsx` RegistryPanel |
| 「编辑皮肤：default」 | 「编辑外观」 | `AppearanceWorkspace.tsx` skin 头部 |

原则：创作者主流程只有三个风格类名词——**界面风格（选）、外观（调）、外观资源（登记）**，各是一个动作的直接宾语。「皮肤（skin）」一词从用户-facing 中文 UI 消失，只活在契约、CLI 与给 Agent 读的文档里。

## 4. 方案概述

### 4.1 tab 重命名：渲染 → 预览

只换显示文案。预览工作区职责不变：剧情播放 + 场景快照（fixture 巡检）+ Runtime 检视器。

### 4.2 渲染层侧栏 → 顶栏「界面风格」选择器

- 预览 tab 左栏整体移除（新建/复制/重命名/删除按钮随之移除）；顶栏已有的渲染层选择器成为唯一切换入口，label 改为「界面风格」；
- 侧栏的「渲染层诊断」区随之移除：加载失败本就有预览区错误横幅，诊断详情由全局问题面板（右下角）承接，不丢信息；
- 选择器附近加文档级引导文案（如空态或帮助气泡）：「新界面风格可由 AI 在 `renderers/` 目录下生成，出现后自动可选择」；
- 后端 `create_renderer` / `delete_renderer` / `rename_renderer` / `duplicate_renderer` 等 Tauri command 保留（CLI 与未来的高级管理区仍可用），只是预览 UI 不再暴露；
- 「复制 default 再让 AI 改」的迭代起点由 AI 复制目录承担，Studio 不提供入口；是否另设高级管理区（项目页/设置）留待后续单独评估，不属于本 spec。

### 4.3 场景刷 → 场景快照

仅文案。与 CLI `renderer-snapshot` 同源 fixture 的对齐关系不变；外观的宫格/单场景不动（一个是只读巡检，一个是编辑面，分工已在代码注释与本文档记录）。可选增强（不单列排期）：场景快照模式加「在外观中编辑此场景」跳转。

### 4.4 单 skin 收敛

- UI 只呈现生效皮肤（`selectEditableSkinId` 的 default → 首条回退逻辑已是该语义）；
- 项目 `uiSkins` 条目 > 1 时出 project issue：「多余的外观资源条目不会被消费」，引导用户自行清理，不强制迁移；
- 外观页「启用外观编辑」行为不变（创建空的 `uiSkins.default`）；
- 资产页导入行为 V1 不变（id 不存在时新建条目）；>1 套由上述 issue 提示覆盖，导入语义是否改为「优先进 default」留实施时评估。

### 4.5 外观页承接皮肤资产显示 + 层级说明

- token 面板新增「贴图」分组（折叠的高级区）：展示生效皮肤 `assets` 槽位的缩略图 + 路径，V1 只读；就地换图（从项目文件选择替换槽位）留后续；
- 外观页顶部加一句层级说明：「调整当前界面风格（default）暴露的外观参数」，把外观依附于界面风格的关系说破；
- 「编辑皮肤：default」头部改为「编辑外观」；单 skin 后 skin id 无展示价值；
- 已知限制：渲染层契约不声明消费哪些贴图槽，贴图分组只能做槽位级通用展示，做不到零件级映射（需未来扩展契约）。

### 4.6 引用保护不变

`useAssets` 派生与 `countRefs` / `removeAllRefsToPath` 继续把 `uiSkins.*.assets` 计为引用；本 spec 只动呈现层，底层引用保护不跟著挪。

## 5. 实现要点

涉及文件（文案与结构）：

- `packages/studio/src/Workspace.tsx`：tab label「渲染」→「预览」；顶栏「当前渲染层」→「界面风格」；预览 tab 左栏挂载移除；
- `packages/studio/src/features/renderers/RendererSidebar.tsx`：从预览移除（组件本身可保留给未来高级区，或随 PR 删除，实施时定）；
- `packages/studio/src/features/preview/Preview.tsx`：「场景刷」→「场景快照」；
- `packages/studio/src/features/appearance/AppearanceWorkspace.tsx`：「编辑皮肤」→「编辑外观」、顶部层级说明句、「贴图」分组（只读）；
- `packages/studio/src/features/assets/AssetsSidebar.tsx` / `AssetsToolbar.tsx` / `AssetsWorkspace.tsx`：「UI Skin」→「外观资源」系列文案；
- 多 skin project issue：`src-tauri` loader 的 report 链路或前端 projectReport 组装处，实施时选一处（与既有 issue 产出位置一致）；
- 注释中的「渲染层」「场景刷」等术语：代码注释可保留实现术语，面向 UI 的字符串必须按 §3 定稿。

## 6. 边界情况

- 项目只有 `default` 一个界面风格：选择器单条目，正常可用；`renderers/` 为空时选择器空态 + 引导文案；
- 旧项目已有多套 `uiSkins`：不崩、不迁移，issue 提示 + 生效条目照常可编辑；
- AI 生成的界面风格首次选中：信任门禁拦截，流程不变；
- 场景快照改名不影响 fixture 数据源与 CLI 截图对照（同一 `snapshotScenes.ts`）；
- 外观页贴图分组在皮肤无 `assets` 槽时显示空态提示（引导去资产页导入外观资源）。

## 7. 验证与测试（实施时）

按仓库 TDD 约定先改测试：

- 文案断言更新：`Workspace.test.ts`、`Preview.test.tsx`、`SceneFixtureView.test.tsx`、`AppearanceWorkspace.test.tsx`、`AssetsWorkspace.test.ts`、`RendererSidebar.test.tsx`（若组件移除则删测试）、`CollapsibleSidebar.test.tsx`；
- 新增：多 skin 项目出 issue 的测试（loader 或前端 report，视落点）；外观页「贴图」分组渲染测试；
- 回归：界面风格切换仍持久化 `activeRendererId`；信任门禁、场景快照 fixture 列表不变；
- 验证命令：`pnpm --filter @vibegal/studio test`、`pnpm --filter @vibegal/studio build`；涉及 Rust report 链路时加 `cargo test`。
