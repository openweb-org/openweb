# Layer 2: Interaction Primitives -- Pattern DSL (中文概要)

> **状态**: COMPLETE
> **覆盖 Gaps**: 001-006, 008-010, 012
> **原则**: 结构是默认，代码是例外。

## 概述

L2 是一组**参数化 patterns** 的词汇表，描述网站如何保护和组织 API。每个 pattern 是一个 discriminated union（通过 `type` 区分），带有固定 schema。Runtime 为每种 type 实现一个 handler。新增 pattern = 新增 handler + 新增 schema 条目。无法用 L2 表达的逻辑，落入 L3 code adapters。

**覆盖目标**: L1 (OpenAPI) + L2 (primitives) 处理约 90% 的网站，L3 code adapters 处理剩余约 10%。

## 架构

### Primitives 的位置

L2 primitives 通过 `x-openweb` extensions 嵌入 OpenAPI spec：

- **Server-level** (`servers[].x-openweb`): auth, csrf, signing -- 该 server 下所有 operations 共享
- **Operation-level** (`paths[].{method}.x-openweb`): pagination, extraction -- 每个 endpoint 独立

```yaml
openapi: 3.1.0
info:
  title: Bluesky XRPC API
servers:
  - url: https://bsky.social/xrpc
    x-openweb:
      mode: session_http
      auth:
        type: localStorage_jwt
        key: BSKY_STORAGE
        path: session.currentAccount.accessJwt
        inject:
          header: Authorization
          prefix: "Bearer "
paths:
  /app.bsky.feed.getTimeline:
    get:
      operationId: getTimeline
      x-openweb:
        pagination:
          type: cursor
          response_field: cursor
          request_param: cursor
```

### 五大分类

| 分类 | 级别 | 用途 | 触发时机 |
|---|---|---|---|
| **auth** | server | 请求认证 | 每个请求 |
| **csrf** | server | Anti-CSRF token 处理 | 仅 mutation 方法 (POST/PUT/DELETE/PATCH) |
| **signing** | server | 每请求密码学签名 | 每个请求（或有范围限定） |
| **pagination** | operation | 翻页 | client 请求下一页时 |
| **extraction** | operation | 从非 API 来源获取数据 (SSR, DOM) | 网站不提供 REST/GraphQL API 时 |

### Inject Model

每个产生值的 primitive 通过 `inject` 来放置到请求中：

```typescript
interface Inject {
  header?: string;      // Header name (e.g., "Authorization")
  prefix?: string;      // Value prefix (e.g., "Bearer ")
  query?: string;       // Query parameter name
  body_field?: string;  // Body field name (dot path for nested: "data._csrf")
  body_merge?: boolean; // Merge entire extracted object into request body
}
```

多个 target 可同时存在。例如 Reddit 的 modhash 同时注入 header 和 body：

```yaml
inject:
  header: X-Modhash
  body_field: uh
```

### Template Expressions

字符串值支持 `${source:key}` 模板语法，用于交叉引用：

| Template | 解析为 |
|---|---|
| `${cookie:name}` | cookie `name` 的值 |
| `${localStorage:key}` | localStorage key 的值 |
| `${response:field.path}` | 上一步 response 中的字段 |
| `${env:VAR}` | 环境变量 |

例如 Costco 的 sessionStorage key 依赖一个 cookie：

```yaml
key: "authToken_${cookie:hashedUserId}"
```

---

## Auth Primitives (9 种)

描述 token 如何获取并注入请求。每个网站的 `auth` config 是单一 primitive（由 `type` 区分）。

### `cookie_session`

纯 cookie auth。浏览器通过 `credentials: 'include'` 自动发送 cookie，无需 token extraction。

```yaml
auth:
  type: cookie_session
```

**适用网站**: 约 40% 的网站。Instagram (session + CSRF), GitHub (session + CSRF), LeetCode, Sentry, Reddit (GET 请求)。

**Runtime**: 在 fetch 上设置 `credentials: 'include'`，无其他操作。

