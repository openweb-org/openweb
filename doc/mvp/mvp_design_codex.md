# openweb MVP 设计（Codex 独立版）

## 1. 目标与判定

### 1.1 使命（Mission）
让任意 agent 更容易、更快、更便宜地访问 Web。

### 1.2 MVP 要证明什么
MVP 不是“覆盖所有网站”，而是证明一条最小可行路径：

1. 能把一个真实网站的核心读操作，稳定编译成结构化工具（而不是 click/type 流程）。
2. agent 能用低上下文开销的方式发现和调用这些工具。
3. 在相同任务上，API 化执行相比浏览器操作显著减少token数，步骤和延迟。

只要这 3 点成立，方向成立；其余复杂能力（鉴权、写操作、抗风控）后续增量。

---

## 2. 第一性原理推导

### 2.1 用户真正需要的不是“会点网页”
用户需要的是“完成任务结果”，不是“模拟人类点击过程”。

- 浏览器层（DOM/a11y/screenshot）信息量大，token 消耗高。
- 点击式动作脆弱，页面变动即失效。
- 多轮交互导致高延迟。

### 2.2 网站本质上是 API 客户端
现代站点大多把业务行为落在网络请求上。UI 是请求触发器，不是业务本体。

因此，最短路径是：
- 记录请求
- 抽象为参数化操作
- 让 agent 直接调用操作

### 2.3 MVP 的最小闭环
从第一性原理出发，MVP 只需 5 个能力：

1. 录制：拿到可分析的网络事实（HAR + UI 事件）。
2. 归纳：把事实压缩成稳定操作（endpoint clustering + schema）。
3. 验证：确认最便宜执行方式可用（优先 direct_http）。
4. 交付：用标准格式输出（OpenAPI + 少量扩展）。
5. 运行：提供最小 CLI 发现/执行接口。

其余能力都不是 MVP 必要条件。

---

## 3. KISS 设计原则（本版硬约束）

1. 不造新标准：用 OpenAPI 3.1 作为唯一规范源。
2. 不做多站泛化：先做 1 个简单站点跑通全链路。
3. 不做复杂鉴权：MVP 只做无鉴权读操作。
4. 不做主动自愈系统：只做被动失败提示。
5. 不做 MCP-first：CLI-first，MCP 后置为可选适配层。
6. 不做 workflow DSL：让 LLM 自行编排多工具序列。

---

## 4. MVP 范围

### 4.1 站点与任务
- 目标站点：Open-Meteo（公开、无鉴权、读操作为主）。
- 目标工具数：3-5 个 read-only 工具。
- 目标任务集：至少 20 个重放任务用于对比评估。

### 4.2 In Scope
- Phase 1: Playwright 录制 `traffic.har` + `ui_actions.jsonl`。
- Phase 1: 三层过滤（域名黑名单、content-type、路径噪声）。
- Phase 2: URL regex 归一化 + endpoint 聚类 + 参数区分。
- Phase 2: quicktype 结构推断；LLM 仅用于语义描述（可选）。
- Phase 3: GET 端点可重放验证（`direct_http` 优先）。
- Phase 4: 生成技能包（`manifest.json`、`openapi.yaml`、`tests/`）。
- Runtime: CLI 导航与执行（`sites`/`<site>`/`<site> <tool>`/`exec`）。
- Runtime: SSRF 防护（强制）。
- Runtime: 结构化错误契约。

### 4.3 Out of Scope
- 写操作（POST/PUT/PATCH/DELETE）自动探测与执行。
- 登录态管理、cookie 持久化、加密凭证仓。
- GraphQL / WebSocket / protobuf。
- 主动健康检查、自愈编排。
- 多站点批量编译与知识库自动演进。
- MCP server 默认发布。

---

## 5. 架构（最小可用）

```text
[Compiler]
  Phase1 录制 -> Phase2 提取 -> Phase3 验证 -> Phase4 产物生成
                                      |
                                      v
                           [Skill Package (per-site)]
                       manifest.json + openapi.yaml + tests/
                                      |
                                      v
                                [Runtime CLI]
                         导航(低token) + 执行(exec)
```

### 5.1 Compiler 与 Runtime 分离
- Compiler：一次性、可慢、可贵（允许 LLM 参与语义）。
- Runtime：每次调用、必须快（默认无 LLM）。

这是 MVP 的关键边界：把“复杂性”放在构建时，把“稳定性/速度”放在运行时。

---

## 6. 数据契约（MVP 版本）

### 6.1 录制产物

```text
recording/
├── traffic.har
├── ui_actions.jsonl
└── metadata.json
```

`ui_actions.jsonl` 最小字段：
- `timestamp`
- `action` (`click|type|navigate|submit`)
- `selector` (可空)
- `value` (可空)
- `url`

### 6.2 编译产物

```text
<site>/
├── manifest.json
├── openapi.yaml
└── tests/
```

