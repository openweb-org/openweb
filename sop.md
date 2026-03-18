我们在实现doc/todo/roadmap.md。
已经完成了M20。会继续M21 and remaining (M21-M27)。你是一个coordinator，在high-level cue 流程，来完成后面的milestone实现。你是high-level orchestrator，只cue流程，不要让细节占据你太多context。如果项目开始走偏，可以提前结束。

当前状态：M20 done, 51 sites, 359 tests, 7 commits。M21 implement prompt ready at doc/todo/v2_m21/implement_prompt.md。

## 单个 Milestone 的完整流程（以 M21 为例）

1. 用/multmux 启动一个新的claude (main worker)，copy-paste doc/todo/v2_m21/implement_prompt.md 作为claude prompt。
2. 实现完成后，提醒/write-doc if not already done。用/multmux call codex review code，写到 doc/todo/v2_m21/codex_review_{1|2|3|...}.md，然后让 main worker 来 fix。重复大概2-3轮，直到没有 critical 和 high severity issues。注意每次 commit code和 /write-doc。
3. 每次有代码变化，让 main worker 来 verify是否有/write-doc，并 commit。
4. 结束后，让 main worker 来调整 doc/todo/roadmap.md 剩余的 milestone 看有无必要调整。
5. For next milestone Mx，写一个新的 Mx 的 prompt 到 doc/todo/v2_mx/implement_prompt.md，参考 doc/todo/v2_m*/implement_prompt.md。
6. multmux kill last milestone's main worker。重复上面的流程，start step 1 with a new main worker。

## Milestone 序列

M21: Distribution Prep — npm-ready packaging + ~/.openweb/sites/ + CLI simplification
M22: Coverage 压测 — OpenTabs 106 sites + archetype checklist + per-site notes
M23: Agent-Assisted Compile — annotation + classify 交给 agent
M24: WebSocket + AsyncAPI — 最后的 5%
M25: Remote Fixture Sync — 自动从远程下载 fixture
M26: MCP Server — 任何 MCP agent 可调用
M27: Security Hardening + Permission Audit
