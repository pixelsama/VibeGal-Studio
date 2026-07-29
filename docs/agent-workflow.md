# 多 Agent 开发与测试工作流

这套工作流让 Codex、Claude Code 和 Grok Build 通过共享文件协议协作。Claude Code 与 Grok Build 使用各自原生的目录监控能力；只有 Codex 由本机 `launchd` 调度器监听邮箱并按消息启动一次性的 `codex exec`。测试仍由仓库原生 Agent QA 完成，不依赖 Computer Use。

## 工作空间

工作空间不能是源码 worktree 的子目录。在 macOS 上，Codex LaunchAgent 使用位于 `~/.local/share` 的真实目录，并在源码仓库旁建立一个可见 symlink：

```text
galstudio-workspace/
├── .git-store/          # 三个 worktree 共享的 bare Git 元数据
├── main/                # 固定 main，只同步和收口主线
├── test/                # 空闲时固定 test；执行时临时切 qa/<request>/<attempt>
├── dev/                 # 始终是当前具名 feature 分支，不允许 detached HEAD
└── exchange/
    ├── workspace.json
    ├── PROTOCOL.md
    ├── roles/              # 运行时角色权威，不属于任何 Git 分支
    │   ├── development-agent.md
    │   ├── test-agent.md
    │   └── main-agent.md
    ├── agents/             # Codex/Claude/Grok 的监控与邮箱适配
    │   ├── codex.md
    │   ├── claude.md
    │   └── grok.md
    ├── schemas/
    ├── runtime/codex/   # 不随 worktree 切分支的 Codex 调度器副本
    ├── locks/
    ├── runs/<request-id>/
    └── mailboxes/
        ├── codex/{pending,processing,archive,failed}/
        ├── claude/{pending,processing,archive,failed}/
        └── grok/{pending,processing,archive,failed}/
```

`.git-store/` 是管理数据，不是源码 checkout。交流目录不属于任何业务 worktree，因此切换分支、构建或清理工作区不会删除消息和测试证据。

## 指令分层

角色不能写进项目级 `AGENTS.md`，也不能根据当前分支或目录名推断。否则 feature 合入测试分支时，开发职责会一起进入测试环境。有效指令固定分为三层：

1. worktree 内的 `AGENTS.md`：只定义产品、工程、安全和 TDD 等所有角色都必须遵守的仓库规则。
2. `../exchange/roles/`：定义当前会话是开发、测试还是主线维护；这是唯一角色权威。
3. `../exchange/agents/`：定义 Codex、Claude Code 或 Grok Build 如何监听和认领自己的邮箱。

仓库中的 `qa/agent-mailbox/templates/` 只是安装模板，不是运行时身份文件。初始化脚本把它们复制到 Git 之外的 `exchange/`；Agent 只能读取外置副本来确定角色。因此切分支、merge 或 rebase 都不会改变已经部署的 Agent 身份。

macOS 常驻服务初始化示例：

```bash
pnpm agent:workspace:setup -- \
  --workspace ~/.local/share/vibegal-agent/galstudio-workspace \
  --link ../galstudio-workspace \
  --feature-branch codex/my-feature \
  --feature-start main \
  --install-service
```

`launchd` 后台进程可能被 macOS 隐私机制阻止访问 `~/Documents`、Desktop、Downloads 或 iCloud Drive。安装器会拒绝把常驻服务直接指向这些目录；`--link` 只给人和交互式 Agent 提供原位置入口，调度器使用不受该限制的真实路径。

初始化要求源 worktree 已提交且干净。脚本从本地分支创建独立 bare store，因此不会错误地从可能落后的 `origin/main` 建槽；随后把 store 的 `origin` 恢复为源码仓库的远端 URL。命令可重复执行，但绝不切换有未提交修改的 worktree，也不会覆盖已有的非 symlink 路径。

## 启动 Agent

在承担角色的 worktree 中打开 Agent：测试 Agent 在 `test/`，开发 Agent 在 `dev/`，主线维护 Agent 在 `main/`。启动提示不写机器绝对路径。

