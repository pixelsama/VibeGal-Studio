# Spec 12 — 资产与 Renderer 工作流产品化

> 状态：已归档。
> 前置：Assets 工作台、renderer discovery、runtime compiler、默认 renderer 模板均已存在。
> 目标：让资产和渲染层从“能运行”升级为可日常维护、可扩展、可调试的项目工作流。

## 0. 实现结果

本期已落地：

- `features/assets/ResourcePicker.tsx` 可按背景 / 音频 / 角色 / 表情筛选，并在缺失引用时保留当前值。
- `NodeEditor` 提供块编辑模式，`InstructionBlock` 已接入 `say.who` / `expr` 的资源选择器。
- `AssetAudioPreview` 提供音频试听、格式 / 大小 / 时长展示，并保证同一时间只播放一个预览音频。
- 资产页支持批量登记 orphan、批量移除 dangling refs、批量删除 orphan。
- Tauri / 前端已接通 renderer create / duplicate / rename / delete 工作流。
- `docs/renderer-contract.md` 与新项目 `.galstudio/renderer-contract.md` 已入仓。
- renderer dev/prod 加载回归由 `rendererLoader`、`runtimeCompiler` 测试和 studio build 覆盖。

本期未做自动模板迁移；`rendererTemplateVersion` 继续留给后续文档化阶段处理，不阻塞归档标准。

## 1. 需求

GalStudio 的创作体验依赖两条辅助工作流：

- 资产管理：图片、角色、表情、BGM、SFX、voice 能被导入、预览、登记、清理，并在脚本编辑时直接引用。
- renderer 管理：用户能创建、复制、切换、调试 renderer 层，并理解 renderer API contract。

当前两者已有基础，本期把关键闭环补齐到可归档状态。

## 2. 当前状态

资产已有：

- `list_assets`
- `import_asset`
- `delete_asset`
- `read_asset_preview_data_url`
- `save_manifest`
- orphan / dangling / duplicate ref 校验
- `CharacterEditor`

renderer 已有：

- `renderers/<id>/index.tsx` discovery。
- active renderer 持久化到 `gal.project.json`。
- dev `/@fs/...` 与 production runtime compiler 两条加载路径。
- 默认 renderer 模板。

缺口：

- 脚本编辑器不能直接选择资产。
- 音频缺少试听和元信息。
- 资产批量操作较弱。
- renderer 无创建/复制/重命名/删除 UI。
- renderer API contract 和模板版本没有显式管理。
- dev/prod renderer 加载缺少端到端回归。

## 3. 资产工作流规划

### Stage 1：资源选择器复用

建立统一组件：

```text
features/assets/ResourcePicker.tsx
```

用途：

- `bg.id` 选背景。
- `bgm.id`、`sfx.id`、`voice.id` 选音频。
- `char.id`、`say.who` 选角色。
- `expr` 根据角色联动选择表情。

要求：

- 可在节点块编辑器中嵌入。
- 当前引用缺失时保留值并显示错误。
- 可从 picker 跳转到 Assets 工作台对应资源。

### Stage 2：预览增强

图片：

- 背景缩略图。
- 角色 sprite 缩略图。
- 大图查看。

音频：

- BGM/SFX/voice 试听。
- 时长、大小、格式展示。
- 同一时间只播放一个预览音频。

后端新增：

- `read_audio_metadata` 可选；第一期可只用浏览器 Audio 加载 data URL 或 `convertFileSrc`。

### Stage 3：批量清理

支持：

- 批量删除 orphan assets。
- 批量移除 dangling manifest refs。
- 批量导入后自动登记。
- 导入重名时提供 rename 建议，不静默覆盖。

安全：

- 删除走 trash。
- manifest 保存走 revision。

### Stage 4：角色表情工作流

`CharacterEditor` 增强：

- 角色列表搜索。
- 表情缩略图网格。
- 重命名 expression id，并更新节点引用（需确认）。
- 检查默认表情是否存在。
- 从脚本引用反查使用次数。

## 4. Renderer 工作流规划

### Stage 1：Renderer 管理命令

新增 Tauri commands：

```rust
create_renderer(project_path, renderer_id, template_id)
duplicate_renderer(project_path, source_id, new_id)
rename_renderer(project_path, old_id, new_id)
delete_renderer(project_path, renderer_id)
```

