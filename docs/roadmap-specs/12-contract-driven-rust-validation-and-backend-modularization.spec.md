# Spec 12 - Contract-Driven Rust Validation And Backend Modularization

> 状态：规划中。
> 基线：`d9deeac fix: harden project editing and export pipeline`。
> 当前代码优先：实施时必须重新读取实际代码；本文用于约束目标和验收，不得用本文覆盖更新后的代码事实。
> 目标：让 `@vibegal/contracts` 成为 TS、Rust、CLI 唯一内容契约来源，并把 Tauri backend 从 `include!` 文本拼接重构为有编译器边界的正式 Rust 模块。

## 1. 背景与问题

当前 TypeScript 侧已经把 Zod Schema 集中到 `packages/contracts/src/schema.ts`，Engine 的类型由这些 Schema 推导。但是 Rust 仍存在第二套手写内容契约：

- `backend/node_validation.rs` 手写所有 Instruction tag、字段、枚举、范围和默认值。
- `backend/data_validation.rs` 手写 manifest/meta 的部分结构规则。
- `backend/graph_io.rs` 在统一结构校验之前手工读取字段、补默认值和转换整数。
- `backend/project_commands.rs` 的 `ProjectGraphInput` / `ManifestInput` 再次复制 graph/manifest 输入结构。
- TS、Rust、CLI 目前只通过少量共享 fixture 检查部分结果，没有机制保证完整一致。

当前已确认的真实漂移：

- Zod 允许 `manifest.audio` 及其子表缺省并应用默认值，Rust 当前报 `manifest_missing_audio` / `manifest_invalid_audio`。
- Zod 导出的整数上限是 `Number.MAX_SAFE_INTEGER`，Rust 的部分 `u64` 校验允许更大值。
- `graph.version` 在 Zod 中可大于 `u32::MAX`，Rust 当前转换成 `u32` 时可能截断。
- Zod 非 strict object 接受未知字段并在 parse 输出中剥离；Rust 只验证、不归一化，两者职责没有被明确区分。
- 合法 JSON 但 graph 结构非法时，部分路径直接成为 CLI `70`，没有返回结构化 issue。

Rust backend 虽然拆成多个文件，但 `backend/mod.rs` 使用 `include!` 把所有文件粘贴到同一个模块。结果是：

- `imports.rs` 的 import 对所有文件全局可见。
- 任意 backend 文件可以直接调用其他文件的私有实现。
- 编译器不能约束依赖方向和 visibility。
- `types.rs` 同时装载公共 DTO、应用设置和 watcher 私有状态。
- `fs_safety.rs` 同时负责路径、revision、atomic write、watcher debounce 和项目模板写入。
- 3209 行 `tests.rs` 依赖共享命名空间访问所有私有 helper，阻碍真正模块化。

模块审计还发现项目读取边界需要同步收口：`content/`、manifest、meta、graph 或 node 文件可能通过 symlink 指向项目外部；GUI 还可能把外部 `content/` 加入 asset protocol scope。

## 2. 产品和实施边界

本 spec 包含：

- contracts 驱动的 graph/node/manifest/meta 输入结构校验。
- contracts 驱动的稳定停点和 manifest 引用策略。
- TS、Rust、CLI 的稳定 issue code、severity 和 path 对齐。
- Rust 内容写入入口使用同一契约校验。
- Rust backend 正式模块化、窄 API 和测试拆分。
- ProjectRoot/ContentRoot 路径能力与 symlink 防护。
- 纯 Cargo、安装版 CLI 和 macOS/Windows bundle 验收。

本 spec 不包含：

- Renderer iframe/WebView 隔离。当前产品接受“用户显式信任后在主 WebView 执行”的边界。
- In-app AI、模型设置或 Agent 会话管理。
- 持久化事务日志或跨文件 durable transaction。
- 给安装版 CLI 内嵌 Node runtime。`validate` 必须无 Node；`build` 仍可暂时依赖系统 Node 或 `VIBEGAL_NODE`。
- UI 框架重写或新的编辑器功能。
- 把整个 Rust backend 拆成新的 Cargo workspace/crate。本期在现有 `app_lib` crate 内建立正式模块。

