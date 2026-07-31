# Spec 33 — Interaction Subtraction（交互减法）

- 状态：执行中
- 目标版本：`1.1.0`
- 创建：2026-07-30
- 修订：2026-07-30 第二版 — 六条未验证项已落定，范围收敛至 Phase A + B，四个待定项已决议
- 前置：`28-product-review-and-roadmap.md`（本文多处引用其缺陷编号，用以说明那一轮的修复只到表面）

## 0 一句话结论

四轮迭代都在做加法，没有任何一轮做减法，也没有任何机制阻止加法。

问题按后果分三层：**会丢数据或误导用户**（Phase A，本轮修）、**死代码与重复控件**（Phase B，本轮删）、**密度与概念负担**（记录在 §6，下轮）。

## 0.1 本轮范围

只做 **Phase A + Phase B**。这两组加起来已是一个 PR 的体量，且全部条目零产品判断、验收条件可机械判定。§6 的条目证据齐全但**不在本轮施工范围**。

第二版相对第一版的三个实质变化：

- 原 E1「拆分播放控制条」升级为 **B3「删除两个重复按钮」**。证据变硬，性质从密度问题变成重复问题，从需设计判断变成纯减法。
- 原 G1「扩充词汇门禁禁用词」**撤销**。核实发现该门禁看不见 i18n 目录，扩词是无操作。见 §7。
- 对外观工作区的判断**下调**。渐进披露已部分存在，问题比第一版描述的轻。

## 1 Phase A — 正确性与不可逆损失

全部零设计决策。每条给出证据与可机械判定的验收标准。

### A1 破坏性操作的确认覆盖不成体系

资源工作区有 **7 个破坏性入口、3 种爆炸半径，只有 2 个带确认**，而且没确认的恰好包含最危险的两个。

| 标签 | 位置 | 实际影响 | 确认 |
|---|---|---|---|
| 删除 / 删除 {name} | `AssetCard.tsx:100-108` | **磁盘 + 登记表**（`AssetsWorkspace.tsx:226-249` → `deleteAssetAndPruneManifestRefs:799-832`） | **无** |
| 移除引用 | `AssetCard.tsx:144-151` | 登记表单条，立即持久化 | **无** |
| 确认清理登记条目 | `AssetsWorkspace.tsx:360-362` | 登记表批量，纯登记表 | 有 |
| 删除 {count} 个孤儿 | `AssetsToolbar.tsx:79-83` | **磁盘**批量 | 有 |
| 移除登记 | `AssetsWorkspace.tsx:721-728` | 登记表，草稿暂存 | 无（可弃稿） |
| 删除角色 | `CharacterEditor.tsx:210-222` | 登记表，草稿暂存 | 无（可弃稿） |
| 删除表情 | `CharacterEditor.tsx:409-422` | 登记表，草稿暂存 | 无（可弃稿） |

**验收**：凡动磁盘文件的操作必须有确认；纯登记表且可弃稿的操作不需要。即「删除 / 删除 {name}」必须补确认。判定方式：对每个入口断言确认对话的出现与否。

### A2 确认对话的按钮文案写死为「删除」

`AssetsWorkspace.tsx:455`：`confirmLabel={t("assets.delete")}`。`message` 由调用方传入，按钮文案恒为「删除」。「确认清理登记条目」是纯登记表操作，磁盘一个文件不动，但用户看到的按钮写着「删除」。

结构问题大于这一处：文案与操作解耦，今后每个新增确认流程都自动继承「删除」二字。

**验收**：`confirmLabel` 改为由调用方传入；清理登记条目流程的确认按钮不含「删除」字样。判定方式：断言该流程确认按钮的文案。

### A3 界面风格有两套真值源

顶栏写 `gal.project.json`（`Workspace.tsx:277-285` → `saveProjectMetaQueued`）；导出页只写本地 UI 偏好（`useExportWorkspaceState.ts:85-88`：`setRendererId(next); persistPrefs({ rendererId: next })`），随后 `effectiveRendererId`（`:116`）回落到项目元数据。两处可长期分歧且无任何提示。

**已决议**：删掉导出页的界面风格下拉，一律读 `gal.project.json` 的 `activeRendererId`。

**验收**：导出页不存在界面风格选择控件；`useExportWorkspaceState` 不再持久化 `rendererId`；导出使用的界面风格恒等于项目设置。判定方式：断言导出页无该控件、且导出参数取自项目元数据。

### A4 撤销历史静默清空，共四处

