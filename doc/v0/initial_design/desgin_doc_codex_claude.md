# Web Use Skill Compiler — Design Document

> **Status**: Draft v2
> **Author**: Moonkey
> **Last Updated**: 2026-02-26

---

## 0. 一句话

**把网站从"要模拟人点的 GUI"编译成"可直接调用的 API 工具集"，让 Browser Agent 像调 SDK 一样操作任意网页。**

---

## 1. 问题：为什么当前 Browser Agent 的范式是错的

### 1.1 根源问题

当前 Browser Agent 操作网页的方式——不管是 DOM、Accessibility Tree、还是 Screenshot——**本质上是在读一个渲染产物（rendering artifact），而不是在读语义接口（semantic interface）**。

这就像让一个人通过看工厂的监控摄像头来操作机器——他能做到，但远不如直接按控制面板的按钮。

具体而言：

| 维度 | GUI 操作（当前范式） | API/Tool 调用（目标范式） |
|------|-------------------|----------------------|
| 观察空间 | 整个 DOM/a11y tree/截图（数千 token） | 结构化 JSON（数十 token） |
| 动作空间 | click(x,y), type(text), scroll, drag | `search_flights(origin, dest, date)` |
| 状态推理 | 需要从 UI 反推隐藏状态 | 直接从 response 读 |
| 错误定位 | "点了没反应"——不知道是元素变了、还是请求失败了 | HTTP 状态码 + response body |
| 步骤数 | 多（click → wait → scroll → click → ...） | 少（一次调用 = 一个完整语义动作） |
| 稳定性 | 低（DOM 结构、CSS selector 随时变） | 中高（API endpoint 相对稳定） |

### 1.2 关键洞察

每个网页的背后，都是一组 HTTP API 调用。用户在 UI 上的每一次点击、填写、提交，最终都转化为 GET/POST/PUT 请求。**这些 API 才是网站的真实语义接口——UI 只是它的一个"皮肤"。**

既然如此，为什么不跳过皮肤，直接调用接口？

### 1.3 已有验证

