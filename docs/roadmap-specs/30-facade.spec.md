# Spec 30 — Facade（产品门面）

> 状态：实施中（2026-07-27）。
> 目标版本：`0.3.0`。
> 基线：`e9f7dfe24c22eaa66dd01ec5c92386b4e2caa434`。
> 来源：[Review 28 §4 P2](./28-product-review-and-roadmap.md)。

## 0. 目标

P2 把玩家第一眼看到的界面和作者调整它的工具，从“验证契约的样例”提升为可以直接使用的产品门面：

1. 默认界面风格修掉占位感和技术化文案，但保持 `default` id 与 renderer v1 行为兼容；
2. 外观工作台以主题、画布和少量高频调整为主，高级数值退到第二层；
3. Studio 用统一层次、对比、断行和第二强调色承载已有功能；
4. 新增独立的 `classic` 深色 ADV 界面风格，证明同一运行时契约可承载不同表达。

完成标志不是只换颜色，而是标题、剧情选择、HUD、菜单、设置和外观调整各自有清楚的视觉角色，并且现有项目、预览、导出与存档行为不退化。

## 1. 已确定的产品决策

### 1.1 `default` 与 `classic`

采用 Review 28 D3 的推荐方向，但不保留 default 的明确缺陷：

- `default` 保持现有 id、入口文件和 renderer v1 契约，进行可访问性、文案、状态表达、菜单配色和标题排版修复；
- `classic` 是新增的完整模板，采用经典深色 ADV 构图；
- 两者不得引入 renderer 私有的播放状态、计时器或存档实现；
- 旧项目未选择新模板时继续加载原有 default，不自动改写项目文件。

### 1.2 外观主题

主题预设是 **Studio 内置的完整外观 token 集**，应用时把值写入当前 `uiSkin.tokens`，不在项目格式中新增“继承”或远程主题概念：

- 首期提供 4 套：柔光、夜幕、纸页、霓虹；
- 应用预设后每个字段仍可微调；
- “恢复默认”恢复到当前界面风格公开的默认 token；
- 单字段恢复只删除/替换该字段，不影响其他覆盖；
- “恢复全部”继续沿用现有外观默认恢复流程；
- 不做用户自定义预设命名、导入或导出。

这个模型保持 `UiSkinSchema` 向后兼容，也让第三方 renderer 不必理解 Studio 的预设 id。

### 1.3 资产归属

- 标题 logo 与主视觉继续通过 renderer 已公开的 appearance assets/token 和项目资源引用表达；
- default/classic 自带安全 fallback，缺失资产时仍显示作品标题和菜单；
- 不把固定示例图片写进用户项目；
- 示例项目只在确有展示价值时显式引用资源。

## 2. 默认界面风格

### 2.1 标题画面

- 以 `meta.title` 为唯一作品标题来源；
- 提供 logo/标题区、主视觉留白区和有方向感的纵向菜单；
- “开始游戏”是主操作，“继续游戏/读取存档”等是菜单操作，禁用态仍可读；
- 按钮必须保留现有 `data-title-action` 和回调契约；
- 宽窄视口均不能遮挡标题或把菜单推出画面。

### 2.2 剧情选择与 HUD

- 剧情选项与标题/系统菜单按钮使用不同组件语义和视觉；
- HUD 使用图标、文字和 `aria-pressed`/高亮态表达自动与跳过，不显示 `ON/OFF`；
- 活动态只读 `NovelState.flags`，不建第二份状态；
- 移除玩家画面中的 `3/10` 等调试进度；
- 键盘焦点和禁用态达到可辨识对比度。

### 2.3 菜单与设置

- 菜单窗口与场景使用同一深浅色系，不再使用割裂的纯白面板；
- 玩家可见文案遵守 `docs/vocabulary.md`，移除 `MENU`、`CG Gallery` 和内部错误码；
- 文本速度、自动等待和音量使用玩家能理解的标签与单位说明；
- 设置控件变更后立即调用现有 runtime settings API；“应用设置”不再是必需步骤；
- 异步保存失败要回退或明确提示，不能显示已生效但实际未保存。

## 3. 外观设计工具

### 3.1 首屏层级

首屏顺序固定为：

1. 主题预设；
2. 可直接操作的舞台预览；
3. 当前选中部件的高频外观字段；
4. 折叠的“高级调整”。

