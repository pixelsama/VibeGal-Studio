# Codex 适配说明

Codex 不负责自行常驻监控。安装在 `../exchange/runtime/codex/` 的本地调度器监听 `../exchange/mailboxes/codex/pending/`，每次认领一条消息后启动一次 Codex。

- 调度器按 `test_request → ../exchange/roles/test-agent.md`、`test_result → ../exchange/roles/development-agent.md` 选择角色。
- 以调度器给出的角色文件为身份权威；不得从项目级 `AGENTS.md`、分支名或目录名推断身份。
- 使用 `--agent codex` 调用共享邮箱 CLI；只读已经认领到 `processing/` 的消息。
- 最终结构化输出必须准确列出 `outputMessageIds`。测试请求以及失败、过期或阻塞的测试结果必须生成后续消息；`passed` 结果是终态确认，可以使用空数组并直接归档。
- 不启动第二个 watcher，也不绕过 worktree 锁。
