# Spec 18 — Open Non-Project Directory Guidance（打开非项目目录时的项目引导）

> 状态：已记录，暂缓开发。本 spec 源于一次真实用户困惑的复盘，等后续排期再实施。
> 目标：打开"本身不是项目、但含有项目子目录"的目录时，引导用户打开其中的项目，而不是直接提议初始化，避免在工作区目录里嵌套创建项目。

## 1. 背景与动机

2026-07-17 实测复盘：用户通过"新建项目"在 `Documents\galgame\weapon-girl` 创建了项目并正常使用；之后在首页点"打开项目…"时停在了上一级 `Documents\galgame` 就点了"选择文件夹"。该目录本身不是项目（没有 `gal.project.json`），于是弹出"这个目录还不是 VibeGal-Studio 项目 → 是否添加工程文件"对话框，用户误以为项目损坏或目录不被识别。

当前行为（`packages/studio/src/features/projects/ProjectList.tsx` 的 `openDirectory`）：

- 后端 `open_project` 对缺少 `gal.project.json` 的目录报错"不是 VibeGal-Studio 项目目录（缺少 gal.project.json）"（`src-tauri/src/backend/fs/mod.rs` 的 `ProjectRoot::open`）；
- 前端匹配到"缺少 gal.project.json"即进入 `initTarget` 初始化流程，无论该目录里是否已有项目。

问题有两层：

1. **误导性空态**：目录里明明有项目（如工作区目录），UI 却表现得像"这里什么都没有"，把用户引向初始化；
2. **嵌套项目风险**：用户若顺势点"添加工程文件"，会在工作区目录里原地初始化一个新项目，与已有的 `weapon-girl/` 等子项目并列，目录语义从此混乱。初始化本身不会覆盖现有文件（后端有保护），但"项目套项目"的布局不是产品想要的。

## 2. 产品边界

- **对用户文件保持保守**：初始化始终是用户的显式选择，本 spec 只调整引导顺序与文案，不新增任何自动写盘行为；
- **打开目录 = 打开该目录本身**：不因为目录里含项目就自动打开某个子项目（保持 AGENTS.md 的"打开哪个目录就打开哪个"语义），只提供更好的分岔选项；
- **不引入新的后端能力**：复用既有 `list_projects` 扫描，失败时降级到现有初始化对话框。

## 3. 方案概述

在 `openDirectory` 捕获"缺少 gal.project.json"错误后、进入初始化流程前，插入一次子项目扫描：

1. 调用 `listProjects(target)`（既有 Tauri 包装，`src/lib/tauri.ts`）；
2. **扫描到 ≥1 个子项目** → 展示"这个目录本身不是项目，但包含这些项目"对话框：项目列表（名称 + 路径，复用 `WorkspaceProjectList` 的展示形式）+ 每项"打开"按钮 + 次要操作"仍然在此目录初始化"（收敛为不显眼的小按钮/链接，并保留"不会删除或覆盖现有文件"的说明）；
3. **没有子项目** → 保持现有初始化对话框不变；
4. **扫描本身失败**（权限、IO 错误等）→ 同样降级到现有初始化对话框，不阻塞主流程。

文案要点：明确区分"工作区目录"与"项目目录"两个概念，例如标题"这个目录不是项目，但它里面有 N 个项目"，副文案建议"如果你管理多个项目，也可以把它设为工作区（浏览工作区…）"。

## 4. 实现要点

- 改动集中在 `ProjectList.tsx`：`openDirectory` 的 catch 分支由"直接 setInitTarget"改为"先 listProjects，再决定对话框形态"；`initTarget` 状态扩展为 `{ path, containedProjects: ProjectListItem[] } | null` 之类的判别结构；
- 对话框复用现有 `modalOverlayStyle`/`modalStyle` 与 `Button` 组件，不引入新视觉体系；
- "打开子项目"走与 `WorkspaceProjectList.onOpen` 相同的 `openDirectory(path)` 路径；
- 可选加固（实施时单独评估）：初始化进非空目录时在对话框中列出"该目录已有 N 个条目"，进一步降低误操作率；不属于本 spec 的必需范围。

## 5. 边界情况

- 目录同时是项目又含子项目：不会发生本流程（`open_project` 已成功）；
- 子目录里的项目本身损坏（有 `gal.project.json` 但元数据解析失败）：`list_projects` 后端会跳过该项（`loader.rs` 的过滤逻辑），不会列出打不开的条目；损坏项目的表现由 project report 链路负责，不在本 spec 范围；
- 路径规范化（大小写、`\\?\` 前缀、末尾分隔符）已由后端 `canonicalize` 统一处理，前端无需特判；
- Windows 选择器停在父目录是本 spec 的主要触发场景，但流程对任何"非项目目录"一致生效。

## 6. 验证与测试（实施时）

按仓库 TDD 约定先写测试：

- 前端 `ProjectList` 测试：mock `open_project` 抛出"缺少 gal.project.json"、mock `list_projects` 分别返回 0 / 1 / N 个子项目，断言三种对话框形态与"打开子项目"跳转；
- 初始化路径回归：无子项目时现有"添加工程文件"流程行为不变；
- 验证命令：`pnpm --filter @vibegal/studio test`、`pnpm --filter @vibegal/studio build`。
