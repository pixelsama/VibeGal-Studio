# Phase 1 — 工作台导航（Workspace Navigation）规格

> 前置：已读 [overview.md](./overview.md)。本阶段为 UI 地基，无后端改动。

## 1. 需求

把 `Workspace.tsx` 现有的 `Tab = "preview" | "editor"` 模型替换为三个顶层工作台：

```text
Render | Script | Assets
```

- **Render**：现有的渲染层选择 + Preview（即把当前「预览」标签的整体行为搬过来）。
- **Script**：本期为**过渡视图**——保留既有 `ScriptEditor`（章节 JSON 编辑）+ 一个 Preview 面板，
  保证既有章节编辑/预览不回归。Phase 3 起在这里长出图画布。
- **Assets**：占位页（「即将推出」），不做功能。

打开项目后默认落到 **Render**（保住既有预览的落地体验）。

## 2. 受影响代码

| 文件 | 改动 |
|------|------|
| `packages/studio/src/Workspace.tsx` | 核心改动：`Tab`→`WorkspaceId`，重排顶栏与内容区 |
| `packages/studio/src/features/preview/Preview.tsx` | 不改（Render 复用） |
| `packages/studio/src/features/editor/ScriptEditor.tsx` | 不改（Script 过渡视图复用） |
| 后端 `lib.rs` | **无改动** |

## 3. UI 结构

```text
┌─ 顶栏 ─────────────────────────────────────────────┐
│ ← 项目列表   <项目名>            渲染层 [select ▾] │   ← 既有顶栏，保留
├─ 工作台标签栏 ──────────────────────────────────────┤
│  Render │ Script │ Assets                          │   ← 新的三标签
├─ 内容区 ─────────────────────────────────────────── │
│  <对应工作台的组件>                                  │
└────────────────────────────────────────────────────┘
```

### 3.1 顶栏渲染层下拉的归属

`渲染层 [select]` 留在**顶栏**（全局可见，三个工作台都能切渲染层），与既有行为一致。
现状即如此，本阶段保持。

## 4. 详细改动：`Workspace.tsx`

### 4.1 状态类型

```ts
// 旧
type Tab = "preview" | "editor";
// 新
type WorkspaceId = "render" | "script" | "assets";
const [workspace, setWorkspace] = useState<WorkspaceId>("render");
```

### 4.2 标签栏

把两个 `TabBtn`（预览/编辑）替换为三个（Render/Script/Assets）。
`TabBtn` 组件签名不变（`active`/`onClick`/`children`），样式常量复用。

> 文案采用英文 `Render / Script / Assets`（与 plan 文档一致，作为产品术语）。

### 4.3 内容区分支

```tsx
{workspace === "render" && (
  <Preview key={`${rendererId}-${refreshKey}`} project={project} rendererId={rendererId} />
)}
{workspace === "script" && (
  <ScriptWorkspace project={project} rendererId={rendererId}
    refreshKey={refreshKey} onSaved={handleSaved} />
)}
{workspace === "assets" && <AssetsPlaceholder />}
```

### 4.4 新组件 `ScriptWorkspace`（过渡版）

新建 `packages/studio/src/features/script/ScriptWorkspace.tsx`，**本期**只做左右分栏过渡视图：

```text
┌─ ScriptWorkspace（过渡）──────────────────────────┐
│ 左：ScriptEditor（既有章节编辑，原样复用）          │
│ 右：Preview（同一项目 + 当前渲染层，key=refreshKey）│
└────────────────────────────────────────────────────┘
```

- 左侧直接渲染既有 `<ScriptEditor project onSaved />`（不改其内部）。
- 右侧渲染 `<Preview key={`${rendererId}-${refreshKey}`} project rendererId />`，复用顶栏的 `rendererId`。
- `onSaved`（来自 `Workspace.handleSaved`）透传给 `ScriptEditor`，保存后既刷新右侧预览也刷新 `Workspace` 的 `project`。
- **Phase 3 会替换本组件内部**为图视图，但 `ScriptWorkspace` 这个对外组件名/props 边界保持稳定，
  所以 Phase 1 先立这个壳。

> 为什么不直接在 `Workspace.tsx` 里并排写：把 Script 的内部布局收敛到 `features/script/` 下，
> 让 `Workspace.tsx` 只管「工作台选择 + 渲染层」，符合既有 `features/` 分域约定，并为 Phase 3 替换留口。

### 4.5 新组件 `AssetsPlaceholder`

新建 `packages/studio/src/features/assets/AssetsPlaceholder.tsx`，纯静态占位：
居中文字「Assets · 资源管理（即将推出）」，深色背景。无逻辑。

## 5. 边界情况

| 情况 | 处理 |
|------|------|
| 打开旧项目（只有 chapters） | 默认 Render，预览正常；切到 Script 仍能用既有章节编辑器 |
| 项目无渲染层（`rendererIds` 为空） | Render 显示既有「（无）」占位，行为不变 |
| 工作台切换时正在编辑未保存 | 本期**不**拦截（既有 ScriptEditor 也没有未保存拦截），保持一致；Phase 4 再考虑 |
| `project_changed` 热重载到达 | 既有 `refreshProject` 链路不变；当前工作台若是 Script，右侧 Preview 随 `refreshKey` 刷新 |

## 6. 验收标准

1. 打开一个项目（如 `examples/sample-novel`），顶栏出现 Render/Script/Assets 三标签。
2. 默认在 Render，预览与渲染层切换行为与改造前完全一致（**回归不破坏**）。
3. 切到 Script：左侧可用既有章节 JSON 编辑器编辑并保存，保存后右侧预览刷新。
4. 切到 Assets：显示占位页，不报错。
5. 返回项目列表再打开，仍默认 Render。
6. 工作台切换不重置渲染层选择（顶栏 select 状态跨工作台保持）。

## 7. 测试清单

本期为纯 UI 壳改动，既有前端测试都是纯逻辑且无 testing-library，**不新增单测**。
验收依赖手动检查（§6）。若后续引入组件测试框架，应补：
`ScriptWorkspace` 在 Script 标签下渲染、`AssetsPlaceholder` 在 Assets 标签下渲染。

## 8. 不在本期范围

- Script 内部的图画布（Phase 3）。
- 节点编辑器（Phase 4）。
- 任何后端/数据模型改动。
- Assets 的真实功能。
