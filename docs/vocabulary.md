# 创作者词汇表

> 状态：现行产品词汇。Studio 界面、默认界面风格和面向创作者的文档应遵守本表。

VibeGal 的数据契约和源码需要稳定，创作者看到的语言则应直接表达创作意图。本表约束的是**显示名称**，不是序列化格式，也不要求重命名既有代码标识。

## 核心词汇

| 创作者界面使用 | 含义 | 不在创作者界面使用 | 稳定的内部名称示例 |
|---|---|---|---|
| **界面风格** | 决定游戏画面结构、交互和基础视觉的一套可执行实现 | renderer、渲染层 | `RendererManifest`、`rendererId`、`renderers/` |
| **外观** | 当前界面风格开放给作者调整的颜色、尺寸、布局和贴图参数 | skin、token（作为功能名称时） | `uiSkins`、appearance token |
| **故事状态** | 故事会记录、改变或用于判断的值 | variable、变量（作为产品对象时） | `variables.json`、`VariableRegistry` |
| **分流** | 玩家选择或故事状态判断后，剧情从一个节点去往另一个节点 | branch、edge（作为作者操作时） | `GraphEdge`、`edgeId` |
| **出口效果** | 走过一条分流后、进入目标节点前产生的故事状态变化 | edge effects | `edge.effects` |
| **属性面板** | 查看或编辑当前节点、当前剧本行属性的侧边面板 | Inspector | `NodeInspector`、`ScenarioInspector` |
| **资源登记表** | 项目中可供剧本和界面引用的资源登记数据 | manifest（作为界面名称时） | `content/manifest.json`、`ManifestSchema` |
| **CG 鉴赏** | 玩家查看已解锁 CG 的菜单 | CG Gallery | `gallery-cg`、`unlock.cg` |
| **清理预览** | 真正写盘前展示将移除哪些登记、保留哪些文件 | Cleanup dry-run | cleanup proposal |

## 中英产品词汇

Studio 的中文和英文界面使用同一组创作者概念。英文翻译同样不得把内部类型名或序列化字段暴露成产品名称。

| 中文 | English | 稳定内部名称示例 |
|---|---|---|
| 界面风格 | Interface style | `RendererManifest`、`rendererId`、`renderers/` |
| 外观 | Appearance | `uiSkins`、appearance token |
| 故事状态 | Story state | `variables.json`、`VariableRegistry` |
| 分流 | Route | `GraphEdge`、`edgeId` |
| 出口效果 | Exit effects | `edge.effects` |
| 属性面板 | Inspector | `NodeInspector`、`ScenarioInspector` |
| 资源登记表 | Asset registry | `content/manifest.json`、`ManifestSchema` |
| CG 鉴赏 | CG gallery | `gallery-cg`、`unlock.cg` |
| 清理预览 | Cleanup preview | cleanup proposal |
| 预览 | Preview | workspace id `render` |
| 脚本 | Script | workspace id `script` |
| 资产 | Assets | workspace id `assets` |
| 项目 | Project | workspace id `project` |
| 导出 | Export | workspace id `export` |

## 转场显示名

转场类型在表单和玩家可见说明中使用中文，项目文件与 Scenario DSL 继续使用稳定值。

| 显示名 | 稳定值 |
|---|---|
| 淡入 | `fade_in` |
| 淡出 | `fade_out` |
| 白场淡入 | `white_in` |
| 白场淡出 | `white_out` |
| 黑场 | `black` |

例如，属性面板显示「淡入」，保存到剧本的文本仍可以是 `@transition fade_in 1200ms`。显示名变化不能改写或迁移已有项目语法。

## 导出选项

Studio 用行为描述选项，不把 CLI 参数当作标签：

- **将警告视为错误**：存在警告时阻止构建；内部对应 `strict` / `--strict`。
- **仍然允许警告**：即使启用了上一项，警告也不阻止构建；内部对应 `allowWarnings` / `--allow-warnings`。
- 项目错误始终阻止构建，与这两个警告选项无关。

## 使用边界

下列内容面向创作者，必须使用本表的显示词汇：

- Studio 的标题、标签、按钮、菜单、空态、提示、toast 和错误摘要；
- 默认界面风格中玩家能看到的菜单与设置；
- 面向创作者的教程和操作说明。

下列内容以准确和兼容为先，可以保留内部术语：

- TypeScript/Rust 标识符、类型名、组件名、存储键和日志分类；
- Tauri 命令、CLI flag、JSON 字段、schema enum、诊断 code；
- 文件和目录的真实名称，如 `content/manifest.json`、`renderers/default/index.tsx`；
- Scenario DSL、代码示例、测试 fixture 和断言中的稳定序列化值；
- 开发文档、契约文档、历史评审和归档 spec。

必要时可以在错误详情中展示真实路径、`import`、capability 或稳定值，帮助作者定位文件；错误标题、行动建议和控件标签仍应先使用创作者词汇。