`NodeEditor.tsx` 调用 `createUndoHistory()` 的四个位置：`:1097`（切 JSON 模式）、`:1116`（切场景模式）、`:484`（外部变更刷新）、`:900`（载入外部内容）。`handleModeToggle:1088-1122` 成功路径上无对话、无 toast，只在失败时 `setStatus`。全文件无 `window.confirm` 或 `ConfirmDialog`。

**验收**：四处清空前用户均获得可见告知（模式切换用确认对话，外部刷新/载入用 toast 即可）。判定方式：对四条路径分别断言告知存在。

### A5 删角色/删表情制造孤儿文件

`CharacterEditor.tsx:65-74` 的 `deleteCharacter` 只 `delete next[id]` 后 `onChange`，磁盘立绘文件不动。`删除表情`（`:105-112`）同理。结果：删一个角色即制造一批孤儿，而资源页随后把这些孤儿当问题报给用户，让用户再清一遍。**编辑器生产自己报警的问题。**

**验收**：二者要么级联清理磁盘文件（须补确认，见 A1），要么在操作前明确告知将残留 N 个文件。两种都可接受，实施者择一并在 PR 说明理由。判定方式：断言操作后不产生未告知的孤儿。

### A6 未分析即报「项目正常」

`Workspace.tsx:419-435` 的 `report` memo 在 `fullReport` 为 null 时排除故事状态与体验类问题，`StatusPanel` 因此显示绿灯。`StatusPanel.tsx:73-82` 的 `loading`/`error`/`okLabel`/`notOkLabel` 分支没有「尚未分析」这一中性态。

**验收**：完整分析未跑过时显示中性态，不显示绿灯。判定方式：断言 `fullReport === null` 时的渲染文案既非 okLabel 也非 notOkLabel。

### A7 硬编码英文

`StatusPanel.tsx:331`：`{issue.severity === "error" ? "Error" : "Warning"}` 未走 i18n。

**验收**：两个词经 `t()` 取值，中英目录均有条目。判定方式：`pnpm check:vocabulary` 通过且中文环境不出现裸英文。

## 2 Phase B — 纯减法

删除已确认无人使用的代码，与已确认重复的控件。无新增行为。

`noUnusedLocals` 与 `noUnusedParameters` 均开启（`packages/studio/tsconfig.json:16-17`），构建为 `tsc -b && vite build`，因此**残留未使用的导入会直接构建失败**，剪枝清单是硬要求而非清洁工作。

### B1 删除 `NodeOutline.tsx`

`packages/studio/src/features/script/NodeOutline.tsx`（274 行）零导入者、零测试、零快照、零 `className`（全内联样式），CSS 爆炸半径为零。

**保留**（另有消费者）：`searchProject`、`fixedListWindow`、`findNodeData`。

连带作废 9 个 i18n 键，中英各自连续（zh `649-657`、en `1858-1866`）：`script.nodeList.searchPlaceholder`、`.searchResultsLabel`、`.label`、`.noResults`、`.noNodes`、`.kind.node`、`.kind.instruction`、`.kind.edge`、`.kind.manifest`。

**必须保留**：`script.outline.entry`、`script.nodeInspector.hasContent`、`script.nodeInspector.missingFile`。

删键安全：`i18n.test.tsx` 无键对齐断言（`:64` 仅在实际请求某键时才对缺失的英文抛错）。

### B2 删除 `StoryStatePanel` 函数（不是整个文件）

**文件是活的**——`StoryStateView.tsx:15` 从中导入 `StateCard`、`NewStateForm`、`registerInferredVariable`。只有 `StoryStatePanel` 组件函数（`:80`）与 `StoryStatePanelProps`（`:68-78`）是死的。

剪枝清单（删函数后必然未使用）：`useMemo` 导入、`Search`、`Plus`、`analyzeGraphVariables`、`variableKind`、`matches`（`:720`）、以及 `NodeEntry` / `ProjectGraph` 类型导入。

**必须保留**：`useState`、`Button`、`IconButton`、`scopeLabel`、`VariableEntry` 及上述三个导出。

测试手术 `StoryStatePanel.test.tsx`：删 `describe("StoryStatePanel")`（`:40-114`，8 个测试）与 `render` 辅助（`:35-38`），剪掉随之未使用的 `createElement`、`renderToStaticMarkup`、`StudioI18nProvider`、`graph`、`manifest` 及类型导入。**保留** `registry` 夹具与三个存活 describe：`new state defaults`、`identifier generation`、`registerInferredVariable`。