学术上已有系统性验证（[WebArena API-Based Agent, arXiv:2410.16464](https://arxiv.org/abs/2410.16464)）：
- 有可用 API 时，API-based agent 比纯 DOM/a11y 浏览 agent **更强、步骤更少**
- Hybrid agent（API + 浏览混合）**最稳定**
- 但该研究中的 API 全部来自人工查找的官方文档——**没有自动生成的部分**

**这正是我们要填补的空白：自动从任意网站挖掘出这些 API，并编译成可调用的工具。**

---

## 2. 愿景：Website → Tool Space 编译器

### 2.1 核心比喻

把 `web-use-skill` 想象成一个 **编译器**：

```
源代码（Source）    = 网站的 Network Traffic + UI 行为录制
编译器（Compiler）  = web-use-skill（本项目）
目标代码（Target）  = per-website skill（结构化工具集）
运行时（Runtime）   = 浏览器 session 内的执行引擎
```

编译器的输入是"人（或 agent）在网站上操作一遍"，输出是"一套可复用的 API 工具包"。

### 2.2 形式化定义

将网站建模为一个 **带隐藏状态的环境**（Partially Observable Environment）：

- **观察** `o_t`：DOM/a11y/screenshot + network responses
- **原子动作** `a_t`：click/type/scroll + in-page fetch/XHR
- **隐状态** `s_t`：cookie/session/localStorage、CSRF token、购物车/checkout state、AB 实验 bucket 等

我们要把低层原子动作 **组合成宏动作（Options）**，每个宏动作就是一个 Tool：

```
option ω = (I_ω, π_ω, β_ω)

I_ω : 允许开始的状态集合（例如"已登录且在 search 页"）
π_ω : 执行策略（优先走 API；必要时走 UI）
β_ω : 终止条件/成功判定（例如拿到 orderId / confirmation）
```

最终每个网站输出：**一套 tools（schema 化的宏动作）+ workflows（tools 的编排 DAG/状态机）**。

### 2.3 目标与非目标

**目标：**
1. 将网页任务尽可能转为 API-like structured IO 调用
2. 最小化"像人类一样点网页"的低层动作比例
3. 自动生成可运维、可回归测试、可版本化的 per-website skill
4. 同时支持读操作与写操作（写操作支持人机协同节点）

**非目标：**
1. ~~任意网站 100% 零成本自动化~~ → 大部分网页"半自动 + 可自愈 + 必要回退"
2. ~~绕过风控、验证码、2FA、签名校验~~ → 遇到就 pause + human-in-the-loop
3. ~~未授权场景执行高风险写操作~~ → 策略门控 + 用户明确确认

---

## 3. 与 WebMCP 的关系：过渡路径

### 3.1 WebMCP 是什么

Google 的 [WebMCP](https://anthropic.com) 提案：网站通过 `navigator.modelContext` 主动注册结构化 tools（自然语言描述 + input schema + 执行回调），让 agent 不用猜 DOM、直接调用。

**关键限制：需要网站开发者主动实现。** 短期内，绝大多数网站不会配合。

### 3.2 我们的定位：客户端侧的 WebMCP 生成器

```
┌──────────────────────────────────────────────┐
│                                              │
│  网站未实现 WebMCP:                           │
│    → 我们通过 traffic mining 自动生成 tools    │
│    → 注入脚本在页面里注册（补齐 registerTool） │
│                                              │
│  网站已实现 WebMCP:                           │
│    → 直接使用其提供的结构化工具（最稳）         │
│                                              │
└──────────────────────────────────────────────┘
```

**过渡策略：短期靠挖掘覆盖长尾；中长期靠标准/合作提升可靠性。**

这不是与 WebMCP 竞争——这是为 WebMCP 尚未覆盖的世界提供桥梁。当 WebMCP 普及时，我们的系统可以无缝切换到使用官方工具。

---

## 4. 系统架构

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    web-use-skill (Meta Skill)                │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Recorder │→│ API Miner│→│Synthesizer│→│  Runtime   │  │
│  │          │  │          │  │           │  │           │  │
│  │ CDP/PW   │  │ Cluster  │  │ Tool Gen  │  │ API-first │  │
│  │ HAR+     │  │ Diff     │  │ Workflow  │  │ UI-fall   │  │
│  │ Causal   │  │ Schema   │  │ Test Gen  │  │ Self-heal │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────┘  │
│                                                             │
│  ┌─────────────────────────┐  ┌──────────────────────────┐  │
│  │ PM Brain (Intent Model) │  │ Governance (合规/安全)     │  │
│  └─────────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                ┌──────────────────────────┐
                │  per-website skill 产物   │
                │  (amazon / google-flight  │
                │   / booking / ...)        │
                └──────────────────────────┘
```

### 4.2 模块详解

#### A. Recorder（采集层）

目标不仅仅是 HAR，而是更接近 **"因果链（causal chain）"** 的数据：

| 数据 | 来源 | 用途 |
|------|------|------|
| 用户事件时间线 | CDP `Input.dispatch*` / Playwright event hooks | 建立"用户意图 → 请求"映射 |
| 请求序列 | CDP `Network.*` / HAR | API 候选 |
| 响应体 | 同上（重点 JSON） | Schema 归纳 |
| Initiator/调用栈 | CDP `Network.requestWillBeSent.initiator` | 区分"UI 触发"vs"后台轮询"vs"预取" |
| 页面状态快照 | URL + 关键 DOM 片段 + cookie/storage 摘要 | 关联前置状态 |

**关键实现细节：**
- 使用 CDP（Chrome DevTools Protocol）或 Playwright 的 `route` + `page.on('request')` 实现
- 每个请求标记其 `initiator` 类型：`user_action` / `script_auto` / `prefetch`
- 录制成本极低：一次人工演示（或 agent 演示）即可

#### B. API Miner（挖掘层）

对录制的 traffic 进行结构化抽取：

**Step 1: 聚类（Clustering）**
```
聚类键 = (HTTP method, URL pathname, content-type, GraphQL operationName)
```
同一聚类内的多次请求视为"同一 API 的不同调用"。

**Step 2: 差分（Diffing）**
在同一簇内比较多次请求，分类每个字段：

| 字段类型 | 定义 | 示例 |
|---------|------|------|
| 常量 | 所有请求中值不变 | `api_version: "v2"` |
| 用户输入 | 值来自 UI 表单/搜索框 | `query: "NYC to LAX"` |
| 会话派生 | 值由 session 状态决定 | CSRF token, timestamp, nonce |
| 分页/游标 | 翻页参数 | `cursor`, `page`, `offset` |

**Step 3: 模板化（Templating）**
```
request = f(user_inputs, session_state, derived_tokens)
```
其中 `derived_tokens` 是自愈的重点——很多网站的写操作会带动态 token/签名。

**Step 4: Schema 归纳（Schema Induction）**
- 结构推断：类型、必填、范围、枚举
- 语义标注：字段名 + 值分布 + UI label + 上下文，让 LLM 给出更可读的参数名/说明

#### C. PM Brain（需求推导层）

**不是靠 LLM "想象"需求，而是从录制数据中推导：**

1. **从录制中抽"漏斗/流程"**：
   - 按页面跳转 + endpoint 调用序列聚类
   - 得到 top flows（例：`search → detail → add_cart → checkout`）

2. **把每个 flow 映射到"领域意图库"**：
   - 电商通用：search/filter, compare, apply coupon, estimate shipping/tax, checkout
   - 航旅通用：search flights, filter by time/stop, fare rules, baggage, booking
   - 通用信息型：search, detail, export, share

3. **站点特化（site-specific customization）**：
   - 用 UI 文案 + response 字段语义标注
   - 例：coupon code 字段在 amazon 叫 `promotionId`，在 booking.com 叫 `discountCode`

这样 PM 总结是**可解释的、可回放的、可更新的**——不是凭空生成。

#### D. Skill Synthesizer（生成层）

输出 per-website skill 包（详见第 6 节）。

为每个 endpoint 簇生成 tool，为每个 flow 生成 workflow，为每个关键字段生成 extractor。

**Tool 命名约定：**
```
{domain}_{verb}_{object}

例：
  flight_search_roundtrip(origin, dest, depart_date, return_date) → results[]
  flight_select_option(option_id) → booking_state
  flight_confirm_precheck(traveler_info) → confirmation_preview

  shop_search_products(query, filters) → products[]
  shop_add_to_cart(product_id, quantity) → cart_state
  shop_apply_coupon(coupon_code) → discount_result
```

#### E. Skill Runtime（执行层）

```
┌──────────────────────────────────────┐
│            Task Intent               │
│  "帮我找 3/15 NYC-LAX 最便宜的直飞"  │
└──────────────┬───────────────────────┘
               │
               ▼
      ┌────────────────┐
      │ Workflow Planner│ ← 选择合适的 workflow DAG
      └────────┬───────┘
               │
      ┌────────▼──────────────────────────┐
      │       Execution Loop              │
      │                                   │
      │  ┌─── API Call ◄── 优先 ──┐       │
      │  │                       │       │
      │  │ 成功? ─── Yes ───► 下一步    │
      │  │  │                            │
      │  │  No                           │
      │  │  │                            │
      │  │  ▼                            │
      │  │ UI Fallback ◄── 尝试 ──┐     │
      │  │  │                     │     │
      │  │  │ 成功? ── No ──► Self-Heal │
      │  │  │  │                        │
      │  │  │  Yes                      │
      │  │  │  │                        │
      │  │  └──▼── 下一步 ──────────────┘ │
      └───────────────────────────────────┘
```

**关键设计决策：在同一浏览器 session 内执行**
- 保持 cookie/session 连续性
- 避免 CORS 问题
- 不把请求搬到外部服务端"裸打"
- Agent 是在"调用网页后端 API"，但借用了浏览器的同源安全上下文

#### F. Self-Healing（自愈层）

把"网站当作依赖服务"来做 **contract testing + schema evolution**：

```
失败检测
  │
  ▼
最小回退：用浏览器 UI 完成同一目标一次
  │
  ▼
重新录制 traffic，和旧版做 diff：
  ├─ endpoint 是否变了？
  ├─ 字段是否改名/嵌套改变？
  └─ 多了哪些必填参数？
  │
  ▼
自动更新 schema + 模板 + extractor
  │
  ▼
跑回归测试，通过才发布新版本
```

#### G. Governance（治理层）

| 策略 | 实现 |
|------|------|
| 站点准入 | allowlist / denylist / risk tier |
| 写操作门控 | 高风险动作需用户明确确认 |
| 敏感数据 | 不保存明文支付信息/验证码/OTP |
| 日志脱敏 | token/cookie/PII 自动遮蔽 |
| 条款合规 | 站点 ToS 冲突时禁止自动化并给出原因 |

---

## 5. 五类硬问题与应对策略

这些不是"工程不够"，而是网页天然不是为机器 API 暴露设计的：

### 5.1 鉴权与风控：强 stateful

**问题**：cookie、CSRF、device fingerprint、step-up verification（短信/邮箱/2FA）、支付确认等，很多不是简单重放请求能过。

**应对**：
- 在同一浏览器 session 内执行（继承全部 auth state）
- 对需要 step-up 的节点标记 `requires_human_step`
- 针对 CSRF token 编写 extractor 自动从 cookie/meta/bootstrap response 提取

### 5.2 动态参数是签名/加密，不是简单 token

**问题**：部分站点对 payload 做 HMAC/加密，密钥在运行时生成或绑定设备。"抓到一次请求"不等于"能泛化调用"。

**应对**：
- 优先通过 JS 执行环境直接调用站点的签名函数（在同一页面上下文内）
- 无法调用时，标记该 endpoint 为 `ui_only`，回退浏览器操作
- 实际中，大多数读操作不涉及签名；签名主要出现在写操作

### 5.3 一个 UI 动作 = 多请求、多阶段状态机

**问题**：例如下单：`create session → apply coupon → lock inventory → create payment intent → confirm`。需要抽象出"工作流"，而不是单 endpoint。

**应对**：
- Recorder 记录完整的请求链 + 因果关系
- Synthesizer 自动检测"必须按顺序调用"的 endpoint 序列
- 生成 workflow DAG，而非扁平 tool 列表

### 5.4 GraphQL / WebSocket / SSE

**问题**：GraphQL 通常是一个 endpoint + 不同 operation，参数化更复杂；实时更新走 WebSocket。

**应对**：
- GraphQL 按 `operationName` 聚类（而非 URL）
- 解析 query/mutation 的 variables schema
- WebSocket 消息作为"异步结果"纳入 workflow 的等待节点

### 5.5 合规/条款风险

**问题**：很多网站明确禁止 reverse engineering/自动化。

**应对**：
- 产品定位在"用户自己浏览器本地自动化"（用户授权、用户 session 内执行）
- 优先使用官方 API / WebMCP（当可用时）
- 站点 ToS 分析作为 Governance 层的输入
- 企业场景需要合作/授权，不做未授权的规模化调用

---

## 6. Per-Website Skill 产物规范

### 6.1 目录结构

```
amazon-web-skill/
├── SKILL.md              # 能力声明、风险策略、版本状态
├── tools/
│   ├── search_products.json
│   ├── get_product_detail.json
│   ├── add_to_cart.json
│   ├── apply_coupon.json
│   └── checkout_precheck.json
├── workflows/
│   ├── search_and_compare.yaml
│   ├── purchase_with_coupon.yaml
│   └── price_tracking.yaml
├── extractors/
│   ├── csrf_token.js
│   ├── session_id.js
│   └── cart_state.js
├── verifiers/
│   ├── search_results_valid.js
│   ├── cart_updated.js
│   └── price_consistent.js
├── tests/
│   ├── search_smoke.replay
│   ├── add_to_cart.replay
│   └── coupon_apply.replay
├── fingerprints/
│   ├── endpoint_shapes.json
│   ├── bundle_hashes.json
│   └── last_validated.json
└── CHANGELOG.md
```

### 6.2 Tool 定义示例

```json
{
  "name": "shop_search_products",
  "description": "在 Amazon 上搜索商品，支持关键词和类目筛选",
  "domain": "amazon.com",
  "input_schema": {
    "type": "object",
    "required": ["query"],
    "properties": {
      "query": { "type": "string", "description": "搜索关键词" },
      "category": { "type": "string", "enum": ["all", "electronics", "books", "..."] },
      "sort_by": { "type": "string", "enum": ["relevance", "price_low", "price_high", "rating"] },
      "page": { "type": "integer", "default": 1 }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "products": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "asin": { "type": "string" },
            "title": { "type": "string" },
            "price": { "type": "number" },
            "rating": { "type": "number" },
            "image_url": { "type": "string" }
          }
        }
      },
      "total_results": { "type": "integer" },
      "has_next_page": { "type": "boolean" }
    }
  },
  "execution": {
    "strategy": "api_first",
    "endpoint_template": "GET /s?k={query}&i={category}&s={sort_by}&page={page}",
    "derived_tokens": ["session-id", "ubid-main"],
    "fallback": "ui_search"
  },
  "verification": {
    "success": "response.products.length > 0",
    "schema_match": true
  }
}
```

### 6.3 Workflow 定义示例

```yaml
workflow_id: purchase_with_coupon
description: "搜索商品 → 比价 → 使用优惠券 → 加购 → 预检查"
entry_conditions:
  - user_logged_in: true
  - site: amazon.com

