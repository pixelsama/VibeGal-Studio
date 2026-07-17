# Spec 17 — Appearance Design Module（外观设计模块）

> 状态：已记录，暂缓开发。本 spec 是调研结论与候选方案的存档，等后续实测评估后再决定是否实施与如何分期。
> 目标：为"渲染器外观设计"提供交互式编辑能力，替代纯提示词 + 预览的 vibe 设计流程，同时不破坏数据优先、渲染器自由、No In-App AI 三条产品边界。

## 1. 背景与动机

当前项目渲染器（`renderers/<id>/index.tsx`）的外观几乎全部由外部 Agent 通过提示词生成 TSX 代码，再在 Studio 预览中查看效果。实测痛点：

- 微调成本高：改一个对话框圆角、透明度、位置都要一轮"提示词 → 生成 → 预览"；
- 不可视：无法直接在舞台上看着效果拖、拉、调色；
- 设计决策都埋在代码里，没有一份可 diff、可校验的"外观数据"。

2026-07 针对"能否嵌入开源设计工具"做了一轮调研，结论：**不嵌入任何现成项目，候选方案是自研 Token 化 + 外观面板（本文第 3 节）**。调研对象与排除理由见第 7 节。

## 2. 产品边界

本方案必须守住：

- **数据优先**：Studio 编辑的是项目数据文件（manifest / uiSkins），不是渲染器源码；外观面板本质是一个针对外观契约的结构化编辑器，与 graph 编辑器同性质。
- **渲染器自由**：token 协议是渲染器**可选择消费**的数据契约，不是强制 UI 框架。默认渲染器消费它作为参考实现；第三方渲染器可以忽略、部分消费、或定义自己的扩展 key。
- **No In-App AI 不变**：外观面板是纯交互 UI，不引入任何 AI 按钮、agent 会话、模型设置。
- **Agent 友好不变**：外观数据落地为 JSON，外部 Agent 与外观面板读写同一份文件，走既有 revision 冲突检测。

## 3. 方案概述（路径 A：Token 化 + 外观面板）

三个递进步骤，可独立交付：

1. **定义 token 协议**：为默认渲染器的外观决策定义一组有文档、有默认值的 design token，落在既有 `manifest.uiSkins` 注册表的 `tokens` 槽位（`packages/contracts/src/schema.ts` 已定义 `uiSkins: { name?, assets, tokens?: Record<string, string|number> }`，schema 与 Rust 校验均已就绪，目前无任何消费者）。
2. **默认渲染器改造**：把 `packages/studio/templates/default-renderer/`（与 `examples/sample-novel/renderers/default/` 同构）中对话框、名字框、选项按钮、HUD 等硬编码样式值改为读取 token，未提供 token 时回退到当前硬编码默认值（保证旧项目视觉不变）。
3. **Studio 外观 tab**：新增 workspace tab（接入点 `src/lib/navigation.ts` 的 `WorkspaceId` 与 `src/Workspace.tsx` 的 TabBtn/pane 分支，仿照 assets tab），用属性面板编辑 token，预览走既有 `useProjectPlayer` + `StageFrame` 热重载链路，持久化走既有 `save_manifest` 包装（`src/lib/tauri.ts`）。

后续可选升级（单独评估）：

- 舞台上直接拖拽/拉伸对话框等图层，写回几何 token（x/y/width/height）；
- 多 uiSkin 预设与一键切换；
- token 协议向第三方渲染器推广的文档化（renderer-contract 增补章节）。

## 4. Token 协议草案

命名建议采用分层点号 key，值限定为 `string | number`（受现有 schema 约束）：

```text
dialogueBox.x / .y / .width / .height      舞台坐标系内几何（px）
dialogueBox.bgColor / .bgOpacity / .radius / .padding / .borderColor
dialogueBox.textColor / .fontSize / .fontFamily / .lineHeight
nameBox.bgColor / .textColor / .fontSize / .visible
choiceButton.bgColor / .textColor / .hoverColor / .radius / .fontSize
hud.textColor / .bgColor / .fontSize / .visible
stage.fontFamily                           全局字体（可引用 manifest.fonts 的 family）
```