**检测信号**: HttpOnly session cookies 存在，API 调用仅靠 cookies 即可成功。

---

### `localStorage_jwt`

JWT 或 token 存储在 localStorage 的某个 key 下，可能嵌套在 JSON 中。

```yaml
auth:
  type: localStorage_jwt
  key: string            # localStorage key name
  path: string?          # JSON path within the parsed value (dot notation)
  inject: Inject         # where to put the token
```

**示例 -- Bluesky**:
```yaml
auth:
  type: localStorage_jwt
  key: BSKY_STORAGE
  path: session.currentAccount.accessJwt
  inject:
    header: Authorization
    prefix: "Bearer "
```

**适用网站**: Bluesky, ClickUp (`cuHandshake`), Robinhood (`web:auth_state.access_token`), Linear, Auth0 站点。

**Runtime**: `JSON.parse(localStorage.getItem(key))`，遍历 `path`，inject value。需要浏览器上下文。

**检测信号**: localStorage keys 匹配 `auth|token|session|jwt|MSAL|auth0`。Authorization header 中的 3 段 base64 JWT。

---

### `sessionStorage_token`

Token 存储在 sessionStorage 中。Key 可以是静态或模板化的。

```yaml
auth:
  type: sessionStorage_token
  key: string            # sessionStorage key (supports ${} templates)
  path: string?          # JSON path within value
  inject: Inject
```

**示例 -- Costco**:
```yaml
auth:
  type: sessionStorage_token
  key: "authToken_${cookie:hashedUserId}"
  inject:
    header: Authorization
    prefix: "Bearer "
```

**适用网站**: Costco, Azure (MSAL tokens)。

---

### `sessionStorage_msal`

专门处理 Microsoft MSAL token cache（sessionStorage 中）。Keys 是动态的 (`msal.token.keys.*`)，需按 pattern + scope 扫描。

```yaml
auth:
  type: sessionStorage_msal
  key_pattern: string    # glob pattern for sessionStorage keys
  scope_filter: string?  # OAuth scope to match (e.g., "user.read")
  token_field: string    # field in matched entry (e.g., "secret")
  inject: Inject
```

**示例 -- Excel Online**:
```yaml
auth:
  type: sessionStorage_msal
  key_pattern: "msal.token.keys.*"
  scope_filter: "Files.ReadWrite.All"
  token_field: secret
  inject:
    header: Authorization
    prefix: "Bearer "
```

**适用网站**: OneNote, PowerPoint Online, Excel Online, Azure Portal, Teams。

**Runtime**: 扫描 sessionStorage keys 匹配 pattern，解析 JSON，找到 `scopes` 包含 `scope_filter` 的条目，提取 `token_field`。

---

### `page_global`

从 `window.*` globals 提取 token 或值（页面初始化时由应用 JavaScript 设置）。

```yaml
auth:
  type: page_global
  expression: string     # dot path from window
  inject: Inject
  values:                # optional: additional extractions
    - expression: string
      inject: Inject
```

**示例 -- Netflix**:
```yaml
auth:
  type: page_global
  expression: "netflix.reactContext.models.memberContext.data.userInfo.authURL"
  inject:
    query: authURL
```

**示例 -- YouTube** (需要 API key + session index):
```yaml
auth:
  type: page_global
  expression: "ytcfg.data_.INNERTUBE_API_KEY"
  inject:
    query: key
  values:
    - expression: "ytcfg.data_.SESSION_INDEX"
      inject:
        header: X-Goog-AuthUser
```

**适用网站**: Netflix, npm (`__context__`), Sentry (`__initialData`), PostHog, YouTube (`ytcfg.data_`), New Relic, Stripe。

**Runtime**: `page.evaluate(() => window.{expression})`，inject。

---

### `webpack_module_walk`

通过遍历 webpack 内部 module cache 并调用导出函数来提取 token。用于 token 隐藏在打包 modules 中、没有 global 暴露的场景。

