# Adapter 规范化 — 对齐稿 v1

这是第一版对齐稿。刻意保守，只锁定双方初始设计和两轮交叉评审中已达成共识的要点。

后续如果某个 Open Question 被解决，先更新本文档中的正文设计，再删除或修订对应的 Open Question 条目。

## 目标

规范化 OpenWeb 中 adapter 密集的站点，让更多 operation 走共享 runtime 和 spec 基础设施，减少 per-site 代码量，缩小永久 custom bucket。

成功标准：

- 更少的 operation 使用 `x-openweb.adapter`
- 更少的 per-site adapter TypeScript 代码
- 不损失 auth、anti-bot、执行可靠性
- generic runtime 行为与真正 site-specific 逻辑之间的边界更清晰

迁移单位是 **operation**，而非 site。一个 site 即使还有少量 operation 保持 custom，也可以变成基本 canonical。

## 现状

- 93 个站点中有 60 个仍有 custom adapter 代码
- 33 个站点已经是 canonical
- 当前 spec 中约 380 个 operation 引用了 adapter，分布在 58 个站点

大多数 adapter 代码重复做同一类工作：

- page 定位与就绪等待
- anti-bot sensor 预热与 session 准备
- browser context 请求粘合
- DOM、SSR、JSON-LD 或 response capture extraction
- GraphQL 请求组装
- response unwrap 和轻度规范化

核心结构性问题不只是"缺少 helper"，而是当前 adapter 契约让每个站点重新接管了本该由 runtime 拥有的 lifecycle。

## 设计原则

- KISS。不引入通用 workflow DSL。
- 优先复用已有的 runtime/spec 机制：`transport`、auth、CSRF、signing、extraction、`wrap`、`unwrap`。
- 保持一个统一的共享执行模型。不为同一件事创建语义不同的平行系统。
- 以 operation 为单位跟踪迁移进度，而非以 site 文件夹为单位。
- 保留一个小型永久 custom bucket。部分站点就该保持 custom。
- 涉及接口变更时，偏好分阶段迁移而非大爆炸重写。

## 对齐设计

### 1. 将通用 lifecycle 移入共享 runtime

增加 runtime 拥有的 page/session lifecycle 配置，让 browser-backed operation 不再在 adapter 里手写 page 准备逻辑。

使用 `x-openweb.page` block 承载通用 lifecycle 旋钮：

- `entry_url`
- `match`
- `ready`
- `wait_until`
- `settle_ms`
- `warm`

所有 browser-backed 执行路径都应使用这个共享 lifecycle：request、extraction、GraphQL、capture，以及未来的 custom runner。

核心行为流程：

1. 解析 operation runtime mode
2. 解析 page plan
3. 获取或复用正确的 page
4. 等待就绪，可选 settle
5. 如有配置则 warm session
6. 解析 auth、CSRF、signing
7. 执行 operation 特定逻辑
8. 应用 `unwrap` 和 schema validation
9. 分类失败类型（`needs_login`、`bot_blocked`、`needs_page`、`fatal` 或 retriable）

这是杠杆最大的共享变更，因为它移除了大部分 adapter `init()` 行为和大部分 adapter `isAuthenticated()` 职责。

### 2. 先修复共享请求执行，再删除大部分 API wrapper adapter

纯请求或接近纯请求的 adapter 只能在共享 runtime 能表达其当前行为之后才能转换。

首批必须修复的 runtime 问题：

- `browser_fetch`、`session_http` 及其他共享 executor 之间的 request body 对等（form-encoded body）
- page targeting 能力：即使 API origin 不同，也能打开真实的 app page
- 统一的 browser-backed 请求准备路径，替代反复出现的 `page.goto()` + `page.evaluate(fetch(...))` 代码
- server URL 变量替换（如 `{subdomain}.substack.com`）——当前 `getServerUrl()` 返回原始字符串，不做变量解析

这意味着大多数"纯 spec"转换依赖这些 runtime 修复先落地。