states:
  search:
    tool: shop_search_products
    next: compare

  compare:
    tool: shop_get_product_detail
    loop: "for top 3 results"
    next: apply_coupon

  apply_coupon:
    tool: shop_apply_coupon
    optional: true
    human_hint: "如果有可用的 coupon code，agent 会自动尝试"
    next: add_to_cart

  add_to_cart:
    tool: shop_add_to_cart
    next: precheck

  precheck:
    tool: shop_checkout_precheck
    human_required: true
    human_prompt: "以下是订单摘要，请确认是否继续支付"
    terminal: true

exit_conditions:
  success: "precheck.status == 'ready'"
  abort: "any step returns requires_human_step and user declines"
```

### 6.4 SKILL.md 声明规范

```markdown
# Amazon Web Skill

## 能力边界
- 支持：商品搜索、详情查看、比价、加购、优惠券应用、结账预检
- 不支持：支付确认（需 human confirmation）、退货、账号设置修改

## 执行策略
- API-first：搜索、详情、库存查询
- UI-fallback：加购异常时回退到浏览器点击
- Human-required：支付确认、验证码、2FA

## 风险评级
- 读操作：低风险（自动执行）
- 写操作-可逆：中风险（加购/优惠券，自动+通知）
- 写操作-不可逆：高风险（支付确认，强制人机确认）

