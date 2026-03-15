# Compiler Pipeline v2 (中文概要)

> **状态**: COMPLETE
> **继承自**: v1 (`archive/v1/architecture-pipeline.md`)
> **覆盖**: 所有 12 个 design gaps (capture + detection + emission)

## 概述

Compiler 将观察到的网站行为转换为三层 skill package。

```
Agent 通过 Playwright CLI 浏览
        |
        v
Phase 1: Capture -------- multi-source 录制 (HTTP + WS + state + DOM)
        |
        v
Phase 2: Analyze -------- clustering, parameter differentiation, schema induction
        |
        v
Phase 3: Pattern Match -- 检测 L2 primitives, probe execution modes, 分类 L3
        |
        v
Phase 4: Emit ----------- OpenAPI 3.1 + x-openweb L2 + L3 adapter stubs
```

### v1 到 v2 的变化

| 方面 | v1 | v2 |
|---|---|---|
| Navigation | 内置 agent (~200 LOC) | 用户的 agent 通过 Playwright CLI 驱动 |
| Capture | 仅 HAR | HAR + JSONL (WebSocket) + state snapshots + DOM |
| Phase 3 | 仅 probe execution modes | Probe + 基于 L2 library 的 pattern match |
| Emission | OpenAPI + `x-openweb.session` | OpenAPI + 完整 L2 primitives + L3 stubs |
| WebSocket | 不支持 | AsyncAPI 3.x + JSONL capture |

---

## Phase 1: Capture

**目标**: 在 agent 浏览时录制所有可观察的网站行为。

**触发**: `openweb capture start --cdp-endpoint http://localhost:9222`

OpenWeb 通过 Playwright SDK `connectOverCDP()` 连接 agent 的浏览器。Agent 继续通过 Playwright CLI 浏览。两者共享同一个 Chrome 实例。详见 [browser-integration.md](../browser-integration.md)。

### 四个 Capture Source

**1. HTTP Traffic** -- 标准 HAR via Playwright `recordHar`:

```typescript
const context = browser.contexts()[0];
await context.routeFromHAR('capture/traffic.har', { update: true });
// Or: page.on('request', ...) + page.on('response', ...)
```

应用 v1 的三层 traffic filtering：
- Domain blocklist (analytics, ads, tracking -- 约 40 个域名)
- Content-type filter (保留 JSON, form-encoded; 跳过 images, CSS, fonts)
- Path noise filter (跳过 `/_next/static/*`, `/hot-update.*`, `/health`)

**2. WebSocket Frames** -- CDP `Network.webSocketFrame*` events:

```typescript
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');

cdp.on('Network.webSocketCreated', (e) => log({ type: 'open', ...e }));
cdp.on('Network.webSocketFrameSent', (e) => log({ type: 'frame', direction: 'sent', ...e }));
cdp.on('Network.webSocketFrameReceived', (e) => log({ type: 'frame', direction: 'received', ...e }));
cdp.on('Network.webSocketClosed', (e) => log({ type: 'close', ...e }));
```

JSONL 格式 (`websocket_frames.jsonl`):
```jsonl
{"connectionId":"ws1","timestamp":"...","type":"open","url":"wss://gateway.discord.gg/?v=10"}
{"connectionId":"ws1","timestamp":"...","type":"frame","direction":"sent","opcode":1,"payload":"{\"op\":2,\"d\":{\"token\":\"...\"}}"}
{"connectionId":"ws1","timestamp":"...","type":"frame","direction":"received","opcode":1,"payload":"{\"op\":0,\"d\":{\"guilds\":[...]}}"}
{"connectionId":"ws1","timestamp":"...","type":"close","code":1000}
```

**3. Browser State Snapshots** -- 在 capture 开始和每次 navigation 后抓取：

```typescript
const snapshot = {
  timestamp: new Date().toISOString(),
  trigger: 'navigation',  // or 'initial', 'manual'
  url: page.url(),
  localStorage: await page.evaluate(() => ({ ...localStorage })),
  sessionStorage: await page.evaluate(() => ({ ...sessionStorage })),
  cookies: await context.cookies(),
  globals: await page.evaluate(() => {
    const known = [
      '__NEXT_DATA__', '__NUXT__', '__APOLLO_STATE__', '__APOLLO_CLIENT__',
      'ytcfg', '__context__', '__initialData', 'PRELOADED',
      'netflix', 'StackExchange', 'initData', 'bootstrap',
      'POSTHOG_APP_CONTEXT', '__nr', 'gon', 'WIZ_global_data',
    ];
    const found: Record<string, unknown> = {};
    for (const k of known) {
      try { if ((window as any)[k]) found[k] = (window as any)[k]; } catch {}
    }
    return found;
  }),
};
```

