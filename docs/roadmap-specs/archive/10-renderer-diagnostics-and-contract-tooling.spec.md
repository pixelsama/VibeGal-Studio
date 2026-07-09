# Spec 10 — Renderer Diagnostics And Contract Tooling

> 状态：已归档。
> 前置：[Spec 02](../archive/02-renderer-runtime-api.spec.md)、[Spec 05](../archive/05-export-packaging.spec.md)。
> 目标：让 renderer contract 检查和错误定位成为 Studio、CLI、export 共用的正式工具链。

## 1. 背景

V1 已经：

- breaking 迁移到 `contractVersion: 1`；
- 默认 renderer 和 sample renderer 补 `contractVersion`；
- Web export worker 能打包 selected renderer；
- unsupported bare import 能在 build 时失败。

但仍缺：

- 独立 `vibegal-cli renderer-check`；
- Studio renderer 加载错误的统一诊断模型；
- line/column/source snippet 的稳定结构；
- missing default export / wrong manifest id / contract mismatch 的一致错误码；
- dev runtime compiler 与 export worker 的诊断一致性。

## 2. 产品边界

tooling 负责：

- 编译/加载/manifest 契约检查；
- structured diagnostics；
- Studio 状态面板可定位；
- CLI 机器可读输出。

renderer 负责：

- 自己的 UI 和代码。

tooling 不负责：

- 自动修复 renderer 代码；
- 安装第三方依赖；
- renderer marketplace。

## 3. V1.1 决策

- 新增 `vibegal-cli renderer-check <project-path> [--renderer <id>] --format json|text`。
- Studio preview、renderer manager、Web export 共用同一套 `RendererDiagnostic` 类型。
- V1.1 仍不支持 renderer 第三方 npm 依赖；unsupported bare import 是 error。
- 诊断必须包含 `rendererId`、`code`、`message`、`file?`、`line?`、`column?`、`snippet?`、`step`。
- `contractVersion` 缺失是 error，不自动当作旧 renderer。

## 4. 功能范围

### 4.1 Diagnostic Model

```ts
interface RendererDiagnostic {
  severity: "error" | "warn";
  code: string;
  rendererId: string;
  step: "discover" | "read" | "compile" | "manifest" | "contract" | "runtime";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  snippet?: string;
}
```

### 4.2 CLI

支持：

```text
vibegal-cli renderer-check <project-path> --renderer default --format json
```

输出：

- `ok`;
- `rendererId`;
- `diagnostics`;
- non-zero exit code on error。

### 4.3 Studio UI

Renderer sidebar/status panel 展示：

- renderer id；
- 文件；
- 行列；
- error code；
- source snippet；
- copyable diagnostic。

## 5. 非目标

- 不支持第三方 npm 依赖。
- 不自动修复 renderer。
- 不做 renderer marketplace。
- 不做在线文档跳转。

## 6. 验收标准

- CLI 可独立检查 renderer。
- Studio preview 与 export 对同一错误给同一 code。
- unsupported bare import 报定位清晰。
- missing default export 报定位清晰。
- wrong manifest id 报定位清晰。
- missing/unsupported contract version 报定位清晰。

## 7. TDD 清单

| 测试名 | 断言 |
| --- | --- |
| `rendererCheckReportsUnsupportedBareImport` | unsupported import 有 renderer/file/line/column/code |
| `rendererCheckReportsMissingDefaultExport` | 缺 default export 有明确 code |
| `rendererCheckReportsWrongManifestId` | manifest id 与 renderer id 不符报错 |
| `rendererCheckReportsMissingContractVersion` | 缺 contractVersion 报错 |
| `studioRendererDiagnosticsMatchCliCodes` | Studio 与 CLI 对同一错误 code 一致 |
| `exportBuildUsesRendererDiagnostics` | export build 复用 renderer diagnostics |

## 8. 归档记录

- 2026-07-08：Studio 侧新增共享 `RendererDiagnostic` 模型与 `RendererDiagnosticError`。
- 2026-07-08：runtime compiler、renderer loader、preview/sidebar 可返回 renderer id、code、file、line、column、snippet、step。
- 2026-07-08：新增 `vibegal-cli renderer-check <project-path> [--renderer <id>] --format json|text`。
- 2026-07-08：unsupported bare import、missing default export、manifest id mismatch、missing/unsupported contractVersion 均有稳定 code。
- 2026-07-08：Web export worker 和 CLI build 复用同形 diagnostics；production Web runtime 不暴露 debug service。