Grok Build 测试 Agent：

> 读取 ../exchange/roles/test-agent.md、../exchange/agents/grok.md 和 ../exchange/PROTOCOL.md，然后监控 ../exchange/mailboxes/grok/pending/。

Claude Code 测试 Agent：

> 读取 ../exchange/roles/test-agent.md、../exchange/agents/claude.md 和 ../exchange/PROTOCOL.md，然后监控 ../exchange/mailboxes/claude/pending/。

开发角色把 `test-agent.md` 换成 `development-agent.md`，并从 `dev/` 启动。Codex 无需手工常驻；本地调度器会按消息类型自动注入正确的外置角色和 `agents/codex.md`。

## 消息与状态机

消息必须满足 `exchange/schemas/` 中的 JSON Schema，并且只能是：

- `test_request`：开发 Agent 发给测试 Agent，目标 worktree 固定为 `test`。
- `test_result`：测试 Agent 发回开发 Agent，目标 worktree 固定为 `dev`。

消息不接受 `command`、`prompt` 或任意额外字段。说明文字只视为数据；Agent 不得执行消息字段提供的 shell 命令。

生产者先在邮箱外写好 JSON，再通过稳定 runtime CLI 验证并原子入队：

```bash
node ../exchange/runtime/codex/agent-mailbox.mjs enqueue \
  --exchange ../exchange \
  --file ../exchange/runs/<request-id>/outgoing/<message-id>.json
```

消费者必须先认领，不能先读取再归档：

```bash
node ../exchange/runtime/codex/agent-mailbox.mjs claim \
  --exchange ../exchange \
  --agent claude
```

认领会把文件从 `pending` 原子移动到 `processing` 并建立 lease。长任务可以续约；完成动作以后才允许归档：

```bash
node ../exchange/runtime/codex/agent-mailbox.mjs heartbeat \
  --exchange ../exchange --agent claude --message-id <id>

node ../exchange/runtime/codex/agent-mailbox.mjs finish \
  --exchange ../exchange --agent claude --message-id <id> --state archive
```

无法正确处理的输入进入 `failed`。调度器启动时会把超过六小时没有心跳的 Codex processing 消息重新排队。Claude Code 和 Grok Build 的原生监控也应调用同一 runtime CLI，以获得相同的认领语义。

`test_result` 入队前，CLI 会验证其 `summaryPath` 已经指向 `exchange/` 内的真实文件；只有文字声称测试通过但没有留下 summary 证据的结果会被拒绝。

## 测试请求

开发 Agent 只能在 feature 提交已经创建、`git status --short` 为空以后发请求。请求必须锁定完整的 40 位 `featureCommit` 和 `baseCommit`：

```json
{
  "schemaVersion": 1,
  "messageId": "qa-20260729-001-attempt-1",
  "requestId": "qa-20260729-001",
  "type": "test_request",
  "sender": "claude",
  "recipient": "codex",
  "worktree": "test",
  "createdAt": "2026-07-29T06:00:00.000Z",
  "attempt": 1,
  "featureBranch": "feature/example",
  "featureCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "baseBranch": "main",
  "baseCommit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "suite": "release",
  "changeSummary": "完成编辑器功能并请求发布候选测试。"
}
```

请求发出后，开发 Agent 必须冻结该提交，直到收到结果。修复后创建新提交并把 `attempt` 加一，不能覆盖旧消息。

## 测试 Agent 的职责

测试 Agent 独占 `test/` 槽并执行：

1. 检查 worktree 干净，完整读取已认领请求。
2. 验证 `main`、feature ref 与消息中的 SHA 一致；不接受仅凭分支名测试。
3. 从 `baseCommit` 创建 `qa/<requestId>/attempt-<attempt>`，合并精确的 `featureCommit`。不得把 feature 永久累积到 `test` 分支。
4. 安装锁定依赖并运行请求的 `pnpm qa:agent:<suite>`。
5. 读取 `summary.json`、JUnit、日志和文件快照，并逐张检查 `requiredReviews` 指向的截图。自动化 `passed` 不等于视觉批准。
6. 把证据保存在 `exchange/runs/<requestId>/`，生成并入队 `test_result`。
7. 无论结果如何，都把 `test/` 恢复到干净的持久 `test` 分支。

