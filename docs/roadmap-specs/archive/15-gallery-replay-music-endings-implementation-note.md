# 15 — Gallery / Replay / Music / Endings Implementation Note

> 状态：已完成。
> 类型：实现说明，不是新规划 spec。
> 基线：`7f9d14d feat: complete default renderer player ux`。

## 完成范围

本次把 Spec 09 留在数据层的四类玩家页面接入默认 renderer：

- CG Gallery；
- 回想；
- 音乐鉴赏；
- 结局列表。

默认 renderer 继续是项目本地模板代码，不变成 Studio 内置不可替换页面。三份默认 renderer 镜像保持一致：

- `packages/studio/src-tauri/resources/default-renderer/`
- `packages/studio/templates/default-renderer/`
- `examples/sample-novel/renderers/default/`

## Runtime Contract

新增或补齐的 renderer-facing 服务：

- `runtime.replay.start(replayId)`：按 `manifest.unlocks.replay[replayId].nodeId` 启动已解锁回想；
- `runtime.audio.playMusic(audioId, options)`：播放音乐鉴赏曲目；
- `runtime.audio.stopMusic(fadeMs)`：停止音乐鉴赏播放。

已有 `runtime.gallery` 继续负责查询解锁数据。默认 renderer 使用 `manifest.unlocks` 渲染完整登记列表，用 `gallery.isUnlocked()` 判定显示已解锁内容或锁定占位。

Web export 和 Studio preview 都接入这些服务。节点预览没有完整图上下文，回想启动仍会返回结构化 unavailable；音乐播放可用。

## Default Renderer UX

统一玩家菜单新增四页：

- `CG Gallery`：显示 CG 登记项；已解锁项可打开预览，未解锁项显示锁定占位；
- `回想`：显示回想登记项；已解锁项可启动对应节点；
- `音乐鉴赏`：显示音乐登记项；已解锁项可播放，页面提供停止音乐；
- `结局列表`：显示结局登记项；已达成项展示标题，未解锁项显示锁定占位。

默认 renderer manifest 新增 capability：

- `gallery-ui-v1`

## 边界

本次不实现：

- 标题画面；
- 回想结束后自动返回原剧情的完整模式栈；
- 音乐播放列表、循环模式 UI、进度条；
- Gallery 分组筛选、缩略图生成、视频 Gallery；
- 项目资产编辑器对 CG/video/font/ui skin/animation atlas/unlock registry 的完整作者工具。

这些仍属于后续资产/标题菜单/高级玩家体验任务。

## 验证

新增和更新的测试覆盖：

- engine runtime contract：回想启动只允许已解锁 registry 项；音乐鉴赏可播放/停止指定曲目；
- Web runtime：导出运行时能启动已解锁回想节点，能播放指定 BGM asset；
- default renderer：菜单页、CG Gallery、回想、音乐鉴赏、结局列表和 controller 命令可渲染/调用；
- renderer template drift：默认 renderer 三份镜像保持一致。