## 3. 不可变契约

实施期间必须保护以下行为：

1. 项目仍然 graph-first；不恢复 legacy chapters。
2. Tauri 前端 invoke command 名称和参数 JSON key 不变。
3. `ProjectData`、`ProjectIssue`、`GraphIssue` 的序列化字段名不变。
4. CLI validate 退出码保持：clean `0`、有 error `1`、仅 warning `2`、项目不可读 `70`。
5. graph/node/manifest/meta 校验不修改磁盘，也不把 Schema default 写回项目文件。
6. `gal.project.json`、`content/`、`renderers/` 的 native watcher 行为保持。
7. revision conflict、atomic write、trash、renderer canonicalize 和文件数量/大小限制保持。
8. Studio 与 Web export 继续使用同一个 TypeScript Engine；Rust 不接管剧情运行语义。
9. 项目内 `.galstudio/schemas` 只供外部工具参考，绝不能成为 Studio/CLI 的校验输入。

允许并要求修正的旧行为：

1. 缺少 `manifest.audio` 时按 canonical Zod default 视为合法，不再报 `manifest_missing_audio`。
2. graph version 必须在 contracts 中限制为 Rust 可安全承载的范围，禁止静默截断。
3. 合法 JSON 但不符合内容 Schema 时返回结构化 error issue；只有 JSON 语法损坏、路径不可读等情况返回 `70`。
4. 当前 Rust 漏报的完整 manifest/meta 结构错误将被补报。

## 4. 关键技术决策

### 4.1 使用生成 JSON Schema，而不是生成 Rust Instruction 枚举

Rust 不再维护完整 Instruction/Manifest Rust 类型作为校验器。`@vibegal/contracts` 导出 Draft 2020-12 input JSON Schema，Rust 直接编译并执行这些 Schema。

理由：

- 结构约束只有一个来源。
- 不引入另一套 generated type normalization 行为。
- Rust 可继续使用 `serde_json::Value` 读取外部项目，不要求先成功反序列化成庞大联合类型。
- 新增 Instruction 时无需重新生成和审阅大量 Rust 源代码。

Rust 允许保留一个供图算法使用的最小内部 `ProjectGraph` 投影视图。该视图只能在 Schema 校验成功或降级处理后构建，不得重复字段范围、枚举或 required 校验。

### 4.2 固定 JSON Schema validator

在 `packages/studio/src-tauri/Cargo.toml` 增加：

```toml
jsonschema = { version = "=0.33.0", default-features = false }
```

约束：

- 固定 Draft 2020-12。
- 关闭 HTTP/file resolver；产品 Schema 必须自包含。
- 保持 `rust-version = "1.77.2"`，不得为了依赖方便静默提升 MSRV。
- 若精确版本在实施时因 lockfile 或平台原因不可用，必须先提交证据并更新本 spec，不得自行换用最新版本。

### 4.3 Contracts 同时拥有结构和诊断元数据

新增 `packages/contracts/src/diagnostics.ts`，定义：

- 稳定 issue code。
- 默认 severity/source。
- deprecated instruction 的专用诊断。
- JSON Schema keyword 到产品错误类别的映射。

Instruction Schema 使用 Zod v4 `.meta()` 输出 `x-vibegal` 自定义 keyword。建议的生成形态：

```json
{
  "x-vibegal": {
    "instructionType": "bg",
    "storyPoint": false,
    "references": [
      {
        "kind": "registry",
        "registryPath": ["backgrounds"],
        "idField": "id",
        "missingCode": "missing_background_ref"
      }
    ]
  }
}
```