```yaml
auth:
  type: webpack_module_walk
  chunk_global: string   # webpack chunk array name on window
  module_test: string    # JS expression to identify the right module
  call: string           # function to call on the matched module
  inject: Inject
```

**示例 -- Discord**:
```yaml
auth:
  type: webpack_module_walk
  chunk_global: webpackChunkdiscord_app
  module_test: "typeof exports.getToken === 'function' && typeof exports.getToken() === 'string'"
  call: "exports.getToken()"
  inject:
    header: Authorization
```

**适用网站**: Discord, X/Twitter (feature flags + tokens)。

**Runtime**: 向 chunk array push 一个 loader module，遍历 `require.c`，对每个 module 的 exports 求值 `module_test`，匹配后调用 `call`。

**检测信号**: window 上有 `webpackChunk*` globals，token 不在 localStorage/sessionStorage/cookies 中。

---

### `websocket_intercept`

通过 patch `WebSocket.prototype.send` 从 WebSocket frame 捕获 token。用于应用先通过 WebSocket 发送认证凭证，再发起 HTTP API 调用的场景。

```yaml
auth:
  type: websocket_intercept
  frame_match:           # fields to match in parsed JSON frame
    field: string
    value: string
  extract: string        # field to extract from matched frame
  inject: Inject
  timeout: number?       # ms to wait (default: 15000)
```

**示例 -- ClickUp**:
```yaml
auth:
  type: websocket_intercept
  frame_match:
    field: method
    value: auth
  extract: token
  inject:
    header: Authorization
    prefix: "Bearer "
  timeout: 15000
```

---

### `lazy_fetch`

按需从 auth endpoint 获取 token。页面加载时浏览器 storage 中不存在 token，必须主动请求。

```yaml
auth:
  type: lazy_fetch
  endpoint: string       # URL or path to call
  method: string?        # HTTP method (default: GET)
  headers: object?       # additional headers
  extract: string        # JSON path in response
  inject: Inject
  cache: boolean?        # cache token across requests (default: true)
  refresh_on: number[]?  # HTTP status codes that trigger re-fetch (default: [401, 403])
```

**示例 -- ChatGPT**:
```yaml
auth:
  type: lazy_fetch
  endpoint: /api/auth/session
  extract: accessToken
  inject:
    header: Authorization
    prefix: "Bearer "
  cache: true
  refresh_on: [401, 403]
```

**适用网站**: ChatGPT, Claude（类似模式）。

**Runtime**: 首次 API 调用时（或 refresh 触发后），用当前 session cookies 调用 endpoint，从 response 提取 token，缓存，注入后续请求。遇到 401/403 时清除缓存并重新获取。

---

### `exchange_chain`

多步 token exchange：每步的输出传给下一步。用于企业 auth 流程，一个 primary credential 通过中间 API 调用交换为 secondary token。

```yaml
auth:
  type: exchange_chain
  steps:
    - call: string           # HTTP method + URL
      headers: object?
      body: object?          # supports ${} templates
      extract: string        # JSON path to extract from response
      as: string?            # name for later reference (default: "token")
      expires_field: string? # JSON path to expiration
  refresh_before: string?    # duration before expiry to trigger refresh
  inject: Inject             # where to put the final token
```

**示例 -- Reddit OAuth**:
```yaml
auth:
  type: exchange_chain
  steps:
    - call: POST https://www.reddit.com/svc/shreddit/token
      body:
        csrf_token: "${cookie:csrf_token}"
      extract: token
      as: bearer
      expires_field: expires
  refresh_before: 30s
  inject:
    header: Authorization
    prefix: "Bearer "
```

**示例 -- Microsoft Teams**:
```yaml
auth:
  type: exchange_chain
  steps:
    - call: POST https://teams.live.com/api/auth/v1.0/authz/consumer
      headers:
        Authorization: "Bearer ${sessionStorage_msal:secret}"
      extract: skypeToken
      as: skype_jwt
  refresh_before: 60s
  inject:
    header: Authorization
    prefix: "Bearer "
```