## 版本
- skill_version: 1.2.0
- last_validated: 2026-02-25
- site_fingerprint_match: true
```

---

## 7. 产品形态：不是单一 Skill，而是 Skill + MCP Runtime + 生成器

### 7.1 按 Claude Code 机制的三层架构

| 层 | 职责 | 形态 |
|----|------|------|
| **Skill（SKILL.md）** | "如何分析网站、如何产出技能包、如何测试/自愈"的方法论与步骤 | Markdown 指令 |
| **Plugin / MCP Server** | 提供可调用工具（recording/replay/execution） | Node.js / Python 服务 |
| **Per-Website Skill** | 编译产物（tools + workflows + tests） | JSON/YAML/JS 文件包 |

### 7.2 MCP Server 提供的核心工具

```
start_recording(url, task_description)
  → 启动浏览器录制会话

stop_recording()
  → 结束录制，返回 RecordingSession 数据

mine_apis(recording_session_id)
  → 运行聚类/差分/schema归纳，返回候选 EndpointTemplate[]

generate_skill(site_id, templates[], intents[])
  → 生成 per-website skill 包

run_tool(skill_id, tool_name, args)
  → 在浏览器 session 内执行工具，返回结构化结果

validate_skill(skill_id)
  → 跑回归测试 + 指纹比对