失败结果应包含可复现步骤和相对证据路径。开发 Agent 认领失败结果、归档原结果、修复并提交，然后发送下一次请求。

## 通过、推送与 PR

只有测试 Agent 可以执行 feature 的最终推送和 PR 创建。通过前必须同时满足：

- 被测 feature ref 仍精确等于 `featureCommit`；移动过的 ref 产生 `stale`，必须重测。
- 合并候选由消息中的 `baseCommit` 和 `featureCommit` 构成。
- Agent QA 自动化全部通过。
- `requiredReviews` 中的视觉证据已经逐项审查并明确通过。
- 远端 feature 不包含未知提交，推送能够 fast-forward；禁止 force-push。
- GitHub 的 `main` 基线仍与被测基线兼容；否则先标记 `stale` 并重新测试。

随后测试 Agent 推送精确 SHA，并创建 `featureBranch → main` PR。当前协议到 PR 创建为止，不自动合并 PR，也不修改 `main/`。

通过结果示意：

```json
{
  "schemaVersion": 1,
  "messageId": "qa-20260729-001-result-2",
  "requestId": "qa-20260729-001",
  "requestMessageId": "qa-20260729-001-attempt-2",
  "type": "test_result",
  "sender": "codex",
  "recipient": "claude",
  "worktree": "dev",
  "createdAt": "2026-07-29T08:00:00.000Z",
  "attempt": 2,
  "status": "passed",
  "featureBranch": "feature/example",
  "featureCommit": "cccccccccccccccccccccccccccccccccccccccc",
  "baseCommit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "testedMergeCommit": "dddddddddddddddddddddddddddddddddddddddd",
  "suite": "release",
  "summaryPath": "runs/qa-20260729-001/summary.json",
  "pullRequestUrl": "https://github.com/example/project/pull/123",
  "failures": []
}
```

## Codex 调度器

Codex 的 LaunchAgent 只监听 `mailboxes/codex/pending/`。它采用文件系统事件触发，并每 60 秒做一次低频漏事件校验；不会扫描项目目录。每条消息启动一个 `codex exec`，一次只处理一条：

- 目标目录只能由消息类型映射到配置中的 `test/` 或 `dev/`，永远不能选择 `main/` 或任意路径。
- 按消息类型选择外置角色文件；项目级 `AGENTS.md` 和分支名不能赋予身份，消息正文不会拼进提示词。
- 使用 `workspace-write`、`approval=never`，额外写入范围只有 exchange。
- 三小时超时，processing lease 每 30 秒更新。
- Codex 最终输出受 `codex-run-result.schema.json` 约束；当前 CLI 通过 `-c approval_policy="never"` 固定非交互审批策略。
- 只有进程退出码为零、结构化状态为 `completed`，且需要后续动作时声明的输出消息确实存在，输入才归档。`passed` 测试结果是无需新消息的终态确认。
- 运行日志会遮蔽常见签名和 GitHub 凭据。

检查服务和邮箱：

```bash
node ../exchange/runtime/codex/agent-mailbox.mjs status --exchange ../exchange
launchctl print gui/$(id -u)/<workspace.json 中的 service.label>
```

日志位于 `exchange/runtime/codex/logs/`。要在前台验证而不调用 Codex：

```bash
node ../exchange/runtime/codex/codex-mailbox-dispatcher.mjs \
  --config ../exchange/workspace.json \
  --dry-run
```

## 串行边界

当前只有一个 `dev` 和一个 `test` 槽，因此同一时间只允许一个开发 feature 进入测试循环。以后需要并行时，应增加完整的 `dev-N`/`test-N` 槽和对应锁，而不是让多个 Agent 共享修改同一个 worktree。