`say` / `char` 使用 `characterExpression` rule，声明 character id 字段、expr 字段和默认 expr。`unlock` 使用 `registryByDiscriminator` rule，声明 `kind` 到 `unlocks.cg/music/replay/endings` 的映射。

要求：

- TS `validateReferences` 和 Rust reference validator 消费同一份声明，不再各写一套 instruction switch。
- story point instruction 集合来自 metadata，不再在 TS/Rust 各维护 `say|narrate|wait|pause`。
- Rust 中不得硬编码任何合法 Instruction tag。
- deprecated `choice` 可以通过 diagnostics policy 保留 `choice_instruction_not_supported`，但不能重新加入 Instruction Schema。

### 4.4 原始输入、默认值和运行时归一化分离

定义三个阶段：

```text
raw JSON on disk
  -> input validation
  -> schema-defaulted in-memory clone for semantic checks
  -> TypeScript Zod runtime parse/transform for playback
```

规则：

- JSON Schema `default` 只是输入契约信息，validator 本身不会修改实例。
- Rust 可在 clone 上递归应用 object property default，以便 semantic validation 正确处理缺省 registry。
- clone 永不写回磁盘，也不替换 `ProjectData.content` 的原始 JSON。
- Zod transform，例如 string asset ref 转 `{ path }`，仍由 TypeScript runtime normalization 负责。
- TS/Rust parity 比较输入接受结果；只有明确需要的默认投影视图才比较 normalization。

### 4.5 Schema 作为编译期可信产物

生成物目录固定为：

```text
packages/studio/src-tauri/generated/contracts/
  nodeFile.schema.json
  graph.schema.json
  manifest.schema.json
  meta.schema.json
  diagnostics.json
  contract-manifest.json
```

`contract-manifest.json` 至少记录：

```json
{
  "formatVersion": 1,
  "generatorVersion": 1,
  "zodVersion": "4.4.3",
  "sourceSha256": {},
  "artifactSha256": {}
}
```

生成器位于 contracts package，由 pnpm 显式执行。`build.rs`：

- 读取 tracked manifest。
- 校验 source/artifact hash 和必需文件集合。
- 输出 `cargo:rerun-if-changed`。
- 产物不一致时 fail closed。
- 不调用 Node、pnpm、tsx，不从网络生成，不 fallback 到旧快照。

`app_lib` 通过 `include_str!`/`include_bytes!` 嵌入 crate 内生成物。GUI 与 CLI 必须使用相同字节。

当前 `docs/script-graph/schemas/*.json` 继续作为生成镜像保留，但不再是 Rust runtime source。`check:schemas` 必须验证 docs 镜像与 Rust 嵌入物字节一致。

项目初始化写入 `.galstudio/schemas` 时使用同一嵌入字节，不再由 `templates.rs` 跨目录引用 docs。

## 5. Rust Contract Validation 设计

目标模块：

```text
backend/contracts/
  mod.rs
  embedded.rs
  diagnostics.rs
  defaults.rs
  policy.rs
```

### 5.1 Embedded validators

`embedded.rs` 定义：

```rust
pub(crate) enum ContractSchemaKind {
    NodeFile,
    Graph,
    Manifest,
    Meta,
}
```

并通过 `std::sync::OnceLock` 懒编译 validator。Schema 编译失败属于产品构建错误，不得降级跳过校验。

### 5.2 Error normalization

统一输出内部结构：

```rust
struct ContractViolation {
    code: String,
    message: String,
    json_path: String,
    keyword: String,
}
```

要求：

- RFC 6901 instance pointer 稳定转换成现有 JSONPath，例如 `/3/id` -> `$[3].id`。
- 展开 `oneOf` / `anyOf` context，去重重复 leaf error。
- node array 先识别根类型；非 array 保持 `node_not_array`。
- 对每条 instruction 从生成 Schema 的 `t.const` 动态选 branch，再验证 branch。
- 未知/缺失/非法 `t` 产生 `instruction_unknown_type`。
- 已知 instruction 的字段问题产生 `instruction_invalid_field`。
- 错误排序固定为 file、jsonPath、code。
- 单文件最多输出固定数量的结构错误；超限增加一个稳定 truncation issue，避免异常输入制造海量 oneOf diagnostics。