**例外：可提前转换的站点。** 少量 adapter 可以在基础设施就绪前就通过纯 spec 编辑完成转换。具体条件：(a) server URL 是静态的，(b) operation 只需要 JSON POST + 已有的 auth/CSRF primitive，(c) 现有的 `browser_fetch` 或 `session_http` executor 已能处理该请求形状。例如：zhihu 的 `cancelUpvote` 是 POST 到 `/api/v4/answers/{answer_id}/voters`，`csrf: cookie_to_header` 已在 server 层声明——只需在 operation 层加上 `transport: page` 即可。这些提前胜利可以验证方案并在基础设施落地前减少 adapter 数量。

### 3. 共享 extraction：spec primitive 优先，helper 服务于缩小后的 custom bucket

extraction 复用应优先扩展已有的 typed extraction 系统。adapter helper 在 adapter 仍需保持 custom 且 extraction 只是更大流程中的一步时仍然有用，但不应成为规范化的主要路径。

达成共识的共享 extraction 新增（spec 级 primitive）：

- JSON-LD extraction（`ld_json` / `json_ld`）
- 泛化 SSR hydration extraction，超越 `__NEXT_DATA__`
- 结构化 DOM extraction，覆盖简单 object 和 list 场景
- HTML 源码 extraction 支持，让获取的 HTML 能使用同一套 extraction 引擎

`page_global_data` 保留为桥接和兜底方案，覆盖 typed extraction 尚未覆盖的场景。

**Spec primitive 和 adapter helper 服务于不同场景。** Spec 级 extraction 是默认路径，因为它能彻底删除 adapter。Adapter helper（如通过 `AdapterHelpers` 注入的 `domExtract()`、`ssrExtract()`、`jsonLdExtract()`）面向更小的一组仍需保持 custom 且 extraction 只是更大流程中一步的 operation（如：提取 SSR state，用某个值发 API 请求，再合并结果）。两者应共享相同的 field-mapping 契约和语义。

实现说明：adapter helper 通过 runtime 的 `helpers` 参数注入（`adapter-executor.ts`），在 runtime 进程中运行，可直接复用 extraction 引擎。不违反 adapter import 约束。

### 4. 首期 GraphQL 和 capture 共享范围保持窄

共享 GraphQL 和 capture 基础设施有用，但仅限于 pattern 真正通用的场景。

共享 GraphQL 应覆盖：

- 固定 inline query
- persisted query hash
- typed variable/body mapping
- 已有的 `wrap` / `unwrap` 行为

dynamic bundle scanning、rotating query-id discovery、site-specific query synthesis 应保持 custom，直到有通用 pattern 被验证。

共享 capture 应覆盖：

- navigation + 简单 trigger
- matched response capture
- 基本 parse 和 `unwrap`

progressive polling、"best of N" response selection、multi-response stateful capture 暂时保持 custom。

### 5. 共享准备就绪后再缩小 custom 接口

目标终态：剩余 custom 代码接收一个已准备好的 context，只实现独特的数据获取逻辑。

Custom 代码应保留给：

- 定制 signing
- module cache 或框架内部遍历
- 多步 mutation 协议
- 真正 site-specific 的协议或二进制处理

对齐方向是减少或移除 adapter 自有的 `init()` 和 `isAuthenticated()` 逻辑，但需分阶段。首期实现应先落地共享 lifecycle，再精简 custom 接口。

### 6. response mapping 保持最小化——但定义"最小"

首期实现应继续使用：

- 已有的 `unwrap`（dot-path extraction）
- extraction field mapping（来自 typed extraction primitive）
- 仅在必要时保留少量 site-specific 规范化

首期不引入宽泛的 response-mapping DSL。

但 response mapping 确实是一个缺口：约 40 个 adapter 做了超出 `unwrap` 能力的 field rename、type coercion 或 array restructure。设计应承认一部分 adapter 代码将纯粹因 response shaping 而存活，并在 Phase 1-3 揭示剩余 mapping 代码量后重新评估是否需要一个小型 typed mapping surface（field rename、type cast、array flatten）。

### 7. 增加 guardrail 确保规范化不退化

增加共享报告和强制措施，防止新站点工作重新创建 mini-runtime。

Guardrail 应包括：