**4. DOM Extractions** -- SSR 数据、meta tags、hidden inputs:

```typescript
const domData = await page.evaluate(() => ({
  metaTags: Array.from(document.querySelectorAll('meta[name]')).map(m => ({
    name: m.getAttribute('name'),
    content: m.getAttribute('content'),
  })),
  scriptJsonTags: Array.from(
    document.querySelectorAll('script[type="application/json"]')
  ).map(s => ({
    id: s.id,
    dataTarget: s.getAttribute('data-target'),
    length: s.textContent?.length ?? 0,
  })),
  hiddenInputs: Array.from(
    document.querySelectorAll('input[type="hidden"]')
  ).map(i => ({
    name: i.getAttribute('name'),
    formAction: i.closest('form')?.getAttribute('action'),
  })),
  webpackChunks: Object.keys(window).filter(k => k.startsWith('webpackChunk')),
  gapiAvailable: typeof (window as any).gapi?.client?.request === 'function',
}));
```

### Capture 输出目录

```
capture/
├── traffic.har                 # HTTP requests/responses (filtered)
├── websocket_frames.jsonl      # WebSocket frame log
├── state_snapshots/
│   ├── 001_initial.json        # { localStorage, sessionStorage, cookies, globals }
│   ├── 002_after_login.json
│   └── 003_after_search.json
├── dom_extractions/
│   ├── 001_initial.json        # { metaTags, scriptJsonTags, hiddenInputs, ... }
│   └── 002_after_login.json
└── metadata.json               # { siteUrl, startTime, endTime, pageCount }
```

### Variance Generation

Agent 应对每个 flow 用 2-3 组不同输入执行，以便 Phase 2 进行 parameter differentiation：

```
Flow: 搜索产品
  Run 1: search("laptop")       -> 录制 traffic
  Run 2: search("headphones")   -> 录制 traffic
  -> Phase 2 对比请求，找出哪些字段是 user_input vs constant
```

对于认证网站，在 login 前后都抓取 state，以区分 session tokens 和静态配置。

---

## Phase 2: Analyze & Extract

**目标**: 将原始 capture bundle 转换为规范的 API map -- 参数化的 endpoint templates + 推断的 schemas。

核心算法**继承自 v1**，四个子步骤：

### Step A: Endpoint Clustering

按 `(HTTP method, URL path pattern, Content-Type)` 分组请求。

**URL 规范化** -- 用 `{param}` 替换可变 path segments:
```typescript
const PARAM_PATTERNS = [
  { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, name: 'id' },
  { pattern: /^\d{3,}$/, name: 'id' },
  { pattern: /^[0-9a-f]{8,}$/i, name: 'hash' },
  { pattern: /^[A-Za-z0-9+/=]{16,}$/, name: 'token' },
  { pattern: /^\d{4}-\d{2}-\d{2}/, name: 'date' },
];
```

**GraphQL 一等支持**: 按 `operationName` 分组，而非 URL path。支持 `extensions.persistedQuery.sha256Hash`。

**v2 新增 -- WebSocket message clustering:**
按 `(connectionUrl, opcode/messageType)` 分组 WebSocket frames。对 JSON payloads，按顶层 `type` 或 `op` 字段分组。

### Step B: Parameter Differentiation

对 clustered endpoints 中的每个可变字段进行分类：

| 分类 | 信号 | 示例 |
|---|---|---|
| user_input | 跨 run 自由变化 | `q=laptop` |
| pagination | 单调递增序列值 | `cursor=eyJ...` |
| session_token | 同一 session 内相同，跨 session 不同 | `Authorization: Bearer ...` |
| csrf_nonce | 每个请求都变化 | `X-CSRFToken: a8f3...` |
| derived | Hash/timestamp，非用户控制 | `_t=1708900000` |
| constant | 始终相同 | `format=json` |

**v2 新增 -- Browser state correlation:**

交叉引用 HTTP header 值与抓取到的 browser state：

```typescript
function correlateTokenSources(
  request: HarRequest,
  stateSnapshot: StateSnapshot,
): TokenCorrelation[] {
  const correlations: TokenCorrelation[] = [];
  const authHeader = request.headers.find(h => h.name === 'Authorization');

  if (authHeader) {
    const token = authHeader.value.replace(/^Bearer\s+/, '');
    // Check localStorage
    for (const [key, value] of Object.entries(stateSnapshot.localStorage)) {
      if (containsToken(value, token)) {
        correlations.push({
          header: 'Authorization',
          source: 'localStorage',
          key,
          path: findJsonPath(value, token),
        });
      }
    }
    // Check sessionStorage, cookies, page globals (same pattern)
  }
  return correlations;
}
```