必须保留的 node 语义 code：

- `instruction_id_missing`
- `instruction_id_duplicate`
- `missing_background_ref`
- `missing_bgm_ref`
- `missing_sfx_ref`
- `missing_voice_ref`
- `missing_character_ref`
- `missing_character_expr`
- `missing_unlock_ref`
- `missing_cg_ref`
- `missing_video_ref`
- `choice_instruction_not_supported`

manifest/meta 现有 code 尽量保持；与 canonical default 冲突的 `manifest_missing_audio` 按本 spec 删除。无法一一保留的结构错误必须在 `diagnostics.ts` 定义新的稳定 code，并同步 release note/fixture，不能直接暴露 jsonschema crate 的 Debug 文本。

### 5.3 Semantic policy executor

`policy.rs` 是通用规则执行器，只理解有限 rule kind，不理解具体 Instruction tag。

首期 rule kind 固定为：

- `registry`
- `characterExpression`
- `registryByDiscriminator`
- `storyPoint`

若 metadata 出现未知 rule kind，Rust validator 必须产生内部 contract error 或在启动测试中失败，不能静默忽略。

## 6. 写入入口收口

以下 project content payload 不再使用手写 Rust 镜像 DTO：

- `save_graph(graph)`
- `save_manifest(manifest)`
- node JSON 写入路径

实施规则：

- Tauri command 名称和参数 key 保持。
- graph/manifest 参数在 Rust 侧接收 `serde_json::Value`。
- 写入前使用嵌入 Schema 验证。
- graph node file 路径额外经过 `ContentRoot` path policy。
- 写入继续使用 expected revision 和 atomic write。
- `GraphPositionPatchInput` 等 Studio IPC 专用 DTO 可以保留，它不是项目内容 Schema 镜像。
- `ProjectMeta`、`AppSettings`、`CliToolStatus` 等应用 DTO 不属于 contracts，不进入本次删除范围。

通用 `save_file` 若继续承担 node 文件保存，必须按受控相对路径识别 `content/nodes/*.json`，解析 JSON 并调用 NodeFile Schema。不得允许 Studio 自身通过 generic command 绕开 contract validation。

外部 Agent 直接写磁盘的非法内容无法被阻止，watcher/openProject/CLI 必须及时报告。

## 7. Backend 最终模块结构

```text
packages/studio/src-tauri/src/backend/
  mod.rs
  api.rs
  tauri_app.rs
  resources.rs
  model/
    mod.rs
    project.rs
    graph.rs
    issue.rs
    settings.rs
  contracts/
    mod.rs
    embedded.rs
    diagnostics.rs
    defaults.rs
    policy.rs
  fs/
    mod.rs
    path.rs
    atomic.rs
    json.rs
    revision.rs
    trash.rs
  project/
    mod.rs
    loader.rs
    graph_io.rs
    assets.rs
    initialize.rs
    templates.rs
  validation/
    mod.rs
    aggregate.rs
    graph.rs
    node.rs
    asset.rs
  mutation/
    mod.rs
    file.rs
    graph.rs
    manifest.rs
    asset.rs
    project_meta.rs
  renderer/
    mod.rs
    catalog.rs
    source.rs
    mutation.rs
  watcher/
    mod.rs
    classify.rs
    debounce.rs
  settings/
    mod.rs
  cli_tool/
    mod.rs
  commands/
    mod.rs
    project.rs
    mutation.rs
    renderer.rs
    watcher.rs
    settings.rs
    cli_tool.rs
  tests/
    mod.rs
    support.rs
    project_loading.rs
    public_api.rs
```