连带作废 i18n 键：`script.state.new`、`script.state.empty`、`script.state.undeclared`。**必须保留** `script.state.searchLabel`、`.searchPlaceholder`、`.register`。

死 CSS（`index.css`，块头 `:1045`）：`.gs-story-state`、`.gs-story-state__toolbar`、`.gs-story-state__undeclared`、`.gs-story-state__undeclared h4`。**必须保留**（`StoryStateView.tsx` 在用）：`.gs-story-state__search`、`.gs-story-state__search .gs-input`、`.gs-story-state__empty`、`.gs-story-state__undeclared-row`。

> 附带发现：`24-story-state-authoring.spec.md:257` 以这 8 个测试作为 R9 验收证据，但它们测的是一个无人渲染的组件——**该证据自始无效**，不是删除造成的损失。已决议：照删，并在 Spec 24 将 R9 标注为「证据失效，覆盖待补」。在 `StoryStateView` 上补真实覆盖属于新增，不在本轮。

### B3 删除两个重复的播放按钮

默认界面风格自带 7 键 HUD（`templates/default-renderer/PlayerHud.tsx:52-58`，右上常驻）：菜单／快存／快读／自动／已读跳过／全文跳过／历史。三份 default-renderer 拷贝 `diff -rq` 字节一致。

预览为同进程 React 挂载（`Preview.tsx:223`），非 iframe；`RendererProps`（`packages/engine/src/renderer.ts:221-239`）无 preview/debug 字段，界面风格无从知晓自己在编辑器内；HUD 仅在 `isRecording` 时隐藏，而 `toggleRecording` 在 `Preview.tsx` 无调用者。**故剧情模式下两套控件同屏，垂直距离约 200px。**

两侧读写同一个 `playerRef`（`useProjectPlayer.ts:330-334` vs `:374-375`）——点 Studio 的「自动」，HUD 的「自动」同时亮起。**两个按钮抢一个 boolean。**

| Studio 控件 | 对侧 | 定性 | 处置 |
|---|---|---|---|
| 自动 `Preview.tsx:190-197` | HUD `auto` | 严格重复，同一 flag | **删** |
| 快进 `Preview.tsx:198-205` | HUD `skip-all` | 严格重复，语义相同 | **删** |
| 下一句 `Preview.tsx:186-189` | 点击舞台／空格 | **不重复**：`stepOnce` 硬走一条指令，`advance` 先放完打字机 | 留 |
| 重新开始 `Preview.tsx:178-181` | SystemPanel 内 | 功能重复但对侧埋在菜单+确认里，创作时高频 | 留 |
| 上一句 `Preview.tsx:182-185` | 无 | Studio 独有 | 留 |
| 剧情检查 `Preview.tsx:208-210` | 无 | Studio 独有 | 留 |

不得改动 `useProjectPlayer.ts` 的 `toggleAuto` / `setSkipMode`——HUD 仍需要它们。

**验收**：预览工具条不含自动／快进；`pnpm test` 通过；手动确认 HUD 的自动与全文跳过仍可用。

## 3 交叉核实中被修正的九条

两轮审查（一次独立通读 + 一次外部 Agent 报告）交叉核对后被推翻或改判的结论。保留在此，因为按错误结论施工会造成实际损害。

| # | 原结论 | 实际 | 若照原结论施工的后果 |
|---|---|---|---|
| 1 | `StoryStatePanel` 是新旧双实现，应合并 | 文件是活的，只有一个死函数 | 会误删 `StoryStateView` 在用的三个导出 |
| 2 | 节点编辑无可见入口 | `NodeInspector.tsx:173-175` 有常驻主按钮「进入编辑」 | 新增一个已存在的入口 |
| 3 | 指令编辑有三个入口 | 混淆了「插入」与「编辑」两类界面 | 合并本不重复的界面 |
| 4 | 播放控制条是密度问题，需拆分 | 是重复问题，自动／快进与 HUD 共用同一 flag | 把重复项移进次级容器，重复依然存在 |
| 5 | 外观页 56 个字段全部上屏 | 22 个收在折叠 `details`（`TokenEditorPanel.tsx:70-90`），可见约 34；未覆盖时全为 disabled | 重复实现已存在的渐进披露 |
| 6 | 外观页 12 场景须先选其一 | 网格本身即 12 路实时预览，编辑不以选择为前提 | 为不存在的阻塞增加引导 |
| 7 | 资源页有 3 个破坏性动词 | 7 个标签、3 种爆炸半径 | 漏掉 4 个入口，其中含最危险的两个 |
| 8 | 角色选择是伪装的模式开关 | 开关在侧栏「角色」入口（`AssetsWorkspace.tsx:319-327`），角色选择是普通主从 | 改错对象，真正的静默切换仍在 |
| 9 | 扩充词汇门禁禁用词可拦住黑话 | 该门禁看不见 i18n 目录，扩词是无操作 | 买一个假的安心，存量违规全部放过 |