- operation 级 adapter 使用清单
- site 代码中低级 pattern 报告：如 `page.goto`、`page.evaluate(fetch`、直接 DOM scraping、response interception
- lint 或 test check 阻止这些 pattern 出现在已规范化的路径上
- 文档更新，定义规范化阶梯和永久 custom bucket

## 迁移模型

### 量化框架

精确的 per-wave 数量应在 operation 级清单重新验证后确定（见下方 OQ）。基于初步分析的量级目标：

- 当前约 380 个 adapter-backed operation，分布在 58 个 wired site
- 约 18,000 行 adapter 代码总量
- Phase 1-3 目标：adapter 代码总量减少约 40-55%
- 终态：永久 custom bucket 约 7-15 个站点，具有真正不可约的复杂性

### Phase 0：提前转换（无基础设施依赖）

少量 adapter 可以今天就通过纯 spec 编辑完成转换：

- `zhihu` `cancelUpvote`：POST + CSRF 已声明，在 operation 层加 `transport: page`
- `hackernews` 读操作：Algolia 公共 API，`transport: node`，无 auth
- 任何 server 已正确声明 auth/csrf 且 operation 是简单 GET/POST 的单操作 adapter

这些可验证方案并立即减少 adapter 数量。

### Phase 1：共享 lifecycle 与请求对等

落地纯请求 adapter 实际需要的 runtime 工作：

- page-plan 支持
- request-body 对等
- 共享 browser-backed 请求准备

### Phase 2：共享 extraction 扩展

增加达成共识的 extraction primitive 和引擎改进：

- JSON-LD
- 泛化 SSR hydration
- 结构化 DOM extraction
- 共享 HTML 源码 extraction

### Phase 3：先转换风险最低的 operation

从 Phase 1 和 Phase 2 就绪后即可变成 canonical 的 operation 开始。

Phase 1 后可能的纯 spec 候选：

- `apple-podcasts`
- `fidelity`
- `grubhub`
- `hackernews` 读操作
- `seeking-alpha`
- `starbucks`
- `substack`
- `weibo`
- `zhihu`

Phase 2 后可能的 extraction 候选：

- `boss`
- `douban`
- `ebay`
- `etsy`
- `goodreads`
- `google-search`
- `producthunt`
- `redfin`
- `reuters`
- `rotten-tomatoes`
- `tripadvisor`
- `yelp`
- `indeed`
- `zillow`

这些列表刻意保守。有争议的站点在按 operation 重新分类之前不进入早期批次承诺。

### Phase 4：已验证通用场景的共享 GraphQL 与 capture

在共享 lifecycle 和 extraction 工作完成后，仅迁移符合上述窄通用 pattern 的 GraphQL 和 capture operation。

### Phase 5：缩小剩余 custom bucket

共享 runtime 拥有 lifecycle 且低风险共享策略运行稳定后，精简剩余 custom 接口，只保留真正 site-specific 的场景。

## 永久 custom bucket

至少以下站点应视为 custom，直到有证据证明可以转换：

- `bilibili` — Wbi/MD5 signing, protobuf danmaku, CSRF via cookie
- `notion` — transaction-based mutation protocol
- `opentable` — webpack module access, signing
- `telegram` — webpack module scanning, getGlobal state reader
- `tiktok` — network intercept + signing + progressive capture
- `whatsapp` — Meta's Metro module system
- `x` — dynamic queryId + transaction-id signing + webpack modules

可能 custom 但待审查（见 OQ #11）：

- `booking`（905 行 — Apollo SSR + LD+JSON + GQL intercept，最复杂之一）
- `costco`（965 行 — POST-based APIs via Playwright request context，最大的 adapter）
- `google-maps`（540 行 — protobuf pb param API, network intercept）
- `youtube`（574 行 — InnerTube API + sapisidhash + protobuf continuation params）
- `spotify`（355 行 — dynamic bearer token extraction + pathfinder GQL）
- `linkedin`（282 行 — dynamic queryId extraction from JS bundles）
- `bluesky`（296 行 — ATP/XRPC protocol, dynamic PDS URL discovery）

这些不是设计的失败，而是定义了共享系统的合理边界。

## 首期实现的非目标