约定：

- 所有 key 可选；渲染器对缺失 key 使用内置默认值（即当前视觉）；
- 几何值以 `content/meta.json` 的 `stage` 为坐标系，与渲染器契约的 stage 约定一致；
- 颜色值为 CSS 颜色字符串，由渲染器自行解析；
- 协议以默认渲染器实际消费的 key 为准，在本文档与 renderer-contract 文档中同步维护。

## 5. 默认渲染器改造点

- 新增 `useUiTokens(manifest)` 之类的 hook：从 `manifest.uiSkins` 选取当前 skin（V1 可取第一个或约定 id），把 token map 解析为带默认值的结构化对象；
- `DialogueBox.tsx`、`Stage.tsx` 内的名字框/选项按钮/HUD 等硬编码 inline style 值替换为 token 读取；
- `index.tsx` 的 manifest 不变；token 缺失时输出必须与改造前像素级一致（回退值即现状值）。

## 6. Studio 外观面板

- 位置：第 5 个 workspace tab（渲染 / 脚本 / 资产 / 项目 / 外观），复用既有 `.gs-*` 样式与 CSS 变量主题；
- 布局：左侧属性分组（对话框 / 名字框 / 选项 / HUD / 字体），右侧即现有预览；修改 token → `save_manifest`（带 revision）→ watcher/刷新链路触发预览更新；
- 控件：颜色选择、数值滑杆、字体下拉（候选来自 `manifest.fonts`）、几何数值输入；V1 不做舞台拖拽；
- 空态：项目无 `uiSkins` 时提供"启用外观编辑"按钮，写入一个带注释性 name 的空 skin，不覆盖任何现有文件。

## 7. 已排除的备选方案（调研存档）

- **嵌入 nexu-io/open-design**（[repo](https://github.com/nexu-io/open-design)，Apache-2.0，TypeScript）：它是完整的独立桌面应用，核心价值在 agent 编排（MCP 接入 22 种 CLI、skills、模型路由），删除这些后只剩 iframe 预览壳（我们已有）；且把 agent 工作台塞进 app 直接违反 No In-App AI 边界。
- **嵌入 manalkaff/opendesign**（[repo](https://github.com/manalkaff/opendesign)，MIT）：本质是 markdown 提示词技能包，没有交互式设计界面，不解决痛点。零成本替代用法：装进外部 Agent（Claude Code / Codex 等）提升 vibe 渲染出图质量，无需改本仓库代码。
- **嵌入 GrapesJS / Craft.js 等搭建库**：组件模型与"TSX 渲染器契约"不匹配，底层仍需先做 token 数据模型，额外只买到一块画布。
- **Onlook 式可视化改写 TSX 源码**：需 AST 解析 + source map + 代码回写，工作量以周计且脆弱；编辑的是代码不是数据，违反"编辑器不拥有渲染器视觉 UI"的护栏。

## 8. 验证与测试（实施时）

按仓库 TDD 约定，行为变更先写测试：

- engine/contracts：`uiSkins.tokens` 解析与校验测试（多数已有，补齐 token 值类型边界）；
- 默认渲染器：token 缺失时渲染输出与现状一致的快照/结构测试；token 提供时正确覆盖；
- Studio：外观面板的 manifest 编辑走 `save_manifest` 且处理 revision 冲突；
- 验证命令：`pnpm test`、`pnpm --filter @vibegal/studio build`、`cd packages/studio/src-tauri && cargo test`、`pnpm run check:schemas`、`pnpm run check:doc-contract`。

## 9. 重新评估的触发条件

满足以下任一条件时重估本 spec：

- 默认渲染器外观 token 化覆盖率实测（硬编码样式值中可被 token 化的比例）低于预期（< 70%），说明协议设计需返工；
- 外部 Agent + 提示词技能包（如 manalkaff/opendesign）实测已能满足设计效率需求，面板价值下降；
- 出现更贴合本项目渲染器契约的可嵌入设计工具。