要求：

- `renderer_id` 复用 `validate_plain_name`。
- 不覆盖已有目录。
- 删除 active renderer 时必须先切换或拒绝。
- 复制保留所有源码文件。

### Stage 2：Renderer 工作台 UI

Render 工作台左侧 renderer 列表增加：

- 新建
- 复制
- 重命名
- 删除
- 打开源码位置（可选）

右侧状态：

- 当前 renderer id。
- entry 文件是否存在。
- 编译错误。
- renderer API 版本。

### Stage 3：Renderer Contract

文档化：

- renderer 默认导出形态。
- `RendererProps` 字段。
- `NovelState` 关键字段。
- 资源路径解析方式。
- 支持的 bare imports。
- 禁止/不保证的能力。

建议文件：

```text
docs/renderer-contract.md
.galstudio/renderer-contract.md
```

### Stage 4：模板版本

项目内记录默认 renderer 模板来源：

```json
{
  "rendererTemplateVersion": 1
}
```

可放：

- `gal.project.json`
- 或 `.galstudio/project.json`

第一期只记录，不自动迁移。

### Stage 5：dev/prod 双路径回归

renderer 加载有两条路径：

- Dev：Vite `/@fs/...`
- Production：runtime compiler 读文件并 bundle

需要 smoke tests：

- 默认 renderer 能 dev load。
- 默认 renderer 能 runtime compiler load。
- 多文件 import 能 load。
- unsupported bare import 给出可读错误。

## 5. 数据与校验

新增 project issues：

| source | code | 触发条件 |
| --- | --- | --- |
| `renderer` | `missing_active_renderer` | activeRendererId 不在 rendererIds |
| `renderer` | `missing_renderer_entry` | renderer 目录缺 index.tsx |
| `renderer` | `renderer_compile_failed` | runtime compiler 编译失败 |
| `asset` | `missing_default_sprite` | 角色缺 default 表情 |
| `asset` | `unused_asset` | orphan asset，可 warn |

是否把 `unused_asset` 当 issue 需谨慎；现有 orphan 已存在时可继续使用 asset report。

## 6. TDD 清单

### Rust

| 测试名 | 断言 |
| --- | --- |
| `create_renderer_copies_template_without_overwrite` | 新建 renderer 成功且不覆盖 |
| `duplicate_renderer_copies_source_files` | 复制 renderer 保留文件 |
| `rename_renderer_updates_active_renderer_when_needed` | 重命名 active 同步 meta |
| `delete_renderer_rejects_active_renderer` | active renderer 不可直接删 |
| `renderer_commands_reject_path_traversal` | id 越界拒绝 |

### Frontend

| 测试名 | 断言 |
| --- | --- |
| `ResourcePicker_keeps_missing_value` | 缺失引用不清空 |
| `ResourcePicker_filters_by_kind` | 按资源类型筛选 |
| `RendererSidebar_renders_management_actions` | renderer 管理入口存在 |
| `runtimeCompiler_reports_unsupported_import` | unsupported import 可读 |

### E2E / Smoke

| 场景 | 断言 |
| --- | --- |
| 导入背景并在节点中选择 | 保存后预览显示背景 |
| 复制 renderer 并切换 | activeRendererId 持久化 |
| production compiler 加载默认 renderer | 成功得到 default component |

## 7. 验收标准

1. 作者能从指令块直接选择背景、角色、表情、BGM。
2. 音频资源能试听。
3. orphan/dangling 资源能批量处理。
4. 用户能复制默认 renderer 为新 renderer 并切换预览。
5. renderer 编译失败时，错误指向 renderer id 和文件。
6. renderer contract 文档可让外部 Agent 创建合法 renderer。

## 8. 可归档标准

本 spec 可归档的条件：

- 资产选择器接入节点编辑器。
- 资产预览覆盖图片与音频。
- renderer 新建/复制/重命名/删除至少前三项完成；删除若推迟需拆 spec。
- renderer contract 文档进入仓库和新项目自描述文件。
- dev/prod renderer 加载有自动或手动 smoke 验收记录。

## 9. 不在本期范围

- 在线素材库。
- 图像编辑器。
- renderer marketplace。
- 自动升级用户 renderer 源码。
- AI 生成素材或 renderer。
