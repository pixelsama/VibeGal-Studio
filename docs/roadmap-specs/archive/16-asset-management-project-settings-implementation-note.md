# 16 — Asset Management / Project Settings Implementation Note

> 状态：已完成。
> 类型：实现说明，不是新规划 spec。
> 基线：`51c57ee feat: add default gallery replay music endings ui`。

## 完成范围

本次补齐 Studio 作者工具里的两块缺口：

- 资产页扩展分类：CG、视频、字体、UI Skin、动画图集；
- 项目设置页完整表单：项目标题、默认打字速度、默认自动播放间隔、章节间隔、舞台分辨率。

## 资产管理

资产扫描的前后端 kind 已扩展：

- `cg` → `content/assets/cg/`
- `video` → `content/assets/videos/`
- `font` → `content/assets/fonts/`
- `ui` → `content/assets/ui/`
- `animation` → `content/assets/atlases/` 或 `content/assets/animations/`

资产页左侧分类现在包含这些扩展类型。对应分类支持导入，导入后会登记到 `content/manifest.json`：

- CG：`manifest.cg[id] = { path, name }`
- 视频：`manifest.videos[id] = { path, name }`
- 字体：`manifest.fonts[id] = { path, family }`
- UI Skin：`manifest.uiSkins[id] = { name, assets: { default: path } }`
- 动画图集：`manifest.animationAtlases[id] = { image }`

扩展分类页新增 manifest 编辑面板。编辑不会立即写盘，而是进入现有 manifest 草稿流，通过底部“保存改动”统一保存。

同时补齐了扩展类型的引用统计、悬空引用识别、删除资产时的 manifest 引用清理。缩略图、poster、atlas json 等可选文件会作为独立引用处理。

## 项目设置

项目设置页现在直接编辑 `content/meta.json` 的核心项目级字段：

- `title`
- `typingSpeedCps`
- `autoAdvanceMs`
- `chapterGapMs`
- `stage.width`
- `stage.height`

保存时保留未知 meta 字段，只覆盖上述稳定 contract 字段。表单仍复用 revision 检查、草稿恢复、离开页面拦截和 Cmd/Ctrl+S 保存。

## 边界

本次没有实现：

- 批量标签编辑；
- 自动缩略图生成；
- 资产使用方跳转；
- UI Skin 任意资源槽新增器；
- 动画图集 json/image 配对向导；
- Live2D、Spine、shader、particle 等尚未进入当前 manifest contract 的类型。

这些属于后续高级资产工作流，不影响本次把既有 manifest contract 暴露为可导入、可分类、可编辑的 Studio UI。

## 验证

新增和更新的测试覆盖：

- 前端资产 helper：扩展资产登记、引用计数、删除引用清理、悬空引用识别；
- 前端资产 UI：扩展分类和导入入口；
- Rust 后端：`list_assets` 能识别扩展资产目录；
- 项目设置 helper/UI：完整 meta 表单读取、dirty 判定、草稿恢复、保存时保留未知字段。