允许根据实际依赖合并过小文件，但以下域边界不得合并回一个大文件：

- contracts
- path/filesystem
- validation
- project loading
- mutation
- renderer
- watcher
- Tauri commands/app wiring

### 7.1 依赖方向

```text
model
  ^
fs / resources / contracts
  ^
validation / project::graph_io / renderer::catalog
  ^
project::loader / project::initialize
  ^
mutation / renderer::mutation / watcher / settings / cli_tool
  ^
commands
  ^
tauri_app
```

规则：

- `validation` 接收数据并返回 issue，不打开项目、不写文件。
- `project::loader` 聚合读取和校验，不依赖 commands。
- `mutation` 不调用 `open_project`，不负责 UI refresh。
- `commands` 只做 Tauri 参数/state 适配并调用 service。
- `fs` 不依赖 project、watcher、templates 或 Tauri。
- watcher runtime state 不得放在公共 DTO 模块。
- renderer catalog/source 不得读取任意项目外路径。
- `resources.rs` 负责 bundled default renderer、CLI resource 等定位，不再把资源定位混入 settings。

### 7.2 Visibility

`pub` 只保留 crate 对 CLI/应用的稳定 façade：

- `run`
- `open_project_for_cli`
- `ProjectData`
- `ProjectMeta`
- `ProjectIssue`
- `GraphIssue`
- `GraphIssueSeverity`

跨 backend domain 的 service 使用 `pub(crate)` 或 `pub(super)`。实现 helper 保持 module private。不得为了迁移旧测试把所有 helper 改成 `pub(crate)`。

`lib.rs` 目标形态：

```rust
mod backend;

pub use backend::api::open_project_for_cli;
pub use backend::model::{
    GraphIssue, GraphIssueSeverity, ProjectData, ProjectIssue, ProjectMeta,
};

pub fn run() {
    backend::tauri_app::run();
}
```

### 7.3 Tauri command façade

26 个现有 `#[tauri::command]` 的 invoke 名称必须保持。command 函数变成薄适配器：

```rust
#[tauri::command]
pub(crate) fn save_graph(...) -> Result<Option<FileRevision>, String> {
    mutation::graph::save(...)
}
```

`commands/mod.rs` 统一重导出，`tauri_app.rs` 注册。不得在 domain service 上直接依赖 `AppHandle`，只有确实需要 asset protocol、dialog、event emit 或 app resource 的 adapter 可以依赖 Tauri。

## 8. ProjectRoot / ContentRoot 安全能力

新增不可随意构造的路径类型：

```rust
pub(crate) struct ProjectRoot(PathBuf);
pub(crate) struct ContentRoot(PathBuf);
```

必须提供窄方法，而不是向上层暴露任意 join：

- `ProjectRoot::open(path)`
- `ProjectRoot::content_root()`
- `ProjectRoot::read_project_json()`
- `ContentRoot::read_control_json(rel)`
- `ContentRoot::resolve_existing_asset(rel)`
- `ContentRoot::resolve_write_target(rel)`

安全策略：

- `content/` 目录本身不得是 symlink。
- `gal.project.json`、graph、manifest、meta、node 和 renderer source 拒绝 symlink。
- 所有 canonical path 必须位于对应 canonical root 内。
- 资产必须是 root 内 regular file；外部 symlink 不允许进入 asset scanner 或 asset protocol scope。
- 写入目标的已存在父目录逐级验证，不允许 symlink component 绕过。
- contracts validator 只使用 embedded product Schema，不读取 project `.galstudio`。

## 9. 错误与加载行为

错误分为：

| 类别 | 示例 | Studio | CLI |
| --- | --- | --- | --- |
| I/O/语法不可读 | JSON syntax error、权限失败、项目根不存在 | 打开失败 | `70` |
| 结构错误 | 字段类型、required、enum、strict extra field | 项目 issue；必要时安全降级视图 | `1` |
| 语义错误 | dangling edge、missing ref、duplicate stable id | 项目 issue | `1` |
| 警告 | missing stable id、orphan 等现有 warning | 项目 warning | `2`（无 error 时） |