**适用网站**: Reddit (cookie -> bearer), Teams (MSAL -> Skype JWT), AWS Console (STS credentials refresh)。

---

## CSRF Primitives (5 种)

描述 CSRF token 如何提取并注入。默认只应用于 mutation 方法 (POST, PUT, DELETE, PATCH)。

### `cookie_to_header`

读取一个 non-HttpOnly cookie，将其值注入为自定义 header。**最常见的 CSRF pattern。**

```yaml
csrf:
  type: cookie_to_header
  cookie: csrftoken
  header: X-CSRFToken
```

**适用网站**: Instagram, LeetCode, Bitbucket, PostHog, Sentry。

### `meta_tag`

从 HTML `<meta>` tag 提取 CSRF token。

```yaml
csrf:
  type: meta_tag
  name: csrf-token
  header: X-CSRF-Token
```

**适用网站**: Calendly, GitHub。

### `page_global`

从 window global 变量提取 CSRF token。

```yaml
csrf:
  type: page_global
  expression: "__context__.context.csrftoken"
  inject:
    header: x-csrf-token
```

**适用网站**: Airtable, npm, Stripe, Cloudflare, MongoDB Atlas。

### `form_field`

从 hidden input field 提取 CSRF token（per-form，非 per-session）。

```yaml
csrf:
  type: form_field
  selector: 'input[name="authenticity_token"]'
  header: X-CSRF-Token
```

**适用网站**: GitHub (form-based mutations)。

### `api_response`

从 API endpoint 的 response 获取 CSRF token。

```yaml
csrf:
  type: api_response
  endpoint: /api/me.json
  extract: data.modhash
  inject:
    header: X-Modhash
    body_field: uh
  cache: true
```

**适用网站**: Reddit。

---

## Signing Primitives (3 种)

每请求密码学签名或 delegated request 机制。与 auth（提取已存储的值）不同，signing **计算**每个请求的新值。

### `sapisidhash`

Google 的 SAPISID-based SHA-1 签名，用于所有 Google web 应用。

算法: `SAPISIDHASH ${timestamp}_${SHA1(timestamp + " " + SAPISID + " " + origin)}`

```yaml
signing:
  type: sapisidhash
  origin: "https://www.youtube.com"
  inject:
    header: Authorization
    prefix: "SAPISIDHASH "
```

**Runtime**:
```typescript
const ts = Math.floor(Date.now() / 1000);
const hash = SHA1(`${ts} ${getCookie('SAPISID')} ${origin}`);
setHeader(inject.header, `${inject.prefix}${ts}_${hash}`);
```

**适用网站**: YouTube, Google Analytics, Google Calendar, Google Drive, Google Cloud。

### `gapi_proxy`

将整个请求委托给 Google 的 `gapi.client.request()` 库（库内部处理 SAPISIDHASH）。

```yaml
signing:
  type: gapi_proxy
  api_key:
    source: page_global
    expression: "preload.globals.gmsSuiteApiKey"
  authuser:
    source: page_global
    expression: "preload.globals.authuser"
```

**适用网站**: Google Analytics, Google Calendar, Google Drive, Google Cloud。

**Runtime**: 强制 `mode: browser_fetch`，所有请求通过 `gapi.client.request()` 在页面上下文中路由。

### `aws_sigv4`

AWS Signature Version 4 请求签名。

```yaml
signing:
  type: aws_sigv4
  credentials:
    source: page_global
    expression: "__aws_credentials"
  region: us-east-1
  service: execute-api
```

**适用网站**: AWS Console（带 STS credential refresh）。

---

## Pagination Primitives (4 种)

描述如何翻页多页结果集，定义在 operation 级别。

### `cursor`

基于 cursor 的分页。Response 中包含一个 cursor 值，作为下一个请求的参数传入。

```yaml
pagination:
  type: cursor
  response_field: cursor
  request_param: cursor
  has_more_field: string?    # optional boolean indicator
```

**适用网站**: Bluesky, Discord, Reddit, Slack, X/Twitter。

