# Gap Coverage Matrix

## 概述

OpenTabs v1 在实际使用中暴露了 12 个 design gaps。OpenWeb v2 的三层架构（L1 / L2 / L3）全部覆盖了这些 gaps。

## 重点 Gaps

### Gap 002 — Browser State Extraction

| 属性 | 值 |
|------|---|
| Severity | Critical |
| Layer | L2 |
| 影响范围 | 60+ plugins（最普遍的 gap） |

**问题**：大量网站依赖 browser state（cookies、localStorage、sessionStorage）进行认证，v1 没有统一机制提取这些状态。

**OpenWeb v2 方案**：L2 auth primitives 完全覆盖。定义了 `cookie`、`bearer`、`page_global` 等 auth type，runtime 自动从 browser session 中提取所需凭据。

### Gap 004 — Dynamic Request Signing

| 属性 | 值 |
|------|---|
| Severity | High |
| Layer | L2 + L3 |
| 影响范围 | 10 plugins |

**问题**：部分网站要求 request 带有动态签名，签名算法各异。

**OpenWeb v2 方案**：80/20 split。

- **L2 覆盖 7/10**：三个 signing primitive 处理了大部分情况
  - `SAPISIDHASH` — Google 系网站
  - `SigV4` — AWS 风格签名
  - `gapi_proxy` — Google API proxy
- **L3 覆盖 3/10**：OnlyFans、TikTok、其他高度混淆签名用 L3 adapter

### Gap 005 — CSRF Token Rotation

| 属性 | 值 |
|------|---|
| Severity | High |
| Layer | L2 |
| 影响范围 | 33 个网站 |

**问题**：CSRF token 需要在每次请求前动态获取，来源多样（meta tag、cookie、API response、header、hidden form field）。

**OpenWeb v2 方案**：5 种 L2 primitives 完全覆盖：

| Primitive | 说明 |
|-----------|------|
| `meta_tag` | 从 HTML `<meta>` 标签提取 |
| `cookie` | 从 cookie 中读取 |
| `api_response` | 从 API 返回值中提取 |
| `response_header` | 从 HTTP response header 提取 |
| `hidden_field` | 从 HTML hidden form field 提取 |

### Gap 007 — No HTTP API

| 属性 | 值 |
|------|---|
| Severity | High |
| Layer | L3 |
| 影响范围 | WhatsApp, Telegram |

**问题**：部分 Web 应用没有可调用的 HTTP API，内部使用 WebSocket 或自定义 protocol 通信。

**OpenWeb v2 方案**：纯 L3。adapter 通过网站内部的 module 系统（如 WhatsApp 的 `window.require`、Telegram 的 MTProto module）直接调用功能。

## 完整 Gap 覆盖表

| Gap | 描述 | Severity | Layer | Primitives |
|-----|------|----------|-------|------------|
| 001 | Authentication diversity | High | L2 | cookie, bearer, page_global |
| 002 | Browser state extraction | Critical | L2 | auth primitives |
| 003 | Multi-step auth flows | Medium | L2 | login_url + cookie |
| 004 | Dynamic request signing | High | L2+L3 | SAPISIDHASH, SigV4, gapi_proxy + adapters |
| 005 | CSRF token rotation | High | L2 | meta_tag, cookie, api_response, response_header, hidden_field |
| 006 | Pagination diversity | Medium | L2 | cursor, offset, link_header, page_number |
| 007 | No HTTP API | High | L3 | WhatsApp adapter, Telegram adapter |
| 008 | Rate limiting | Medium | L2 | risk_tier + rate limiter |
| 009 | Response format instability | Low | L2 | extraction + fingerprint |
| 010 | Write operation safety | High | L2 | risk_tier + confirmation |
| 011 | GraphQL complexity | Medium | L2+L3 | persisted query hash (L3), standard query (L2) |
| 012 | WebSocket/SSE streams | Medium | L2 | AsyncAPI spec |

## Traceability

每个 gap 都可追溯到：

- 原始问题描述（v1 中遇到的具体失败场景）
- 对应的 L2 primitive 或 L3 adapter 定义
- 覆盖该 gap 的 parity test
