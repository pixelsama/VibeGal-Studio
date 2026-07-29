# Claude Code 适配说明

使用 Claude Code 的原生目录监控能力监听 `../exchange/mailboxes/claude/pending/`。

检测到文件后：

1. 从当前角色 worktree 运行 `node ../exchange/runtime/codex/agent-mailbox.mjs claim --exchange ../exchange --agent claude`。
2. 以命令返回的 `processing/` 路径为准读取消息；不要直接处理仍在 `pending/` 的文件。
3. 根据消息类型读取对应的 `../exchange/roles/test-agent.md` 或 `../exchange/roles/development-agent.md`，并遵守 `../exchange/PROTOCOL.md`。
4. 终端动作与输出消息完成后，使用 `finish --state archive` 归档；基础设施或无效输入错误才使用 `failed`。

监控事件可能重复；每次都通过 `claim` 获取唯一任务，不自行移动或删除邮箱文件。
