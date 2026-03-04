# Review: web-skill-design.md

## TL;DR
这份总设计文档方向正确，但当前把“研究议题 + 生产系统 + 自进化系统”一次性打包，复杂度过高。建议先收敛为一个可证明价值的最小闭环：**单站点、只读、有限工具集、人工审查发布**。

## 主要问题

### P0: 范围过宽，MVP边界不够硬
- 文档同时承载 Phase 1~4、self-heal、knowledge flywheel、multi-site registry、marketplace 等。
- 风险：实现周期过长，任何一个子系统失败都会拖垮整体，无法快速证明“API-first 比 browser-only 更优”。

### P1: 执行模式设计与实现成本不对齐
- 6层执行模式（`direct_http` 到 `headed_browser_with_human`）是完整但重的模型。
- 对 MVP，推荐先收敛为 3 类 canonical case：
  - `direct_http`
  - `in_page_fetch`（统一承载当前 session/csrf/js 依赖）
  - `human_handoff`
- 其余模式作为内部优化，不必在第一版对外显式建模。

### P1: 跨文档决策状态不一致
- 本文第 12 节仍把“write endpoint probing 是否跳过”作为开放问题。
- 但 `security-taxonomy.md` 已明确“write endpoints skip probing”。
- 建议把“开放问题”和“已决策”分离，避免执行时出现双口径。

### P1: 缺少数据治理最小约束
- 设计中大量记录请求/响应、cookie、storage、截图。
- 但缺少默认脱敏策略、保留期限、审计规则。
- 这是落地阻断项，不应后置。

## KISS 化简建议
1. 先把“编译器”定义为单一职责：`traffic -> canonical endpoint tools`。
2. 将 workflow、self-heal、marketplace 全部降级为后续增量，不进入 MVP 关键路径。
3. 用单一成功指标驱动：
   - 同一任务集下，`tool-call count`、`latency`、`success rate` 对 browser-only 的提升。
4. 把“复杂站点”作为失败样本记录，不在 MVP 强行覆盖。

## 建议的最小发布门槛
- 仅支持 1 个垂直（travel 或 ecommerce 二选一）。
- 仅支持只读工具（search/detail/list）。
- 仅支持人工审批发布（不自动 publish patch）。
- 至少 20 个真实任务回放，成功率和耗时有量化对比。

## 结论
设计有前瞻性，但当前版本偏“全能架构”。按 first principles，先证明核心因果链：**自动抽取 API 是否稳定提升任务成功率与效率**。其余能力应后移。