- 通用 workflow DSL
- 一次性重写所有 adapter 接口
- 强制所有 GraphQL 或 capture 站点转为声明式配置
- 宽泛的 response-mapping DSL
- 消灭永久 custom bucket

## 验证

实现方案至少应验证：

- app page 与 API origin 不同时的 page-targeting 和就绪行为
- 共享 executor 之间的 request-body 对等，包括 form-encoded body
- lifecycle 移入 runtime 后的 auth、CSRF、signing、warmup 和失败分类
- JSON-LD、SSR hydration、DOM list/object extraction、HTML 源码 extraction
- operation 级拆分迁移：读操作先迁移，写操作保持 custom
- guardrail 阻止已规范化路径重新引入低级 per-site runtime 代码

## Open Questions

1. `x-openweb.page` 在 global server config 和 per-operation override 之间的精确 schema 和优先级模型是什么？
2. 多子域站点（如 Substack）的精确 host/origin 参数化模型是什么？共识是 runtime 需要变量 host 解析；问题是应来自 OpenAPI server variables、`x-openweb.page`，还是另一个小扩展。当前 `spec-loader.ts` 中的 `getServerUrl()` 返回原始字符串，不做解析。
3. 泛化 SSR 支持应是新 primitive（`ssr_hydration`）还是现有 SSR/script extraction primitive 的扩展？Apollo `__ref` 解析和 Vue `__INITIAL_STATE__` 语义不同——应共享一个 primitive 还是分开？
4. 首期 DOM extraction 在 spec 中声明式化到什么程度（`dom_list`/`dom_object`）？简单场景（5-10 个 selector，扁平 field mapping）适合 YAML。复杂场景（Yelp 的 SSR+DOM merge、Amazon 的混合 API+DOM+locator click）不适合——边界在哪？
5. adapter extraction helper（`domExtract`、`ssrExtract`、`jsonLdExtract`）应在首期与 spec 级 primitive 同时发布，还是在 typed extraction 引擎验证后再发布？
6. GraphQL 和 capture 应表达为 config 中的独立 runtime strategy，还是现有 transport 和 extraction surface 的窄扩展？
7. 除了固定 query 和 persisted hash，还有哪些 GraphQL lookup pattern 足够通用可以共享？Dynamic bundle scanning（LinkedIn）和 API response query-id extraction（X）明确属于 custom——有没有中间地带？
8. progressive 或 multi-response capture 是否存在可复用的抽象，还是应永久保持 custom？
9. `unwrap` 加上 extraction field mapping 对首批迁移波次是否足够，还是会有大量 response-mapping 代码残留在 adapter 中？应在 Phase 1-3 后再测量，而非提前推测性设计。
10. `CodeAdapter` 从 `init()` / `isAuthenticated()` / `execute()` 缩小到更小的 prepared-context 接口的分阶段迁移路径是什么？子问题：runtime 是否应从 spec 提供默认 `init`/`isAuthenticated`（domain 来自 server URL，auth 来自 auth primitive）同时允许 adapter override，作为过渡步骤？
11. 按 operation 重新分类后，哪些有争议的站点应排除在早期批次之外？扩展列表包括 `instagram`（多步 API 组合：username→userId→feed）、`goodrx`（anti-bot navigation + DOM/JSON-LD extraction）、`bluesky`（XRPC protocol）、`youtube`（InnerTube + protobuf）、`linkedin`/`spotify`（dynamic query-id/bearer discovery）、`booking`（905 行，最重的混合 adapter）、`costco`（965 行，最大 adapter）和 `google-maps`（protobuf API）。
12. 何时发布硬性 per-wave 数量和代码缩减目标：现在还是 operation 级清单重新验证后？
13. Phase 2 中哪些 extraction primitive 需要 HTML 源码/node 执行支持，source selection 如何建模？设计已假设共享 HTML 源码 extraction 有用；剩余问题是 `json_ld`、`dom_list`、SSR extraction 等 primitive 的范围和机制。
14. `x-openweb.page`（PagePlan）如何与 `extraction-executor.ts` 中现有的 page-targeting 逻辑交互？extraction executor 已处理 page 复用、navigation 和 ownership。PagePlan 应泛化或替代该逻辑——而非创建平行系统。
