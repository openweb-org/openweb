# Review: architecture-pipeline.md

## TL;DR
流水线定义完整，但 Phase 1/1.5/4 的实现复杂度和耦合度偏高。建议把 pipeline 收敛为“最少阶段 + 最少状态 + 可回放证据”。

## 主要问题

### P0: 录制面过宽，导致隐私风险和实现负担
- Phase 1 默认采集事件、请求体、响应体、cookie/storage、WS、截图、a11y。
- 这在工程上和合规上都很重。
- 建议最小默认集：`request/response + event causality`，截图/a11y仅在调试失败时按需开启。

### P1: Step 0 任务规划引入过早语义推断
- 先做“站点分类 + intent library + 多参数变体”，在冷启动时不稳定。
- 可简化为：先收集少量真实主路径，再从录制结果反推高价值 flow。

### P1: 依赖图推断缺少置信度机制
- 当前用字段传递关系自动推断 `A.response.X -> B.request.Y`。
- 容易把重复 ID、时间戳、噪声字段误判为依赖。
- 建议输出依赖置信度，并要求低置信度链路人工确认。

### P1: 失败回退链太长，状态机复杂
- 运行态有 6 级 escalation + 自愈触发。
- 维护成本高，排障复杂。
- 建议 canonical 链：`direct_http -> in_page_fetch -> human_handoff`。

### P1: 自愈自动发布风险高
- 当前定义“测试通过即 publish”。
- 对写操作/支付类工具过于激进。
- 建议最少规则：写操作变更必须人工审批。

## KISS 化简建议
1. Phase 1: 只做可因果回放的最小录制。
2. Phase 1.5: 只做最小探针（auth/csrf/browser_needed/human_needed）。
3. Phase 2: 先支持 JSON REST，GraphQL/WS 延后。
4. Phase 4: 只允许“自动检测 + 人工批准修复”。

## 推荐的 canonical case 设计
- 把绝大多数“有 session/有 token/有 JS 依赖”的情况统一归为 `in_page_fetch`，避免为每种边缘机制单独建模式。
- 把不可自动完成的全部统一归为 `human_handoff`，而不是分散到多条特殊分支。

## 结论
该文档技术路线可行，但目前更像“终态蓝图”。若按 KISS 落地，应先压平状态机、减少采集面、缩短回退链。
