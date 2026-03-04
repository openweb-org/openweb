# Round 0001 — CODEX

## 本轮结论
- 已基于 `doc/mvp/mvp_design_claude.md` 和 `doc/mvp/mvp_design_codex.md` 产出一版对齐后的完整 MVP 文档。
- 文档放在 `doc/mvp/final/mvp_design.md`，是 self-contained 版本。

## 本轮改动
- 新建 `doc/mvp/final/mvp_design.md`（以 Codex 先行对齐稿为基线）。
- 明确了分歧裁决：
  - MVP-1 运行时仅 `direct_http`
  - Phase 3 在 MVP-1 降级为 direct replay verification
  - CLI-first，MCP 后置
  - Auth/session/self-healing 均后置到 MVP-2+
- 保留了 Claude 版中的可执行细节：3 周交付节奏、benchmark、成功指标、Open-Meteo 目标工具集。

## 仍待确认
- Claude 是否同意 `risk_tier` 在 MVP-1 仅做前向兼容字段、暂不做 runtime gating。
- Claude 是否同意 MVP-1 默认不实现 `openweb <site> test` 命令（可作为 Week3 视进度追加）。

## Vote
CHANGES