这个 correlation 是 Phase 3 pattern matching 的关键输入。当发现 `Authorization: Bearer xxx` 来自 `localStorage['BSKY_STORAGE'].session.accessJwt` 时，就知道应 emit `auth: { type: localStorage_jwt, key: 'BSKY_STORAGE', path: '...' }`。

### Step C: Schema Induction

用 `quicktype-core` 将观察到的 JSON 样本合并为统一的 JSON Schema。LLM 生成可读的字段描述。**继承自 v1，无变化。**

### Step D: Dependency Graph

通过字段名匹配映射 endpoint 间的数据流。**继承自 v1，无变化。**

---

## Phase 3: Probe & Pattern Match

**目标**: 确定每个 endpoint 的 execution mode **并** 检测 L2 interaction primitives。这是 **v2 的关键创新** -- v1 仅 probe execution modes。

### Step A: Execution Mode Probing (继承自 v1)

先尝试最便宜的 mode，失败后升级：
`direct_http` -> `session_http` -> `browser_fetch`

仅对 read endpoints (GET)。Write endpoints 默认 `browser_fetch`。每 endpoint 最多 6 个请求，首次成功即停止。

### Step B: L2 Pattern Detection (v2 新增)

利用 capture bundle + Phase 2 correlations 检测适用的 L2 primitives。

**Auth Pattern Detection:**

| 检测逻辑 | Emitted Primitive |
|---|---|
| Token 在 `localStorage[key].path` 中找到 -> `Authorization` header | `localStorage_jwt` |
| Token 在 `sessionStorage[key]` 中找到 -> `Authorization` header | `sessionStorage_token` |
| sessionStorage keys 匹配 `msal.token.keys.*` | `sessionStorage_msal` |
| Token 在 `window.global.path` 中找到 -> header/query | `page_global` |
| 检测到 `webpackChunk*` globals + token 不在 storage/cookies 中 | `webpack_module_walk` (标记人工配置) |
| `wss://` frames 含 auth token 早于 HTTP 调用 | `websocket_intercept` |
| Auth endpoint 在 data calls 之前被调用 | `lazy_fetch` |
| 多个 auth endpoints 之间有 token 传递 | `exchange_chain` (标记人工配置) |
| 仅 HttpOnly cookies，无提取的 tokens | `cookie_session` |

**CSRF Pattern Detection:**

| 检测逻辑 | Emitted Primitive |
|---|---|
| Non-HttpOnly cookie 值出现为 mutation 请求的自定义 header | `cookie_to_header` |
| DOM extractions 中有 `<meta name="csrf-token">` | `meta_tag` |
| `window.global.path` 值出现为 mutation 请求的 header/body field | `page_global` |
| Hidden inputs 中有 `<input name="authenticity_token">` | `form_field` |
| API response 中的 token 被用于后续 mutation headers/body | `api_response` |

**Signing Pattern Detection:**

| 检测逻辑 | Emitted Primitive |
|---|---|
| `Authorization` 匹配 `SAPISIDHASH \d+_[0-9a-f]{40}` | `sapisidhash` |
| Window 上有 `gapi.client` | `gapi_proxy` |
| AWS 风格 Authorization header 带 `AWS4-HMAC-SHA256` | `aws_sigv4` |
| Header 值每请求变化 + 页面 JS 中有 crypto 函数 | 标记为 L3 |

**Extraction Pattern Detection:**

| 检测逻辑 | Emitted Primitive |
|---|---|
| 抓取的 globals 中有 `__NEXT_DATA__` | `ssr_next_data` |
| 抓取的 globals 中有 `__NUXT__` | `ssr_nuxt` |
| Globals 中有 `__APOLLO_STATE__` 或 `__APOLLO_CLIENT__` | `apollo_cache` |
| DOM 中有 `<script type="application/json">` 含大 payload | `script_json` |
| 无 API 调用但 window globals 中有结构化数据 | `page_global_data` |
| 无 API 调用、无 globals，仅有结构化 HTML 内容 | `html_selector` |

**Pagination Pattern Detection:**

| 检测逻辑 | Emitted Primitive |
|---|---|
| Response 含 `Link` header 带 `rel="next"` | `link_header` |
| Response field 出现为同一 endpoint 下一请求的 query param | `cursor` |
| 请求间 `offset`/`page` param 值递增 | `offset_limit` 或 `page_number` |