第 9 条是本文作者自己连续两次判断错误（先称「零副作用可提前」，再称「须与文案改动原子提交」），两次都错在没有先读门禁的收集逻辑。详见 §7。

## 4 已决议的待定项

| 项 | 决议 |
|---|---|
| 导出页独立 `rendererId` | **删掉下拉，一律读 `gal.project.json`**。见 A3 |
| 本轮范围 | **收敛至 Phase A + B**。C 及以后单开一轮 |
| 词汇门禁失明 | **不进本轮，单开一条 spec**；但必须在本文 §7 留档，防止再次拿其绿灯当证据 |
| 去黑话范围 | 缩至「孤儿」「悬空」共 6 处文案。「登记」**永不加入**禁用词，"token"／"实例"／"预设" 从计划删除。见 §7 |
| Spec 24 的 R9 | 照删 8 个测试，在 Spec 24 标注「证据失效，覆盖待补」 |
| 「外观」双义 | 顺延至 Phase F。倾向改编辑器侧（主题色那个），因工作区侧的「外观」已写入 `docs/vocabulary.md` 是载荷术语 |
| 控件预算口径 | 顺延。Phase G 不在本轮 |
| 密度改造是否需真人测试先行 | 顺延。B3 已无偿吃掉一部分，Phase D 的剩余量小于第一版估计 |

## 5 不做的事

- **不新增顶层 tab**。沿用 `28-product-review-and-roadmap.md` §5。
- **不发明第 10 种披露方式**。现存 9 种已是问题本身，任何新面板必须复用其中之一。
- **不在 Phase A/B 里夹带视觉改版**。这两组的价值在于零争议、可快速合入；混入需评审的改动会把它们一起卡住。
- **不重构变量系统的数据模型**。属独立课题，另开 spec。
- **不引入应用内 AI**。见 `AGENTS.md` 的产品边界。
- **不在本轮补 `StoryStateView` 的测试覆盖**。那是新增，不是减法。

## 6 下轮积压（证据齐全，本轮不施工）

保留证据以免下一轮重新取证。编号沿用第一版以便对照。

### 6.1 保存语义分裂（五种范式并存）

| 范式 | 实例 |
|---|---|
| 手动保存 | 项目设置 |
| 手动保存但按钮位置错误 | `ProjectSettings.tsx:601-612` 的保存按钮物理位于「舞台」卡片内，实际持久化横跨基础／舞台／分发三张卡片（`:524-671`） |
| 草稿 + 防抖自动写 | 节点编辑器 |
| 导入立即落盘 + 登记表留在草稿 | `CharacterEditor.tsx:76-97` 的 `addSpriteExpr` 先 `importAsset` 写盘，再 `updateCharacter` 只改内存 |
| 从不持久化 | 部分 UI 偏好 |

### 6.2 密度与隐藏路径

- **E2** 顶栏一行 11 个交互元素（`Workspace.tsx:523-567`）。
- **E3** 属性面板泄漏工程视图：ID、文件路径 `nodes/xxx.json`、坐标 x/y、入出边计数（`NodeInspector.tsx:96-183`）。
- **E4** 属性面板空态只有一行灰字「选择一个节点查看属性」，无任何动作（`NodeInspector.tsx:80-87`）；面板固定 340px 上限、不可折叠（`ScriptWorkspace.tsx:1141`）。
- **E5** 画布上创建后继／自动布局／重置视图／设为入口／管理结局等全部仅存在于右键菜单（`GraphCanvas.tsx:211-276`），工具栏只有「新建节点」。
- **E6** 命令面板与快捷键帮助只能由 Cmd+K 与 `?` 唤出（`Workspace.tsx:495-518`），**界面中零入口**——不知道快捷键的用户永远不知道它们存在。
- **E7** 资源侧栏 11 个分类，其中「角色」不是分类而是模式开关（见 6.3）。
- **E9** 导出页两个同等视觉权重、语义相互矛盾的复选框并列（`ExportWorkspace.tsx:285-301`）。
- **E10** 导航层级视觉无区分：工作区 tab、侧栏分类、面板内 tab 长得一样。
- **E11** 共 9 种披露方式（tab／侧栏／右键／折叠／对话框／抽屉／toast／内联展开／悬浮）。