Graph 是特殊情况：

- graph JSON syntax 不可读仍是 hard failure。
- graph JSON 可读但 Schema invalid 时必须产生结构化 issue，不再统一包装为 `open_project_failed`。
- loader 可返回空 graph 或只包含可安全投影的数据，但不得修改原始文件。
- 具体降级形态先由测试锁定，前端必须仍能显示问题并允许用户切换工作区/退出。

## 10. TDD Requirement Matrix

实现任何 production change 前，先添加对应测试并确认按预期失败。

| ID | 需求 | 首要可执行验证 |
| --- | --- | --- |
| C-01 | contracts 是四份输入 Schema 唯一来源 | generator unit test + schema drift check |
| C-02 | generated artifact 可追溯且不可陈旧 | build.rs source/artifact hash failure test |
| C-03 | docs、Rust embedded、project template 使用相同 Schema | byte/hash equality test |
| C-04 | Rust/CLI 不依赖项目 `.galstudio/schemas` | tampered project schema fixture |
| V-01 | 所有 Zod Instruction branch 自动被 Rust 接受 | 从 generated `oneOf` 枚举 branch 的共享 corpus |
| V-02 | 新 Instruction 不需要 Rust tag 改动 | schema-generated discriminator coverage test |
| V-03 | TS/Rust/CLI 结构 issue 对齐 | shared invalid corpus 比较 code/severity/path |
| V-04 | default 缺省语义对齐 | bg/char/audio/meta/graph default fixtures |
| V-05 | strict/non-strict 接受结果对齐 | unknown-field matrix |
| V-06 | reference 规则由 metadata 驱动 | 每种 registry/rule kind fixture |
| V-07 | story point 规则由 metadata 驱动 | missing/empty/duplicate ID matrix |
| V-08 | validation 不修改 raw JSON | before/after `Value` equality + disk hash |
| V-09 | graph.version 不截断 | `u32::MAX` 边界 fixture |
| V-10 | malformed graph 返回结构化 issue | Studio open + CLI exit/code test |
| W-01 | graph/manifest/node 写入走同一 Schema | Tauri service-level reject invalid payload tests |
| W-02 | command 名与 JSON 参数不变 | frontend wrapper + command smoke |
| P-01 | content/control file symlink 越界被拒绝 | ProjectRoot/ContentRoot Rust tests |
| P-02 | asset protocol 不授权项目外目录 | app adapter test or focused integration test |
| M-01 | backend 不含普通 `include!` | source policy check + cargo compile |
| M-02 | domain 依赖方向可由 visibility 强制 | compile + no broad re-export review |
| M-03 | CLI 只依赖 public façade | Cargo integration/public API test |
| M-04 | 26 个 invoke 名保持 | command registration contract test/smoke |
| R-01 | validate 无 Node、无 repo cwd 可运行 | installed CLI smoke |
| R-02 | pure Cargo offline/MSRV 可构建 | CI exact MSRV + offline job |
| R-03 | macOS/Windows bundle 无回归 | bundle + installed CLI validate/build/smoke |

## 11. Shared Corpus 规格

新增 canonical fixture，例如：

```text
packages/contracts/fixtures/validation-contract/
  valid.json
  invalid-structure.json
  invalid-references.json
  defaults.json
  strictness.json
  graph-errors.json
```

Fixture case 至少包含：

```json
{
  "id": "node.playVideo.invalid-skippable",
  "schema": "nodeFile",
  "input": [
    {
      "t": "playVideo",
      "id": "opening",
      "skippable": "yes"
    }
  ],
  "valid": false,
  "issues": [
    {
      "code": "instruction_invalid_field",
      "severity": "error",
      "jsonPath": "$[0].skippable"
    }
  ]
}
```

要求：

