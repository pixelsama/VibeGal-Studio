# P4 规模基准

P4 使用确定性 `scale-v1` 数据集固定优化输入，不把某台开发机器的绝对耗时当作跨平台门禁。

## 固定数据集

```bash
pnpm benchmark:generate -- /tmp/vibegal-scale-project
```

生成内容：

- 1000 个节点、20 个章节、999 条边；
- 线性、选择、条件自动分流和默认自动分流的稳定混合；
- 500 个主资产登记：背景、音频、CG、视频、字体各 100；
- 20 个角色表达、1 个故事状态、1 份含 1020 条消息的 locale；
- 小型占位文件，不提交生成项目；
- seed 固定为 `vibegal-scale-v1`，两次生成的完整文件树字节一致；
- 生成项目必须通过 `vibegal-cli validate` 且零诊断。

`benchmark.dataset.json` 是数据集自描述文件。改变规模或分布时必须升级 seed/schema 并重新建立 baseline，不能静默覆盖。

## 报告与受控浏览器场景

默认命令只生成数据与环境报告，不隐式启动浏览器：

```bash
pnpm benchmark:scale -- benchmark-results/scale-latest.json
```

此时 `browser.status` 必须为 `not-run`，并列出没有执行的场景。要运行真实 Studio 构建和受控 Chrome harness：

```bash
pnpm benchmark:scale -- benchmark-results/scale-latest.json --browser --require-browser
```

- `--browser` 会构建 Studio、启动 loopback Vite preview，并通过 Chrome DevTools Protocol 驱动真实 React 界面；
- `--require-browser` 在 Chrome 缺失或 harness 失败时让命令失败，适合验收和基线采集；
- `VIBEGAL_CHROME_PATH` 可指定 Chrome/Chromium 可执行文件；未使用严格模式时，缺失浏览器会诚实回退为 `not-run`；
- harness 在页面脚本执行前注入 typed Tauri IPC mock。项目数据由 Node harness 读取并经 IPC 返回，React 不直接读取项目文件。

报告包含：

- 数据集计数；
- platform、architecture、Node、CPU、内存和可选 commit；
- 项目生成与核心文档读取的原始毫秒值；
- 工作台、资产首屏、资产搜索、节点滚动、图画布、节点保存的原始样本和 p95；
- 运行期间每 25 ms 采样 `JSHeapUsedSize` 得到的 observed peak，以及结束时 heap；
- 窗口化 DOM 数、资产卡片重叠数、网格可访问元数据和 IPC 调用计数。

浏览器报告只在所有场景实际完成时写 `browser.status: "completed"`。搜索的第一轮、节点保存的前两轮结果作为显式 warm-up 单独记录，不混入 p95；滚动场景也丢弃前 8 帧预热。其余样本都等待对应操作完成并恢复可继续编辑状态后才进入下一轮。

保存同一 CI runner 的已完成报告后，可在后续运行启用 heap 回归门禁：

```bash
pnpm benchmark:scale -- benchmark-results/scale-latest.json --browser --require-browser \
  --baseline benchmark-results/scale-baseline.json
```

也可通过 `VIBEGAL_BENCHMARK_BASELINE` 指定 baseline。比较器要求 platform、architecture、CPU 型号/核心数、浏览器名和 viewport 完全一致；runner 不一致或任一浏览器报告未完成会失败，而不是把不可比数据当成基线。当前 observed peak 超过 baseline 20% 时，报告仍会写盘并把进程置为失败，便于 CI 保留原始证据。任一浏览器绝对预算或 DOM/可访问性断言失败也采用相同的写报告后非零退出行为。

## 预算与回归规则

受控 browser harness 沿用 [Spec 32](./roadmap-specs/32-scale-and-distribution.spec.md#32-场景与预算) 的 1.0 预算，并保存 raw report：

- 工作台首个可交互：本机基线 p95 ≤ 3 s；
- 资产总览首次呈现 ≤ 1 s，DOM 数有窗口化上限；
- 资产搜索输入 p95 ≤ 100 ms；
- 章节/节点列表滚动 p95 frame ≤ 32 ms；
- 图画布初次可操作 ≤ 2 s；
- 单节点编辑与保存 p95 ≤ 150 ms；
- peak JS heap 相对同 runner baseline 回归不超过 20%。

绝对预算用于本机验收；CI 使用相同 runner 的历史 baseline 做相对比较。任何报告必须记录环境和 commit。机器或浏览器版本变化时先建立新 baseline，不把环境漂移判作产品回归。