### `offset_limit`

经典的 offset/limit 分页。

```yaml
pagination:
  type: offset_limit
  offset_param: offset
  limit_param: pageSize
```

### `link_header`

RFC 8288 Link header 分页，常见于 REST API。

```yaml
pagination:
  type: link_header
  rel: next
```

**适用网站**: Sentry, GitHub REST API。

### `page_number`

简单的页码分页。

```yaml
pagination:
  type: page_number
  param: page
  starts_at: 1
```

---

## Extraction Primitives (6 种)

从非 API 来源获取结构化数据：SSR-rendered HTML、框架缓存、DOM 元素。用于网站在初始页面加载时提供数据而非通过 API 调用的场景。

### `ssr_next_data`

从 Next.js `__NEXT_DATA__` global 提取数据。

```yaml
extraction:
  type: ssr_next_data
  page_url: "/homedetails/{zpid}"
  path: props.pageProps.componentProps.gdpClientCache
```

**适用网站**: Zillow 及其他 Next.js 应用。

### `ssr_nuxt`

从 Nuxt.js `__NUXT__` global 或 `_payload.json` 提取数据。

```yaml
extraction:
  type: ssr_nuxt
  path: string
  payload_url: string?
```

### `apollo_cache`

从 Apollo Client 的 in-memory cache 提取数据（SSR 期间填充的 normalized GraphQL 数据）。

```yaml
extraction:
  type: apollo_cache
  source: "netflix.appContext.state.graphqlClient.cache.extract()"
  key_pattern: 'Movie:{"videoId":"${videoId}"}'
```

**适用网站**: Netflix, Instacart, Medium。

### `html_selector`

通过 CSS selectors 从 DOM 元素提取数据。用于纯 SSR 站点。

```yaml
extraction:
  type: html_selector
  page_url: "/news"
  selectors:
    title: ".titleline > a"
    score: ".score"
    author: ".hnuser"
    link: ".titleline > a[href]"
  multiple: true
```

**适用网站**: Hacker News, Wikipedia, Craigslist。

### `script_json`

提取 `<script>` tag 中嵌入的 JSON（常见于 SSR 框架）。

```yaml
extraction:
  type: script_json
  selector: 'script[type="application/json"][id="data-deferred-state-0"]'
  path: "niobeMinimalClientData[0][1].data.presentation"
```

**适用网站**: Airbnb, GitHub (React embedded data), TikTok。

### `page_global_data`

从 window globals 提取结构化数据（非 auth 相关，纯数据）。

```yaml
extraction:
  type: page_global_data
  expression: "yelp.react_root_props"
  path: legacyProps.searchData
```

**适用网站**: Yelp, TikTok, Booking, Google Maps (`APP_INITIALIZATION_STATE`)。

---

## 组合示例：完整站点配置

### Instagram (cookie + CSRF)

```yaml
servers:
  - url: https://www.instagram.com/api/v1
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
      csrf:
        type: cookie_to_header
        cookie: csrftoken
        header: X-CSRFToken
```

### Reddit (multi-server, exchange chain)

```yaml
servers:
  - url: https://www.reddit.com
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
      csrf:
        type: api_response
        endpoint: /api/me.json
        extract: data.modhash
        inject:
          header: X-Modhash
          body_field: uh
  - url: https://oauth.reddit.com
    x-openweb:
      mode: session_http
      auth:
        type: exchange_chain
        steps:
          - call: POST https://www.reddit.com/svc/shreddit/token
            body:
              csrf_token: "${cookie:csrf_token}"
            extract: token
            as: bearer
            expires_field: expires
        refresh_before: 30s
        inject:
          header: Authorization
          prefix: "Bearer "
```

### YouTube (page globals + SAPISIDHASH signing)