- TS contracts/engine test 直接消费。
- Rust lib test 直接消费。
- CLI test 用临时项目包装相同 case。
- 比较稳定字段，不比较 Zod/jsonschema 原始英文 message。
- 每个 Instruction branch 至少有一个 valid case；coverage 从 generated schema 自动检查，禁止手写“当前有 15 种”常量。
- manifest/meta/graph 每个 required、enum、range、strict/default 类别至少有代表 case。

## 12. 实施阶段

本 spec 是一个完整交付，不允许在任一中间阶段发布。实现可以按以下原子提交推进，每个提交保持测试可运行。

### Stage 0 - 锁定基线和失败测试

先完成：

- 记录当前 Engine、Studio、Rust backend、CLI 测试数和结果。
- 为 `ProjectData`、issue JSON、CLI validate output 增加稳定 contract/golden test。
- 添加已知漂移 fixture，并确认当前至少一端失败。
- 添加 content root / control JSON symlink 越界失败测试。
- 建立 Requirement Matrix 对应测试文件清单。

禁止先重排文件再补测试。

### Stage 1 - Contracts 生成链

实现：

- 把 schema export 所有权从 engine 移到 contracts。
- 增加 diagnostics 和 `x-vibegal` metadata。
- 固定 Zod 版本。
- 生成 crate-local artifacts、hash manifest 和 docs mirrors。
- 更新 root `check:schemas`。
- `build.rs` 只验证 tracked artifacts，不执行 Node。

Stage 完成时旧 Rust validator 尚可继续运行，但 generated artifacts 和 parity fixtures 必须已稳定。

### Stage 2 - Rust contracts adapter

实现：

- 加入固定 jsonschema 依赖。
- 嵌入并懒编译四份 Schema。
- 完成 pointer -> JSONPath、oneOf branch dispatch、dedupe、排序和限量。
- 完成 defaults clone 和 semantic policy executor。
- 让 Rust shared corpus tests 通过。

此阶段先以新旧 validator 并行测试比较，不在 production 聚合中重复输出 issue。

### Stage 3 - 切换所有结构校验和写入入口

实现：

- project loader 使用 contract validator。
- 删除 node 字段 helper 和 instruction switch。
- 删除 manifest/meta 手写结构 validator。
- TS `validate.ts` 使用 contracts diagnostics/policy。
- graph raw validation 先于内部投影。
- save graph/manifest/node 使用相同 contract gate。
- 删除 `ManifestInput` / `ProjectGraphInput` 内容镜像。

Stage 结束必须删除旧 production validator，不允许用 feature flag 长期保留双轨。

### Stage 4 - 路径能力收口

实现：

- 建立 ProjectRoot/ContentRoot。
- loader、mutation、asset、renderer 迁移到窄 API。
- 修复 content root 和 control file symlink。
- 确保 asset protocol 只授权 canonical content root。
- 保持 revision/atomic/trash 行为。

### Stage 5 - 正式模块化

迁移顺序：

1. model 与 public façade。
2. fs、resources、contracts。
3. validation 与 graph I/O。
4. project loader/initialize/templates/assets。
5. mutation 与 renderer。
6. watcher、settings、cli_tool。
7. commands 与 tauri_app。
8. 按域拆分 tests。

完成后删除：

- `backend/imports.rs`
- 原 `backend/tests.rs`
- 被新模块替代的 monolithic 文件
- `backend/mod.rs` 中全部普通 `include!`
- engine 旧 schema export 实现（若无真实公共消费者）

临时 root re-export 只允许存在于迁移提交中，最终提交必须清理。

### Stage 6 - CI、发布和文档收尾

更新 CI：

- pnpm contracts generation/drift。
- `cargo test --locked`。
- `cargo build --locked --bins`。
- exact MSRV `1.77.2` check。
- 在安装 Node 前运行 pure Cargo validate tests。
- `cargo fetch --locked` 后 `CARGO_NET_OFFLINE=true cargo test --locked`。
- 从不同 cwd、含空格路径运行 CLI validate。
- macOS/Windows bundle 后运行 installed CLI validate。
- 保留 installed CLI build 和 browser smoke。

