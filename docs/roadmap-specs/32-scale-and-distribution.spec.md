# Spec 32 — Scale & Distribution（规模与分发）

> 状态：待实施（2026-07-27 定稿）。
> 目标版本：`1.0.0`。
> 基线：P3 `0.4.0` 收口提交。
> 来源：[Review 28 §4 P4](./28-product-review-and-roadmap.md)。

## 0. 目标

P4 让 Studio 从功能完整的创作工具进入可维护、可扩展、可分发的 1.0 状态：

1. 导出作品拥有项目自己的图标、版本、窗口标题和分辨率策略；
2. 仓库提供签名、公证和自动更新的安全流水线，不在源码保存凭据；
3. 以可重复的 1000 节点/500 资产项目锁定性能预算；
4. 大型工作台按行为边界拆分而不重写产品；
5. Studio 提供中英文界面，并与作品 locale 共享标签规范而非内容存储；
6. 写盘、外部修改和 `.galstudio` 产物边界适合 Git 协作。

## 1. 分发元数据

### 1.1 项目契约

在项目设置中加入可选 distribution 配置，保持旧项目 fallback：

```json
{
  "distribution": {
    "version": "1.0.0",
    "productName": "兵装心智体",
    "icon": "assets/icon.png",
    "viewport": { "mode": "fit", "width": 1280, "height": 720 },
    "updates": { "channel": "stable" }
  }
}
```

- 作品标题默认仍来自 `meta.title`；`productName` 只覆盖安装包/窗口显示名，不制造第三个内容标题；
- version 使用 semver，缺省 `0.1.0`，不复用 Studio 自身版本；
- icon 必须是已登记或项目内安全路径，构建时转换为各平台尺寸，不改写源图片；
- viewport mode：`fit`（保持比例留边）、`fill`（保持比例裁切）、`responsive`（renderer 决定）；
- width/height 是设计尺寸，不强制操作系统窗口不可缩放；
- 元数据写回项目必须由作者明确保存，打开/预检/构建不自动改项目。

### 1.2 构建目标

Web、Electron 和 Tauri 使用同一个规范化 metadata 结果：

- HTML title、窗口 title、包显示名一致；
- Web manifest/icon、Electron/Tauri bundle icon 从同一源派生；
- 作品版本进入构建产物元数据和诊断报告；
- 缺失或不可转换的图标在普通构建中 warning、严格构建中 error；
- 构建 staging/output 继续执行路径安全和 no-overwrite 约束。

## 2. 签名、公证与自动更新

### 2.1 安全边界

- 证书、私钥、Apple/Windows 凭据和更新签名 key 只来自 CI secret/本机 keychain；
- 不提交真实凭据、base64 key 或个人 team id；
- PR/普通 CI 只执行无签名构建；tag/release 的受保护 job 才能签名；
- 日志屏蔽 secret，不把签名命令的敏感参数打印出来；
- 没有凭据时发布检查明确报告“未签名演练”，不能伪称公证完成。

### 2.2 平台流水线

- macOS：universal/目标架构构建 → codesign → notarize → staple → 验证；
- Windows：构建 installer → Authenticode 签名 → 验证；
- Linux：生成现有支持的无签名包并记录 checksum；
- release manifest 含版本、平台、架构、URL、sha256 和签名；
- 自动更新只接受受信签名且版本高于当前作品版本的包；
- 下载/验签失败不破坏当前安装，支持安全重试；
- updater 默认关闭，只有项目提供 HTTPS endpoint 与 public key 才启用；
- 更新源、保留策略和回滚由文档明确，不在客户端保存发布凭据。

真实 Apple notarization 和 Windows 证书验证属于需要发布者凭据的外部验收。仓库完成标准是：配置、CI job、secret contract、mock/staging updater 测试、无凭据 dry-run 和操作文档全部可验证；外部凭据缺失必须列为发布前人工步骤。

## 3. 可重复性能基准

### 3.1 固定数据集

新增确定性生成器，产生：

- 1000 个节点，分属固定数量章节；
- 线性、选择和自动条件分流的稳定混合；
- 500 个资源登记，包含图片、音频、视频、字体和角色表达；
- 固定 locale/voice/故事状态/解锁规模；
- 只生成小型占位资源或元数据，不提交 500 个大二进制文件；
- 相同 seed 生成字节稳定的项目，供 CI 和本机复现。

### 3.2 场景与预算

在受控 Chromium/browser harness 中记录：

| 场景 | 1.0 预算 |
|---|---|
| 打开大项目到首个可交互工作台 | 本机基线 p95 ≤ 3 s |
| 资产总览首次呈现 | ≤ 1 s，DOM 卡片受窗口化上限约束 |
| 资产搜索输入响应 | p95 ≤ 100 ms |
| 章节/节点列表滚动 | p95 frame ≤ 32 ms |
| 图画布初次可操作 | ≤ 2 s，不一次挂载全部重型详情 |
| 单节点编辑与保存 | p95 ≤ 150 ms（不含磁盘异常） |
| 峰值 JS heap | 基准报告并设相对回归阈值 ≤ 20% |

绝对时间受机器影响，不把开发者笔记本数字直接作为跨平台硬门禁。CI 以相同 runner 的基线文件和相对回归阈值判定，报告原始数据、环境与 commit。

### 3.3 优化策略

- AssetGrid、章节/节点列表和长故事状态列表使用可访问的窗口化；
- 搜索、筛选和引用分析在数据层 memoize，避免每张卡重复扫描项目；
- 大图使用尺寸合适的缩略图和按需原图，失败时保持文件信息可见；
- graph 视图先加载节点摘要，选中/预览时再读取完整 node data；
- 后端提供批量摘要/按节点读取命令，React 不直接读文件；
- 导出和全局分析能显式请求全量数据，懒加载不能造成漏报；
- 不以无限缓存换速度，项目切换和 watcher 更新要释放/失效。