### 6.3 侧栏「角色」是伪装的模式开关

`AssetsWorkspace.tsx:319-327`：`section === "character"` 时整个主区从「工具栏 + 网格」换成 `CharacterEditor`，并静默改变三件事——拖拽落盘失效（`:221`）、导入按钮消失（`AssetsToolbar.tsx:41-46`）、持久化从立即保存翻转为草稿 + 显式保存（`:324`、`:430-437`）。无任何文案说明。

**注意**：按「折叠分类」去做 E7 会把这个开关一并折进去，使其更隐蔽。E7 与本条必须一起设计。

### 6.4 外观工作区（问题小于第一版描述）

56 个字段中 22 个已收在折叠区，可见约 34，且未覆盖时全为 disabled；单场景模式还按部件过滤（`AppearanceWorkspace.tsx:365-367`）。仍可做的是「按选中部件收敛默认可见集」。

顺手可修的事实错误：`AppearanceWorkspace.tsx:409` 注释写「11 个内置」，实际 12（`snapshotScenes.ts:401-415`，测试断言 `toHaveLength(12)`）。

### 6.5 `RendererProps` 无预览标识位

`packages/engine/src/renderer.ts:221-239` 没有任何字段能让界面风格知道自己运行在编辑器预览中。这不只影响 HUD——**任何「预览态应当收敛的 chrome」都没有表达手段**。属接口层缺口，非 UI 密度问题，建议单开 spec。

**已单开：`docs/roadmap-specs/34-renderer-preview-flag.spec.md`**（2026-07-31）。决议：`preview?: boolean` 可选字段 + 三处传递；环境差异二分法（能力型走宿主能力 / 呈现型走 preview flag）；退出按钮为能力型用例，列入 34 号 spec 的后续 backlog。

### 6.6 §6.2 施工决议（2026-07-31 讨论后拍板）

实施 §6.2 时的约束与方案，施工时按此执行，不再重新决策。

| 条目 | 决议 | 备注 |
|---|---|---|
| E3 | 属性面板**删除** 6 个工程字段（ID、`nodes/xxx.json` 文件路径、x/y 坐标、入出边计数、入口 是/否、结构角色），**不做折叠区** | 用户：工程信息没用，直接不在界面显示。兜底：画布已有入口定位器（`GraphCanvas.tsx:380-387`）与节点状态推导（`graphMapping.ts:151-155`）。**保留**：章节 select、正式结局区块、文件缺失警告、标题、进入编辑、BranchRules。连锁：删 8 个 i18n 键（`file`/`entry`/`position`/`connections`/`connectionCounts`/`structuralRole`/`graphEnding`/`flowNode`）；`Field` 组件仅剩正式结局 1 处使用；`NodeInspector.test.tsx` 7 个测试无相关断言 |
| E4 | 只做空态「新建节点」动作按钮；340px 固定面板的可折叠**顺延** | 字段删完后属性面板变轻，折叠收益降低 |
| E5+E6 | 工具栏上浮 2 个画布级高频操作（自动布局、适应视图）；节点级操作保持右键菜单；画布右键菜单加「快捷键与命令」项 | E6 入口复用右键机制（E11 约束：不发明第 10 种披露方式） |
| E7+§6.3 | 角色**保留在侧栏分类**，不再伪装模式开关：分类视图 = 角色卡片网格（一级）→ 点击卡片进入双栏编辑页（左预览 / 右内容编辑，二级）；编辑页内左侧资源分类栏常驻不变 | 编辑页 = 现有预览舞台 + 属性面板去左栏列表（`CharacterEditor.tsx:206-320` 重组）；删除（A5 级联）与新建入口留在编辑页内，**卡片不放删除按钮**（防误触级联）；返回按钮回网格；编辑页内不做角色切换器；空态复用 `assets.character.*` 文案 |
| E7 折叠 | 侧栏剩 10 项分三组：**视觉**（background/cg/ui/animation）、**音频**（bgm/sfx/voice）、**其他**（video/font），overview 独立；三组默认展开、组头可折叠 | 纯展示层改动：`AssetSection` 类型与 `assetDrop.ts` 逻辑不动，只改 `AssetsSidebar` 的 `SECTIONS` 渲染（`assetSectionLabel` 扁平查找同步适配）；顺带纠正现有分隔线分组（`AssetsSidebar.tsx:43` index 1/3/6，角色混在音频组） |
| E9 | 合并为单个「警告策略」下拉（阻止构建 / 仅提示） | 迁移 `exportPrefs.strict` + `allowWarnings` 两个持久化字段；两个复选框删除（`ExportWorkspace.tsx:272-283`） |
| E2 | 顶栏不动 | 6 个工作台 tab 是结构需求；渲染层 select（Spec 19 §4.2 唯一入口）移动风险大于收益 |
| E10 | 顺延单开 | 纯视觉设计，需设计方向，本轮不夹带 |