文档更新只描述最终真实结构；历史 spec 不作为实现依据。

## 13. 每阶段验证命令

最窄测试先运行，再扩大：

```bash
pnpm --filter @vibegal/contracts build
pnpm --filter @vibegal/engine test
pnpm run check:schemas

cargo fmt --check --manifest-path packages/studio/src-tauri/Cargo.toml
cargo check --locked --all-targets --manifest-path packages/studio/src-tauri/Cargo.toml
cargo test --locked --lib --manifest-path packages/studio/src-tauri/Cargo.toml
cargo test --locked --bin vibegal-cli --manifest-path packages/studio/src-tauri/Cargo.toml

pnpm --filter @vibegal/studio test
pnpm --filter @vibegal/studio build
pnpm smoke:release
pnpm build
git diff --check
```

实现中如命令名称与实际 package script 不符，应先读取当前 `package.json` 后使用真实命令，不得为了满足本文凭空新增无价值 wrapper。

## 14. 最终验收标准

全部满足才可把 spec 标记为完成：

1. 新增/修改一个 Zod Instruction 后，不修改 Rust 源码即可正确进行结构校验。
2. Rust validator 不硬编码 Instruction tag、字段、枚举、范围或默认值。
3. TS、Rust、CLI 对 shared corpus 的 valid/code/severity/jsonPath 一致。
4. Rust reference/story point validator 由 contracts metadata 驱动，不按 tag 写 switch。
5. graph/manifest/meta/node 写入入口不能绕过 embedded contract。
6. 项目 `.galstudio/schemas` 被篡改时，Studio/CLI 结果不变。
7. Rust backend 下不存在普通 `include!` 或共享 `imports.rs`。
8. 26 个 Tauri invoke 名称、ProjectData JSON 和 CLI public façade 保持。
9. ProjectRoot/ContentRoot 阻止 content/control file/asset symlink 越界。
10. CLI validate 在无 Node、无源码仓库、任意 cwd 下运行。
11. exact MSRV、locked/offline Cargo、全量 pnpm、Tauri bundle 和安装后 smoke 通过。
12. 工作区无未解释 diff，提交仅包含本 spec 范围改动。

## 15. 禁止的捷径

- 不得让 Rust 读取项目自己的 `.galstudio/schemas`。
- 不得在 `build.rs` 执行 pnpm/Node 或网络请求。
- 不得把 Schema 仅作为 Tauri runtime resource；独立 CLI 必须拥有同一嵌入字节。
- 不得保留新旧 validator 双轨并只用 fixture 掩盖差异。
- 不得用新的手写 Rust tag/field 数组替代旧 match。
- 不得直接展示 jsonschema/Zod 原始 message 作为稳定机器接口。
- 不得为了旧 tests 把所有 helper 改成 `pub(crate)`。
- 不得只移动文件而不建立依赖方向和 visibility。
- 不得在模块化过程中改变 Tauri command 名或 camelCase IPC key。
- 不得通过关闭失败测试、放宽 Schema 或删除安全检查获得绿色构建。
- 不得顺便实现 renderer 沙箱、in-app AI、事务日志或其他非目标。

## 16. 提交与交付建议

建议提交顺序：

```text
test: lock contract parity and path boundaries
feat: generate embedded contracts for rust validation
refactor: replace rust schema mirrors with contract validation
fix: constrain project content paths and symlinks
refactor: modularize tauri backend boundaries
ci: verify offline contracts and installed cli validation
```

这是一个交付单元；最后一个提交前不应对外宣称迁移完成。最终 PR/提交说明必须列出有意行为变化、共享 corpus 结果、CLI 退出码验证和未改变的产品边界。