## 4. 大型工作台拆分

重构顺序固定为 `AssetsWorkspace` → `ExportWorkspace` → `ScriptWorkspace`，每个主题独立提交。

### 4.1 行为边界

- UI 子组件只接收 typed props，不拥有 Tauri 文件操作；
- 数据加载、revision/mutation queue、外部冲突和用户 draft 分别进入独立 hooks/state machine；
- reducer/event 使用产品动作命名，不把多个布尔值继续扩散；
- 弹窗与 async operation 有显式 idle/running/succeeded/failed/cancelled 状态；
- 现有 exported helpers、测试夹具和可访问标签尽量保持，必要变更单独说明。

### 4.2 重构纪律

- 先补行为回归测试，再移动代码；
- 纯重构提交不修改项目 schema、文案或持久化 payload；
- 每拆一个 workspace 都运行 focused tests、Studio typecheck、build 和 `git diff --check`；
- 不为追求行数把强耦合逻辑切成无意义文件；目标是状态所有权清楚和可独立测试。

## 5. Studio i18n

### 5.1 共享与隔离

Studio 与作品本地化共享：

- BCP 47 locale 规范化；
- current/default/fallback 的选择算法；
- ICU-free 的稳定 message key 约定和缺失诊断基础。

两者不共享内容存储：

- Studio messages 随应用构建，不能写进用户项目；
- 作品 locale 继续位于 `content/locales`；
- 切换 Studio 语言不修改项目或玩家作品语言。

### 5.2 首期语言与迁移

- 内置 `zh-CN` 和 `en`；默认跟随系统，用户选择存入应用设置；
- 所有顶层导航、工作台标题、主要按钮、表单标签、空态、toast 和错误摘要迁移为 key；
- 文件路径、稳定 ID、CLI flag、错误详情保留原值；
- 动态句子使用参数化 message，不拼接依赖中文语序的片段；
- 缺失英文时开发/测试报错，生产 fallback 到 zh-CN；
- `docs/vocabulary.md` 增加中英产品词汇对照，保持“创作者语言”原则。

## 6. Git 友好度

### 6.1 最小写盘与稳定序列化

- 打开、预览、validate 和 schema 检查不写项目；
- 只在规范化内容实际变化时写盘，no-op save 不更新 revision/mtime；
- JSON 使用固定缩进、结尾换行和稳定对象键策略；作者有语义顺序的数组（章节、节点顺序、指令、分流）不得排序；
- 单节点修改只写对应 node 文件；manifest/meta/graph/variables/locale 各自保持独立 mutation；
- generated index/cache 不混入 source 文件。

### 6.2 `.galstudio` 边界

- `.galstudio/` 只放可再生缓存、诊断、预览和应用私有项目状态；
- 项目运行所必需的 schema/内容不得只存在 `.galstudio`；
- 默认 `.gitignore` 忽略 `.galstudio/`，模板和初始化提供注释明确的规则；
- 既有项目未忽略时只提示，不擅自修改其 `.gitignore`；
- 清除 `.galstudio` 后项目仍可完整打开、校验、编辑和导出。

### 6.3 外部冲突

- 继续使用 revision guard，增加 base/local/external 三方可视化摘要；
- 提供“保留我的修改”“载入磁盘版本”“复制差异后手动处理”，不做不可靠的自动 JSON merge；
- 删除、重命名和 watcher burst 有明确状态；
- 冲突解决前禁止覆盖性保存，但允许复制 draft 和只读浏览；
- 每次解决动作记录目标路径和 revision，不记录项目正文遥测。

## 7. 验收矩阵

| 能力 | 必须验证 |
|---|---|
| 元数据 | title/productName 边界、semver、icon fallback、三目标一致、viewport |
| 发布 | unsigned CI、secret contract、签名 job 条件、checksum、mock updater、失败回滚 |
| 基准 | 确定性生成、环境记录、raw report、相对阈值、1000/500 数据完整 |
| 虚拟化 | DOM 上限、键盘/读屏、搜索/选中/滚动保持、无漏项 |
| 懒加载 | 摘要/详情、watcher 失效、全局分析/导出显式全量、项目切换释放 |
| 重构 | 三 workspace 行为 snapshot、mutation/revision、错误/取消、无 payload 变化 |
| Studio i18n | zh-CN/en、系统/手动选择、fallback、参数化动态文本、无项目写入 |
| no-op save | mtime/revision 不变；实质修改只写目标文件 |
| `.galstudio` | 可删除、默认忽略、旧项目只提示、无 source dependency |
| 冲突 | 三方摘要、三个安全动作、删除/重命名、禁止覆盖保存 |

## 8. 提交边界

P4 按以下顺序独立提交：

1. 本实施 spec；
2. distribution schema、Studio 设置与三类导出元数据；
3. 签名/公证/自动更新安全流水线与文档；
4. 大项目生成器、基线与 benchmark 报告；
5. 列表虚拟化、缩略图和节点懒加载；
6. AssetsWorkspace 拆分；
7. ExportWorkspace 拆分；
8. ScriptWorkspace 拆分；
9. Studio zh-CN/en i18n；
10. no-op save、稳定序列化、`.galstudio` 与冲突可视化；
11. `1.0.0` 文档、版本、安装/更新 dry-run 与全量门禁。

需要真实平台凭据的验证在最终报告中单列“外部发布验收”，不阻塞仓库内 1.0 工程收口，但不得被描述为已完成的真实签名/公证。未经用户明确要求不 push、不创建 PR、不打 tag、不发布。
