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

## 原始报告

```bash
pnpm benchmark:scale -- benchmark-results/scale-latest.json
```

报告包含：

- 数据集计数；
- platform、architecture、Node、CPU、内存和可选 commit；
- 项目生成与核心文档读取的原始毫秒值；
- 浏览器场景清单与运行状态。

本批先建立数据与报告契约。受控 Chromium 的工作台交互、资产首屏、搜索、滚动、图画布、单节点保存和 JS heap 测量在列表窗口化与节点懒加载实现后启用；报告在此之前必须明确写 `browser.status: "not-run"`，不得伪造浏览器基线。

## 预算与回归规则

浏览器 harness 启用后沿用 [Spec 32](./roadmap-specs/32-scale-and-distribution.spec.md#32-场景与预算) 的 1.0 预算，并保存 raw report：

- 工作台首个可交互：本机基线 p95 ≤ 3 s；
- 资产总览首次呈现 ≤ 1 s，DOM 数有窗口化上限；
- 资产搜索输入 p95 ≤ 100 ms；
- 章节/节点列表滚动 p95 frame ≤ 32 ms；
- 图画布初次可操作 ≤ 2 s；
- 单节点编辑与保存 p95 ≤ 150 ms；
- peak JS heap 相对同 runner baseline 回归不超过 20%。

绝对预算用于本机验收；CI 使用相同 runner 的历史 baseline 做相对比较。任何报告必须记录环境和 commit。机器或浏览器版本变化时先建立新 baseline，不把环境漂移判作产品回归。