heal_skill(skill_id, failure_report)
  → 触发自愈流程
```

---

## 8. 数据模型

### 8.1 RecordingSession

```typescript
interface RecordingSession {
  session_id: string
  site_id: string
  started_at: ISO8601
  ended_at: ISO8601
  events: UIEvent[]           // click/submit/type + timestamp
  requests: NetworkRequest[]  // URL/method/headers/body
  responses: NetworkResponse[]
  trace_links: TraceLink[]    // 事件 → 请求的因果关联
  page_snapshots: PageSnapshot[]
}
```

### 8.2 EndpointTemplate

```typescript
interface EndpointTemplate {
  cluster_key: string         // (method, pathname_pattern, content_type)
  path_template: string       // "/api/v1/search?q={query}&page={page}"
  method: HTTPMethod
  required_fields: FieldSpec[]
  optional_fields: FieldSpec[]
  derived_fields: DerivedFieldSpec[]  // CSRF, nonce, timestamp 等
  request_body_schema: JSONSchema
  response_schema: JSONSchema
  preconditions: Condition[]   // 需要先登录？需要先调用哪个 API？
  postconditions: Condition[]  // 调用后状态如何变化？
  observed_count: number       // 录制中观察到的调用次数
}
```

### 8.3 ToolSpec

```typescript
interface ToolSpec {
  name: string                   // shop_search_products
  description: string            // NL 描述
  domain: string                 // amazon.com
  input_schema: JSONSchema
  output_schema: JSONSchema
  execution: {
    strategy: 'api_first' | 'ui_only' | 'api_only'
    endpoint_template_ref: string
    derived_token_extractors: string[]  // extractor 脚本引用
    fallback_policy: 'ui_retry' | 'abort' | 'human_escalate'
  }
  verification: {
    success_condition: string
    schema_match: boolean
  }
}
```

### 8.4 WorkflowSpec

```typescript
interface WorkflowSpec {
  workflow_id: string
  description: string
  states: Record<string, WorkflowState>
  transitions: Transition[]
  entry_conditions: Condition[]
  exit_conditions: {
    success: Condition
    abort: Condition
  }
  human_required_steps: string[]
}
```

### 8.5 SiteFingerprint

```typescript
interface SiteFingerprint {
  site_id: string
  bundle_hashes: Record<string, string>     // 关键 JS bundle 的 hash
  critical_endpoint_shapes: Record<string, string>  // response shape hash
  graphql_schema_hash?: string
  last_validated_at: ISO8601
  validation_result: 'pass' | 'drift_detected' | 'breaking_change'
}
```

---

## 9. 案例分析：Google Flights

Google Flights 没有公开的搜索 API（QPX Express API 已于 2018 年关停）。这使其成为验证 traffic mining 路线的理想案例。

### 9.1 录制输入

用户操作：在 Google Flights 上搜索 "NYC → LAX, 3/15, 往返, 经济舱"。

### 9.2 Mining 产出（预期）

| 挖掘到的 Endpoint | 聚类键 | 用户输入字段 | 派生字段 |
|------------------|--------|------------|---------|
| 搜索航班 | `POST /travel/flights/search` | origin, dest, date, cabin, passengers | `hl`, `gl`, session cookie |
| 获取详情 | `GET /travel/flights/booking?...` | flight_id | session state |
| 价格日历 | `POST /travel/flights/calendar` | origin, dest, month | hl, gl |
| 行李信息 | `GET /travel/flights/baggage?...` | flight_id | — |

### 9.3 生成的 Tool（示例）

```
flight_search(
  origin: "JFK",
  destination: "LAX",
  depart_date: "2026-03-15",
  return_date: "2026-03-20",
  cabin: "economy",
  passengers: 1
) → {
  flights: [
    { id: "...", airline: "Delta", price: 287, duration: "5h30m", stops: 0 },
    { id: "...", airline: "United", price: 312, duration: "5h45m", stops: 0 },
    ...
  ],
  cheapest: { id: "...", price: 287 },
  fastest: { id: "...", duration: "5h15m" }
}
```

### 9.4 对比效果

| 维度 | 纯 Browser Agent | 使用 flight-web-skill |
|------|-----------------|---------------------|
| 步骤数 | ~12（输入出发地→选日期→点搜索→滚动→...）| 1（`flight_search(...)`）|
| Token 消耗 | 高（每步读 DOM/截图） | 低（JSON in/out） |
| 失败点 | DOM 变化、弹窗遮挡、元素定位失败 | API 变化（可自愈） |
| 信息完整度 | 只能看到当前页 | 一次拿到完整结果集 |

---

## 10. 案例分析：Amazon 购物

Amazon 没有面向消费者的购物 API（PA-API 仅用于联盟营销，SP-API 仅面向卖家）。这使其成为验证"读 + 写"全链路的理想案例。

### 10.1 预期 Tool 集

**读操作（API 化率预期 > 90%）：**
- `shop_search_products(query, category, sort, page)`
- `shop_get_product_detail(asin)`
- `shop_get_reviews(asin, sort, page)`
- `shop_check_availability(asin, zip_code)`

**写操作（API 化率预期 50-70%，部分需 UI fallback）：**
- `shop_add_to_cart(asin, quantity)` — 可能触发 CSRF
- `shop_apply_coupon(coupon_code)` — 需要 session state
- `shop_checkout_precheck()` — 返回订单摘要
- `shop_confirm_order()` — **human_required: true**

### 10.2 难点预判

| 难点 | 影响 | 应对 |
|------|------|------|
| Amazon 的反爬/fingerprint | 请求可能被拦截 | 在同源浏览器 session 内发请求 |
| CSRF token 动态刷新 | add_to_cart 可能失败 | extractor 从 cookie/meta 提取 |
| A/B 实验导致 DOM/API 不一致 | schema 漂移 | fingerprint 检测 + 自愈 |
| 支付流程多阶段 | 状态机复杂 | workflow DAG + human gate |

---

## 11. 关键流程

### 11.1 首次生成

```
1. 选择站点与目标任务集
   ├─ 优先选读操作（search/list/detail/filter）
   └─ 然后引入关键写操作（add_to_cart/coupon/checkout）