**PR 结构**：四项独立 PR 并行（互不 import 未合并代码）：E3+E4、E5+E6、E7+§6.3（含折叠分组）、E9；均从最新 main 切出。

## 7 已知失效的门禁：`check:vocabulary` 看不见 i18n 目录

**这是本文最重要的留档条目。在修好之前，不得以 `pnpm check:vocabulary` 通过作为文案合规的证据。**

### 证据

`manifest` 在 `FORBIDDEN_TERMS` 中（`scripts/check-vocabulary.mjs:45`），其负向 lookahead 只豁免 `manifest.json` / `manifest（` / `manifestPath` 一类写法。而 `i18n.tsx:1634` 的值是 `"Game manifest"`、`:1640` 是 `"Desktop manifest"`——裸词，无任何豁免形态。**门禁照样通过，且从不报告 `i18n.tsx`。**

### 成因

`collectUserFacingNodes` 只采集属性名落在 `USER_FACING_PROPERTIES`（`:20-29`，8 个裸名如 `label`／`title`／`message`）中的赋值。目录条目的键是 `"script.state.new"` 这类带点字符串字面量，永远匹配不上。门禁实际可见的范围只有：JSX 文本、JSX 属性、那 8 个裸属性名、`new Error(...)`、`alert/confirm/prompt`、两个具名返回函数。测试文件被排除（`:79`）。

**而 Studio 的全部界面文案都住在那个目录里。** 故该门禁对 Studio 文案基本是装饰性的。

### 六个候选禁用词的真实分布

| 词 | 用户可见文案命中 | 门禁可见命中 | `vocabulary.md` |
|---|---|---|---|
| 孤儿 | 4 | 0 | 未提及 |
| 悬空 | 2 | 0 | 未提及 |
| 登记 | 53 | 17 | **已批准** |
| token | 0（96 处均为键名） | 3 | 部分批准 |
| 预设 | 1 | 0 | 未提及 |
| 实例 | 0（仅注释） | 0 | 未提及 |

- **「孤儿」「悬空」「预设」加入禁用词是无操作**——它们门禁可见命中为 0，却实存于 7 条创作者可见文案中。加了只拦未来的 JSX，放过全部存量。
- **「登记」永不可加**：`FORBIDDEN_TERMS[manifest].replacement` 即 `"资源登记表"`（`:45`），本身含「登记」；`docs/vocabulary.md:17`／`:33` 亦将「资源登记表」定为批准用词。加它等于取缔门禁自己开的药方并违反词汇契约。
- **"token"** 的 3 处命中是表达式解析器的英文 `new Error()`（`packages/engine/src/expression.ts:159`、`:168`、`:196`），改它是改内部诊断而非创作者界面。
- **「实例」** 是唯一干净的候选，且干净的原因是它只存在于注释里。

### 正确修法（另开 spec）

教门禁读消息目录。机器已存在——`studioZhCNMessagesFromSource`（`:272`）为过渡效果检查已在解析该目录。接通后会一次性暴露上述 7 条 + 2 条存量 `manifest`，因此**门禁改造必须与文案修正原子提交**，否则 CI 立刻转红。

## 8 方法论说明

本文由两轮独立审查交叉核对而成：一次全量通读，一次外部 Agent 报告，逐条回代码取证。价值体现在 §3 那九条被推翻的结论——其中至少三条若照原样施工会造成实际损害（误删在用导出、漏掉四个破坏性入口、改错模式开关的对象）。

局限须明说：

- 全部结论来自静态代码阅读，**无真人测试**。密度与认知负担类判断（§6.2）是推断，不是测量。
- 概念计数是估算。
- B3 的「两套控件同屏」由代码路径推定（无 iframe 隔离、无预览标识位、`toggleRecording` 无调用者），未经运行时目视确认。剧情模式下 HUD 在点「开始游戏」后出现，Studio 工具条全程可见。
- §6 各条的证据强度不等：附 `file:line` 的是事实，涉及「用户会困惑」的是判断。