### Step C: Confidence & Manual Flagging

每个检测到的 pattern 会得到一个 confidence score：

| Confidence | 含义 | 动作 |
|---|---|---|
| **high** (>0.9) | 精确匹配：storage 中的 token 值 -> header | 自动 emit primitive |
| **medium** (0.6-0.9) | 可能匹配：pattern 检测到但无法完全验证 | Emit 并加 `# TODO: verify` 注释 |
| **low** (<0.6) | 仅启发式：有信号但无具体 correlation | 标记人工 review |

**自动检测** (high confidence, 已通过 OpenTabs plugins 验证):

| Pattern | 检测方式 | 验证 Plugin |
|---|---|---|
| `localStorage_jwt` | localStorage 中的 token 匹配 Authorization header | Bluesky, Linear, Robinhood |
| `cookie_to_header` | Cookie value = mutation 请求的自定义 header value | Instagram, LeetCode, Sentry |
| `meta_tag` CSRF | DOM 中有 `<meta name="csrf-token">` | GitHub, Calendly |
| `cookie_session` | HttpOnly cookies，无提取的 tokens | Claude, Coinbase, Fidelity |
| `sapisidhash` | Authorization header pattern 匹配 | YouTube |
| `ssr_next_data` | Globals 中有 `__NEXT_DATA__` | Zillow, Walmart |
| `link_header` | Response 中有 `Link` header | Sentry |
| `cursor` pagination | Response field -> 下一请求 param | Bluesky, Discord |

**需人工配置** (low confidence, 复杂 patterns):

| Pattern | 自动检测不足的原因 |
|---|---|
| `webpack_module_walk` | 能检测 `webpackChunk*` globals，但无法确定 `module_test`/`call` |
| `exchange_chain` | 能检测多步 auth flows，但无法推断 step 序列 |
| `websocket_intercept` | 能检测 WS auth frames，但 frame_match config 需手动指定 |
| `gapi_proxy` | 能检测 `gapi.client`，但 api_key source path 各站不同 |
| `form_field` CSRF | 能检测 hidden inputs，但无法确定该 fetch 哪个 form/URL |

### Step D: Risk Classification

基于规则的确定性分类，**继承自 v1 无变化**：

| 条件 | Risk Tier |
|---|---|
| Auth paths (`/login`, `/oauth`, `/token`) | critical |
| Payment paths (`payment`, `checkout`, `billing`) | critical |
| HTTP DELETE 或 destructive paths | high |
| POST/PUT/PATCH 含 PII | high |
| POST/PUT/PATCH (无 PII) | medium |
| GET 且 response 含 PII | low |
| 其他 | safe |

---

## Phase 4: Emit Three-Layer Package

**目标**: 生成可部署的 skill package -- L1 + L2 + L3 artifacts。

### L1: OpenAPI 3.1 + AsyncAPI 3.x

标准 spec 生成：

```yaml
# openapi.yaml
openapi: 3.1.0
info:
  title: Bluesky XRPC API
  version: "1.0"
  x-openweb:
    spec_version: "2.0"
    compiled_at: "2026-03-15T10:00:00Z"
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
      summary: Get the authenticated user's timeline
      x-openweb:
        risk_tier: safe
        stable_id: "a1b2c3d4"
        tool_version: 1
        verified: true
        pagination:
          type: cursor
          response_field: cursor
          request_param: cursor
      parameters:
        - name: limit
          in: query
          schema: { type: integer, default: 50 }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                type: object
                properties:
                  cursor: { type: string }
                  feed: { type: array, items: { $ref: '#/components/schemas/FeedItem' } }
```

有 WebSocket API 的网站还需 emit AsyncAPI 3.x：

```yaml
# asyncapi.yaml (Discord example)
asyncapi: 3.0.0
info:
  title: Discord Gateway API
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
    messages:
      dispatch:
        payload:
          type: object
          properties:
            op: { type: integer, const: 0 }
            t: { type: string }
            d: { type: object }
```

### L2: Primitive Configs in x-openweb

L2 primitives 作为 `x-openweb` extensions emit 在相应级别：
- Server-level: `auth`, `csrf`, `signing`
- Operation-level: `pagination`, `extraction`

### L3: Code Adapter Stubs

对于分类为 L3 的 endpoints，emit adapter stub 文件：

```typescript
// adapters/onlyfans-signing.ts
import type { CodeAdapter } from '@openweb/runtime';

export default {
  name: 'onlyfans-signing',
  description: 'Request signing via webpack module 977434',
  // TODO: Implement -- extract signing function from webpack bundle
  async execute(page, request) {
    throw new Error('Not implemented -- requires manual adapter code');
  },
} satisfies CodeAdapter;
```