```yaml
servers:
  - url: https://www.youtube.com/youtubei/v1
    x-openweb:
      mode: browser_fetch
      auth:
        type: page_global
        expression: "ytcfg.data_.INNERTUBE_API_KEY"
        inject:
          query: key
        values:
          - expression: "ytcfg.data_.SESSION_INDEX"
            inject:
              header: X-Goog-AuthUser
      signing:
        type: sapisidhash
        origin: "https://www.youtube.com"
        inject:
          header: Authorization
          prefix: "SAPISIDHASH "
```

---

## Runtime Execution Order

Runtime 通过 L2 primitives 处理请求时的执行顺序：

```
1. Resolve auth     -> extract token(s), inject into request
2. Resolve csrf     -> extract CSRF token, inject (mutations only)
3. Resolve signing  -> compute signature, inject into request
4. Execute HTTP request
5. Check response   -> if 401/403, refresh auth/csrf and retry (once)
6. Resolve pagination -> if more pages, goto 1 with cursor
```

- `mode: browser_fetch`: 步骤 1-4 在 `page.evaluate()` 内执行
- `mode: session_http`: 步骤 1-2 在浏览器中执行，步骤 4 通过 HTTP client
- `mode: direct_http`: 仅使用预提取的 tokens（无浏览器）

---

## Pattern Detection Signals（供 Compiler 使用）

Compiler 在 capture 期间观察以下信号来自动检测 L2 patterns：

| 信号 | 检测到的 Pattern |
|---|---|
| `credentials: 'include'` + HttpOnly cookies | `auth: cookie_session` |
| `Authorization: Bearer <JWT>` 且 JWT 在 localStorage 中找到 | `auth: localStorage_jwt` |
| `Authorization: Bearer <token>` 且 token 在 sessionStorage 中找到 | `auth: sessionStorage_token` |
| Token 值匹配 `window.*` global | `auth: page_global` |
| `webpackChunk*` global + token 不在 storage/cookies 中 | `auth: webpack_module_walk` |
| `wss://` 连接 + HTTP 调用前的 auth frame | `auth: websocket_intercept` |
| Auth endpoint 在 data endpoints 之前被调用 | `auth: lazy_fetch` |
| 多个 auth endpoints 之间有 token 传递 | `auth: exchange_chain` |
| Header value = cookie value，header 名包含 `csrf` | `csrf: cookie_to_header` |
| HTML 中有 `<meta name="csrf-token">` | `csrf: meta_tag` |
| CSRF value 匹配 `window.*` path | `csrf: page_global` |
| Form 中有 `<input name="authenticity_token">` | `csrf: form_field` |
| `Authorization: SAPISIDHASH ...` pattern | `signing: sapisidhash` |
| Window 上有 `gapi.client` | `signing: gapi_proxy` |
| `__NEXT_DATA__` global | `extraction: ssr_next_data` |
| `__APOLLO_STATE__` global | `extraction: apollo_cache` |
| `<script type="application/json">` 含大 JSON | `extraction: script_json` |

---

## TypeScript Type Definitions

