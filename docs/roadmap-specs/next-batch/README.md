# Next Batch Roadmap Specs

> 状态：已决策，待开发。

本目录存放 V1 归档之后的下一批 spec。上一批归档内容见 [../archive](../archive/)。

本批目标不是重新规划整个引擎，而是补齐 V1 中刻意收束的能力：

1. 让 runtime persistence 从“类型与最小服务”进入真实保存、恢复、迁移。
2. 让 backlog、rollback、read skip/all skip 进入可用的播放控制层。
3. 让 Studio 的分析能力从数据层扩展到日常创作 UX。
4. 让 unlock、CG/video/replay/ending 从数据契约进入 runtime side-effect 和 renderer service。
5. 让 renderer contract 检查、错误定位、CLI renderer check 可独立运行。
6. 让 Web export 从可跑的 V1 进入可诊断、可复现、可包装的发行基础。

建议开发顺序：

1. [Spec 06 — Persistent Runtime Save And Restore](./06-persistent-runtime-save-and-restore.spec.md)
2. [Spec 07 — Playback History Rollback And Skip](./07-playback-history-rollback-and-skip.spec.md)
3. [Spec 09 — Unlock Media Replay Runtime](./09-unlock-media-replay-runtime.spec.md)
4. [Spec 08 — Studio Authoring Analysis UX](./08-studio-authoring-analysis-ux.spec.md)
5. [Spec 10 — Renderer Diagnostics And Contract Tooling](./10-renderer-diagnostics-and-contract-tooling.spec.md)
6. [Spec 11 — Export Hardening And Desktop Prep](./11-export-hardening-and-desktop-prep.spec.md)

可并行开发的部分：

- Spec 08 可与 Spec 06 / 07 并行做不依赖 runtime 的搜索、route coverage UI、asset cleanup dry-run。
- Spec 10 可与其他 spec 并行，前提是不改 renderer contract 形状，只做检查和诊断。
- Spec 11 的 Web export hardening 可并行；desktop wrapper 需要等 Spec 06 的持久化 adapter 稳定后再接。