不得把 CSS 名称、token 路径或裸数值作为首要导航。

### 3.2 颜色与恢复

- 色块必须显示 renderer 提供的真实默认值或当前覆盖值；
- hex、rgb/rgba、hsl/hsla 和 CSS 渐变不能错误回退成黑色；不适合原生色板的值仍通过文本框无损编辑；
- 每个字段显示“恢复默认”，只有存在覆盖且与 renderer 默认不同才启用；
- reset、preset 和画布操作都走现有 revision/mutation queue，冲突时保留 draft。

### 3.3 画布与高级参数

- 复用现有 `StageDesignView` 坐标、拖拽、缩放、边界钳制和键盘选择；
- 增加可发现的缩放控制与复位，不另建一套布局状态；
- x/y/width/height 等精确数值收进高级区域；
- 不支持 `layout-parts-v1` 的第三方界面风格只显示 token 编辑，不伪造可拖拽能力。

## 4. Studio 视觉第二版

- 卡片、分区、分隔和页面标题形成三级层次；
- 表单标签比辅助说明更醒目，不再看似禁用；
- 项目和设置类页面在足够宽时使用双列，窄屏回到单列；
- 路径、ID、hash 等长标识统一使用 `overflow-wrap:anywhere`，普通中文文案不逐字断裂；
- 主操作继续使用主强调色；当前位置、选中项和导航活动态使用第二强调色；
- 聚焦环不能只依赖颜色，危险操作不常驻抢夺视觉注意；
- 优先收敛共享 class/token，不要求本批机械迁移所有历史内联样式。

## 5. `classic` 界面风格

`classic` 第一版是 renderer v1 兼容的视觉/布局模板：

- 深色舞台、底部 ADV 对话框、紧凑 HUD、侧边系统菜单；
- 支持标题、剧情、选项、菜单、设置、存档、历史、鉴赏和回想等现有 screen；
- 使用与 default 相同的 `RendererProps`、runtime services 和错误边界；
- 有独立 manifest、appearance groups、fixtures 和快照；
- 可在项目创建/设置的现有界面风格流程中选择；
- 可被 Web、Electron 和 Tauri 导出；
- canonical 资源和所有打包镜像必须由 drift check 锁定。

P2 不为 classic 增加专属项目字段，也不改变 renderer contract version。

## 6. 文件安全与兼容边界

- 项目文件仍是事实来源，React 不直接访问文件系统；
- 打开旧项目不写盘，不自动应用主题或切换 renderer；
- preset 只在作者明确选择后保存；
- 所有 renderer 资源复制继续执行完整 preflight，不覆盖既有用户文件；
- default/classic 不执行项目内容提供的任意 HTML；
- 三方 renderer 缺少 appearance defaults 时安全降级为已有 token 编辑体验。

## 7. 验收矩阵

| 能力 | 必须验证 |
|---|---|
| 标题 | `meta.title`、fallback、四个 action、禁用态、窄视口 |
| HUD | 无 `ON/OFF`/调试计数；pressed state 来自 flags；键盘焦点 |
| 菜单设置 | 创作者/玩家词汇、场景同色、即时保存、失败反馈 |
| 外观预设 | 四套应用、预设后微调、revision 冲突、第三方 renderer fallback |
| 颜色 | 默认值、hex/rgb/hsl/gradient、无错误黑色占位 |
| 恢复 | 单字段隔离、恢复 renderer 默认、undo/draft/保存 payload |
| 画布 | 拖拽、缩放、复位、钳制、advanced、无 layout capability |
| Studio | 双列断点、长标识、标签对比、第二强调色、焦点环 |
| classic | 所有 screen、runtime callbacks、fixture/snapshot、Web/桌面 smoke |
| 漂移 | default 和 classic canonical/mirror/导出资源一致 |

## 8. 提交边界

P2 按以下顺序独立提交：

1. 本实施 spec；
2. default 标题/HUD/选择/菜单/设置；
3. 外观预设、真实颜色和字段恢复；
4. Studio 视觉第二版；
5. classic 模板及模板选择/导出；
6. `0.3.0` 文档、版本和 P2 全量门禁。

每批先补 focused tests，再实现，运行相关测试、漂移检查和 `git diff --check` 后提交。P2 结束运行完整 JS、Rust、build、schema/types、两套 renderer、docs、vocabulary、version 和 release smoke 门禁。