```typescript
// -- Inject --
interface Inject {
  header?: string;
  prefix?: string;
  query?: string;
  body_field?: string;
  body_merge?: boolean;
}

// -- Auth --
type AuthPrimitive =
  | { type: 'cookie_session' }
  | { type: 'localStorage_jwt'; key: string; path?: string; inject: Inject }
  | { type: 'sessionStorage_token'; key: string; path?: string; inject: Inject }
  | { type: 'sessionStorage_msal'; key_pattern: string; scope_filter?: string;
      token_field: string; inject: Inject }
  | { type: 'page_global'; expression: string; inject: Inject;
      values?: Array<{ expression: string; inject: Inject }> }
  | { type: 'webpack_module_walk'; chunk_global: string; module_test: string;
      call: string; inject: Inject }
  | { type: 'websocket_intercept'; frame_match: { field: string; value: string };
      extract: string; inject: Inject; timeout?: number }
  | { type: 'lazy_fetch'; endpoint: string; method?: string; headers?: Record<string, string>;
      extract: string; inject: Inject; cache?: boolean; refresh_on?: number[] }
  | { type: 'exchange_chain'; steps: ExchangeStep[]; refresh_before?: string;
      inject: Inject };

interface ExchangeStep {
  call: string;                    // "POST /path"
  headers?: Record<string, string>;
  body?: Record<string, string>;   // supports ${} templates
  extract: string;                 // JSON path in response
  as?: string;                     // name for later reference
  expires_field?: string;
}

// -- CSRF --
type CsrfPrimitive =
  | { type: 'cookie_to_header'; cookie: string; header: string }
  | { type: 'meta_tag'; name: string; header: string }
  | { type: 'page_global'; expression: string; inject: Inject }
  | { type: 'form_field'; fetch_url?: string; selector: string;
      attribute?: string; header?: string; body_field?: string }
  | { type: 'api_response'; endpoint: string; method?: string;
      extract: string; inject: Inject; cache?: boolean };

// -- Signing --
type SigningPrimitive =
  | { type: 'sapisidhash'; cookie?: string; origin: string; inject: Inject }
  | { type: 'gapi_proxy'; api_key: { source: string; expression: string };
      authuser?: { source: string; expression: string } }
  | { type: 'aws_sigv4'; credentials: Record<string, string>;
      region: string; service: string };

// -- Pagination --
type PaginationPrimitive =
  | { type: 'cursor'; response_field: string; request_param: string;
      has_more_field?: string }
  | { type: 'offset_limit'; offset_param?: string; limit_param?: string;
      total_field?: string; default_limit?: number }
  | { type: 'link_header'; rel?: string }
  | { type: 'page_number'; param?: string; starts_at?: number;
      total_pages_field?: string };

// -- Extraction --
type ExtractionPrimitive =
  | { type: 'ssr_next_data'; page_url?: string; path: string }
  | { type: 'ssr_nuxt'; path: string; payload_url?: string }
  | { type: 'apollo_cache'; source?: string; key_pattern: string;
      fields?: string[] }
  | { type: 'html_selector'; page_url?: string;
      selectors: Record<string, string>; attribute?: string;
      multiple?: boolean }
  | { type: 'script_json'; selector: string; path?: string }
  | { type: 'page_global_data'; expression: string; path?: string };

// -- x-openweb server-level --
interface XOpenWebServer {
  mode: 'direct_http' | 'session_http' | 'browser_fetch';
  auth?: AuthPrimitive;
  csrf?: CsrfPrimitive & { scope?: string[] };
  signing?: SigningPrimitive;
}

// -- x-openweb operation-level --
interface XOpenWebOperation {
  csrf?: CsrfPrimitive & { scope?: string[] };  // override server-level
  pagination?: PaginationPrimitive;
  extraction?: ExtractionPrimitive;
}
```

---

## Pattern 数量统计

| 分类 | 类型数 | 覆盖率 |
|---|---|---|
| Auth | 9 types | 约 90% 认证网站 |
| CSRF | 5 types | 约 95% 有 CSRF 保护的网站 |
| Signing | 3 types | 约 80% 有签名需求的网站 |
| Pagination | 4 types | 约 95% 有分页的 API |
| Extraction | 6 types | 约 85% SSR/non-API 网站 |
| **总计** | **27 types** | **约 90% 所有网站** |

剩余约 10% 需要 L3 code adapters (WhatsApp, Telegram, OnlyFans, TikTok signing, 混淆的 webpack modules)。

---

## 交叉引用

- **Compiler pipeline** -> [compiler-pipeline.md](../compiler-pipeline.md): 信号如何被检测、patterns 如何被 emit
- **Runtime executor** -> [runtime-executor.md](../runtime-executor.md): primitives 在请求时如何执行
- **Pattern library** -> [pattern-library.md](../pattern-library.md): 网站到 primitives 的完整映射
- **L3 code adapters** -> [layer3-code-adapters.md](../layer3-code-adapters.md): L2 无法表达时的 escape hatch
- **Gap matrix** -> [gap-coverage-matrix.md](../gap-coverage-matrix.md): 每个 design gap 如何映射到 L2 primitives