`x-openweb`（operation 级）MVP 最小字段：
- `mode`: `direct_http | session_http | browser_fetch`
- `risk_tier`: `safe | low | medium | high | critical`
- `verified`: `boolean`
- `stable_id`
- `signature_id`
- `tool_version`

MVP-1 预期绝大多数 operation 为：
- `mode: direct_http`
- `risk_tier: safe`

### 6.3 测试文件
每个工具一个 `tests/<operation>.test.json`：
- 输入参数
- 期望 HTTP status
- `response_schema_valid: true`
- 可选结构断言（如数组非空）

只断言结构，不断言动态值。

### 6.4 错误契约（CLI）
失败时 stderr 输出 JSON：

```json
{
  "error": "execution_failed",
  "code": "INVALID_PARAMS",
  "message": "Parameter validation failed for operation search_forecast",
  "action": "Run `openweb open-meteo search_forecast` to inspect parameters.",
  "retriable": false
}
```

---

## 7. Pipeline 细化

### 7.1 Phase 1: Explore & Record

最小策略：
1. 预设 3-5 个可重复查询流（地点/日期/指标变化）。
2. 每个流执行 2-3 组参数变体（仅读）。
3. 同步录制 HAR 与 UI 动作日志。

停止条件：
- 连续 2 个流无新 endpoint；且
- 已达最小工具覆盖（3 个以上可读工具）。

### 7.2 Phase 2: Analyze & Extract

Step A: 聚类
- key: `method + normalized_path + content_type`
- 路径归一化用 regex（UUID/长数字/hex/base64/date）

Step B: 参数区分
- 变体差分识别 user input vs constant
- query/body/path 参数统一建模到 OpenAPI

Step C: Schema 推断
- quicktype 聚合多样本生成 JSON Schema
- LLM 只补充字段语义描述（可关闭）

Step D: 依赖（MVP 最小）
- 先做结构匹配版依赖图（可为空）
- 不引入工作流 DSL

### 7.3 Phase 3: Probe & Classify

MVP 规则：
- 只对 GET 端点探测。
- 首选 `direct_http` 重放。
- 通过则 `mode=direct_http, verified=true`。
- 不通过则记录信号并标注更高模式（不在 MVP-1 保证可执行）。

### 7.4 Phase 4: Generate & Test

- 生成 `openapi.yaml`（canonical）。
- 生成 `manifest.json`（元数据 + dependencies）。
- 生成每工具测试用例并执行一次 smoke test。

---

## 8. Runtime CLI（MVP 命令面）

### 8.1 导航命令
- `openweb sites`
- `openweb <site>`
- `openweb <site> <tool>`
- `openweb <site> <tool> --full`

### 8.2 执行命令
- `openweb <site> exec <tool> '<json>'`

执行路径（MVP-1）：
1. 参数校验（OpenAPI schema）
2. URL 构造
3. SSRF 校验
4. `fetch()` 执行
5. 响应 schema 校验
6. stdout 返回 JSON

---

## 9. 安全与治理（MVP 最小线）

### 9.1 SSRF（必须）
每次请求都做：
- 仅允许 `https`（开发白名单除外）
- DNS 解析后拒绝私网 IP
- 拒绝 metadata endpoint（如 `169.254.169.254`）
- 重定向目标重复校验

### 9.2 风险分级（规则化）
即使 MVP 仅读，也先写入 `risk_tier`，为后续写操作留接口。

### 9.3 数据最小化
- 不落盘敏感凭证。
- 编译完成后可清理原始录制（默认保留窗口可配置）。

---

## 10. 里程碑与验收

### 10.1 里程碑
1. M1: 可生成 1 个站点的 `openapi.yaml`（3+ 工具）。
2. M2: CLI 可发现并执行工具，返回结构化 JSON。
3. M3: 20 任务对比评估完成并出报告。

### 10.2 验收指标（MVP-1）
- 任务成功率：>= 85%
- 步骤减少：>= 60%（对比浏览器点击流）
- 平均延迟降低：>= 40%
- 工具可用率：>= 90%（测试样本内）
- 未授权写操作：0

---

## 11. 风险与缓解

1. 录制噪声过大 -> 三层过滤 + 2xx 约束。
2. 聚类误合并 -> 参数变体覆盖 + signature_id 追踪。
3. schema 漏字段 -> quicktype 多样本聚合 + 回放测试。
4. 运行期漂移 -> 被动失败计数 + `heal` 提示（不做主动巡检）。

---

## 12. 关键决策总结（为什么这是最小正确解）

1. 先做 Open-Meteo，是为了验证方法论，不是追求复杂度。
2. 用 OpenAPI + CLI progressive disclosure，同时满足标准化与低 token。
3. MVP 只做 read-only + direct_http，最大化“可交付速度/稳定性比”。
4. 先把数据契约钉死（录制、OpenAPI 扩展、测试、错误），避免后续返工。
5. 把复杂问题（auth、write、GraphQL、自愈）明确后置，保持主线收敛。

