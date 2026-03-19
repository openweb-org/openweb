我们在实现doc/todo/roadmap.md。
已经完成了M21。你是一个coordinator，在high-level cue 流程，来完成后面的milestone实现。你是high-level orchestrator，只cue流程，不要让细节占据你太多context。如果项目开始走偏，可以提前结束。

当前状态：M21 done, 51 sites, 364 tests。M22 需要重做（之前的 coverage report 没有用 OpenTabs 真实列表）。

## 单个 Milestone 的完整流程

1. 用/multmux 启动一个新的claude (main worker)，copy-paste doc/todo/v2_mx/implement_prompt.md 作为claude prompt。
2. 实现完成后，提醒/write-doc if not already done。用/multmux call codex review code，写到 doc/todo/v2_mx/codex_review_{1|2|3|...}.md，然后让 main worker 来 fix。重复大概2-3轮，直到没有 critical 和 high severity issues。注意每次 commit code和 /write-doc。
3. 每次有代码变化，让 main worker 来 verify是否有/write-doc，并 commit。
4. 结束后，让 main worker 来调整 doc/todo/roadmap.md 剩余的 milestone 看有无必要调整。
5. For next milestone Mx，写一个新的 Mx 的 prompt 到 doc/todo/v2_mx/implement_prompt.md，参考 doc/todo/v2_m*/implement_prompt.md。
6. multmux kill last milestone's main worker。重复上面的流程，start step 1 with a new main worker。

## Milestone 序列

M22: Coverage Report — OpenTabs 105 plugins 分类 + archetype checklist + notes 基础设施
M23: 105 Sites 全量调通 — compile + auth + read ops verified，needs_login.md
M24: Human Handoff + Permission System — review gaps, KISS design, implement
M25: Full Coverage — 用户填 needs_login.md 后全量跑通 + write/transact ops
M26: Agent-Assisted Compile — annotation + classify 交给 agent
M27: WebSocket + AsyncAPI
M28: Remote Fixture Sync
M29: MCP Server
M30: Security Hardening + Permission Audit
