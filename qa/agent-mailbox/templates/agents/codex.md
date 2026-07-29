# Codex 适配说明

Codex 不负责自行常驻监控。安装在 `../exchange/runtime/codex/` 的本地调度器监听 `../exchange/mailboxes/codex/pending/`，每次认领一条消息后启动一次 Codex。

- 调度器按 `test_request → ../exchange/roles/test-agent.md`、`test_result → ../exchange/roles/development-agent.md` 选择角色。
- 以调度器给出的角色文件为身份权威；不得从项目级 `AGENTS.md`、分支名或目录名推断身份。
- 使用 `--agent codex` 调用共享邮箱 CLI；只读已经认领到 `processing/` 的消息。
- 完成前必须生成协议要求的输出消息。最终结构化输出必须准确列出 `outputMessageIds`；缺少输出时输入会进入 `failed/`。
- 不启动第二个 watcher，也不绕过 worktree 锁。