2. 执行录制
   ├─ 人工演示 2-3 遍（覆盖不同参数组合）
   └─ 或让 agent 自动探索 + 人工补充

3. 运行 API Miner
   ├─ 聚类 endpoint
   ├─ 差分参数
   ├─ 归纳 schema
   └─ 分类字段（用户输入 / 常量 / 派生）

4. PM Brain 推导意图
   ├─ 从 flow 中抽取 top tasks
   └─ 映射到领域意图库

5. 生成 tools + workflows + tests

6. 自动跑最小回归集
   └─ 通过 → 产出 v1 skill
```

### 11.2 在线执行

```
1. 接收任务意图（NL）
2. 选择最匹配的 workflow
3. 按 DAG 执行 tools（API-first）
4. 每步校验结果
   ├─ 成功 → 继续
   ├─ 失败 → UI fallback
   ├─ UI 也失败 → 触发自愈 / human escalate
   └─ human_required → 暂停等待确认
5. 返回结构化结果
```

### 11.3 自愈更新

```
1. 检测失败
   ├─ schema mismatch（response 结构变了）
   ├─ auth failure（token 过期/规则变化）
   ├─ state drift（隐状态不一致）
   └─ fingerprint drift（站点版本变化）

2. 触发同任务重录

3. diff 旧模板 vs 新流量
   ├─ endpoint 是否变了？
   ├─ 字段是否改名/嵌套改变？
   └─ 多了哪些必填参数？