### Package 目录结构

```
bluesky/
├── manifest.json           # metadata, fingerprint, dependencies
├── openapi.yaml            # L1 + L2 (x-openweb extensions)
├── asyncapi.yaml           # L1 WebSocket/SSE (if applicable)
├── adapters/               # L3 code adapters (if applicable)
│   └── *.ts
└── tests/
    └── smoke.test.ts       # per-tool regression tests
```

### Fingerprinting

通过 composite hash 检测网站变化：

```typescript
interface SiteFingerprint {
  js_bundle_hash: string;        // SHA256 of main JS bundle URLs
  api_endpoint_set_hash: string; // SHA256 of sorted endpoint list
  response_shape_hash: string;   // SHA256 of response schema set
  last_validated: string;        // ISO timestamp
}
```

存储在 `manifest.json` 中。当 fingerprint 变化时，compiler 标记该 skill 需要 recompilation。

---

## Pipeline 示例: Instagram

展示四个 phase 如何端到端处理 Instagram。

**Phase 1 Capture** -- Agent 登录、浏览 feed、点赞一个 post:
- `traffic.har`: 47 个 `/api/v1/*` API 调用（filtering 后）
- `state_snapshots/001_initial.json`: `csrftoken` cookie 存在
- `dom_extractions/001.json`: 无 meta CSRF tags，无 SSR globals

**Phase 2 Analyze**:
- Cluster: 12 个 endpoint templates (`/api/v1/feed/timeline/`, `/api/v1/media/{id}/like/` 等)
- Parameter diff: `csrftoken` cookie value = `X-CSRFToken` header value -> 分类为 `csrf_nonce`
- Schema: 通过 quicktype 推断 response schemas

**Phase 3 Pattern Match**:
- Auth: 仅 HttpOnly cookies -> `cookie_session` (high confidence)
- CSRF: `csrftoken` cookie 值匹配 `X-CSRFToken` header -> `cookie_to_header` (high confidence)
- 附加 headers: `X-IG-App-ID: 936619743392459` constant -> emit 为 default header
- Mode: `session_http` (需要 cookies，API 调用不需要 browser JS)

**Phase 4 Emit**:
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
paths:
  /feed/timeline/:
    get:
      operationId: getTimeline
      x-openweb:
        risk_tier: safe
        pagination:
          type: cursor
          response_field: next_max_id
          request_param: max_id
  /media/{media_id}/like/:
    post:
      operationId: likeMedia
      x-openweb:
        risk_tier: medium
```

---

## Pipeline 示例: Discord

**Phase 1 Capture**:
- `traffic.har`: 23 个 `/api/v9/*` API 调用
- `websocket_frames.jsonl`: 150+ frames on `wss://gateway.discord.gg`
- `state_snapshots/001.json`: localStorage/sessionStorage 中无 auth tokens
- `dom_extractions/001.json`: 检测到 window 上的 `webpackChunkdiscord_app`

**Phase 3 Pattern Match**:
- Auth: Token 不在 storage/cookies 中。`webpackChunkdiscord_app` 存在。
  -> `webpack_module_walk` (medium confidence, 需手动配置 `module_test`/`call`)
- 无 CSRF，无 signing
- WebSocket: 检测到 auth frame (`{"method":"auth","token":"..."}`)

**Phase 4 Emit**:
```yaml
# openapi.yaml
servers:
  - url: https://discord.com/api/v9
    x-openweb:
      mode: browser_fetch
      auth:
        type: webpack_module_walk
        chunk_global: webpackChunkdiscord_app
        module_test: "typeof exports.getToken === 'function'"  # TODO: verify
        call: "exports.getToken()"
        inject:
          header: Authorization
```
```yaml
# asyncapi.yaml
asyncapi: 3.0.0
info:
  title: Discord Gateway
channels:
  gateway:
    address: wss://gateway.discord.gg/?v=10
```

---

## 交叉引用

- **Capture 架构** -> [browser-integration.md](../browser-integration.md)
- **L2 primitive schemas** -> [layer2-interaction-primitives.md](../layer2-interaction-primitives.md)
- **L3 adapter interface** -> [layer3-code-adapters.md](../layer3-code-adapters.md)
- **Plugin 分类** -> [pattern-library.md](../pattern-library.md)
- **Runtime execution** -> [runtime-executor.md](../runtime-executor.md)
- **Package 格式** -> [skill-package-format.md](../skill-package-format.md)