4. 自动更新 schema + 模板 + extractor

5. 回归测试
   ├─ 通过 → 发布新版本
   └─ 失败 → 标记为需要人工介入
```

---

## 12. 评估指标

| 指标 | 定义 | 目标 |
|------|------|------|
| **API 化率** | `API tool steps / total steps` | > 70%（读），> 50%（写） |
| **任务成功率** | 端到端完成率 | > 85% |
| **平均步骤数** | 完成同一任务的 agent 步骤 | 比纯浏览减少 60%+ |
| **回退率** | UI fallback 触发占比 | < 20% |
| **自愈成功率** | 自动修复成功 / 总失败 | > 60% |
| **高风险误执行率** | 未经确认的写操作执行 | **0** |

---

## 13. MVP 分阶段

### P0：读操作验证

- 选 1-2 个站点（推荐 Google Flights + 一个电商/信息站）
- 只做读操作：search / list / detail / filter / sort
- 完成 Recorder → Miner → Synthesizer → 基础 Runtime
- 交付：可工作的 per-website skill，API 化率 > 80%

### P1：受控写操作

- 引入 add_to_cart / apply_coupon / checkout_precheck
- 增加 human-required 节点
- 上线自愈 pipeline（半自动）
- 交付：读写混合 skill，Self-heal 基础可用

### P2：规模化

- 支持跨页面长工作流
- 强化指纹与变更检测
- 多站点技能包管理、质量评分
- 探索与 WebMCP 的对接
- 交付：3-5 个站点 skill，自动化运维

---

## 14. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 动态签名/强风控导致模板失效 | 中 | 写操作不可用 | 限制范围 + human-in-loop + 站点分级 |
| 站点频繁变更导致维护成本高 | 中 | skill 失效 | fingerprint + auto-diff + 回归门禁 |
| 工具语义漂移（能调用但业务含义变了） | 低 | 错误操作 | 业务级 verifier（价格一致性/状态校验） |
| 合规风险 | 中 | 法律问题 | 用户本地执行 + ToS 审查 + 优先官方 API |
| LLM 对录制数据的理解不准 | 中 | 生成错误工具 | 人工 review + 回归测试强制通过 |

---

## 15. 结论

**Web Use Skill Compiler 的本质是：把网站这个"高维、低结构的 GUI 环境"编译成"低维、强约束的 API 工具空间"。**

它不追求"任意网站零成本完美 API 化"——这在当前网页生态下不可能。它追求的是：

1. **能 API 就 API**（读操作 > 80%，写操作 > 50%）
2. **不能 API 就退**（graceful UI fallback）
3. **退了能自愈**（contract testing + schema evolution）
4. **该让人来就让人来**（human gate 在关键节点）

这是从 GUI 到 API 的过渡桥梁——短期靠挖掘覆盖长尾，中长期靠 WebMCP 标准提升可靠性。当 WebMCP 普及的那天，这个编译器的"前端"（mining）退役，而"后端"（runtime + governance）继续服务。

---

> *"The people who are crazy enough to think they can change the world are the ones who do."*
>
> *我们不是在写一个爬虫——我们是在为每个网站写一个 SDK。*
