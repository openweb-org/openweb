# Layer 2: Interaction Primitives — Pattern DSL

> **Status**: DRAFT
> **Addresses**: Gaps 001–006, 008–010, 012
> **Principle**: Structure is the default, code is the exception.

## Overview

Layer 2 is a vocabulary of **parameterized patterns** that describe how websites
protect and structure their APIs. Each pattern is a discriminated union by `type`
with a fixed schema. The runtime has a handler per type. New patterns = new handlers
\+ new schema entries. Anything not expressible as an L2 pattern falls to L3 code adapters.

**Coverage target**: L1 (OpenAPI) + L2 (primitives) handle ~90% of sites.
L3 code adapters handle the remaining ~10%.

## Architecture

### Where Primitives Live

L2 primitives are embedded in the OpenAPI spec via `x-openweb` extensions:

- **Server-level** (`servers[].x-openweb`): auth, csrf, signing — shared by all
  operations under that server.
- **Operation-level** (`paths[].{method}.x-openweb`): pagination, extraction —
  per-endpoint behavior.

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

### Five Categories

| Category | Level | Purpose | Applied when |
|---|---|---|---|
| **auth** | server | Authenticate requests | Every request |
| **csrf** | server | Anti-CSRF token handling | Mutation methods (POST/PUT/DELETE/PATCH) |
| **signing** | server | Per-request cryptographic signatures | Every request (or scoped) |
| **pagination** | operation | Page through result sets | Client requests next page |
| **extraction** | operation | Get data from non-API sources (SSR, DOM) | When no REST/GraphQL API exists |

### Inject Model

Every primitive that produces a value uses `inject` to place it into the request:

```typescript
interface Inject {
  header?: string;      // Header name (e.g., "Authorization")
  prefix?: string;      // Value prefix (e.g., "Bearer ")
  query?: string;       // Query parameter name
  body_field?: string;  // Body field name (dot path for nested: "data._csrf")
  body_merge?: boolean; // Merge entire extracted object into request body
}
```

Multiple targets can coexist. Example — Reddit's modhash goes to both header and body:

```yaml
inject:
  header: X-Modhash
  body_field: uh
```

### Template Expressions

String values support `${source:key}` template syntax for cross-referencing:

| Template | Resolves to |
|---|---|
| `${cookie:name}` | Value of cookie `name` |
| `${localStorage:key}` | Value of localStorage key |
| `${response:field.path}` | Field from a previous step's response |
| `${env:VAR}` | Environment variable |

Example — Costco's sessionStorage key depends on a cookie:

```yaml
key: "authToken_${cookie:hashedUserId}"
```

---

## Auth Primitives

How tokens are obtained and injected into requests. Each site's `auth` config
is a single primitive (discriminated by `type`).

### `cookie_session`

Pure cookie-based auth. The browser sends cookies automatically via
`credentials: 'include'`. No token extraction needed.

**Schema:**
```yaml
auth:
  type: cookie_session
```

**Sites**: ~40% of all sites. Instagram (session + CSRF), GitHub (session + CSRF),
LeetCode, Sentry, Reddit (GET requests).

**Runtime**: Set `credentials: 'include'` on fetch. No other action.

**Detection**: HttpOnly session cookies present. API calls succeed with cookies alone.

---

### `localStorage_jwt`

JWT or token stored in localStorage under a known key, optionally nested in JSON.

**Schema:**
```yaml
auth:
  type: localStorage_jwt
  key: string            # localStorage key name
  path: string?          # JSON path within the parsed value (dot notation)
  inject: Inject         # where to put the token
```

**Example — Bluesky** (Gap 002):
```yaml
auth:
  type: localStorage_jwt
  key: BSKY_STORAGE
  path: session.currentAccount.accessJwt
  inject:
    header: Authorization
    prefix: "Bearer "
```

**Example — Linear:**
```yaml
auth:
  type: localStorage_jwt
  key: ApplicationStore
  path: currentUserAccountId
  inject:
    header: Authorization
    prefix: "Bearer "
```

**Sites**: Bluesky, ClickUp (`cuHandshake`), Robinhood (`web:auth_state.access_token`),
Linear, Auth0-protected sites (`@@auth0spajs@@::*`).

**Runtime**: `JSON.parse(localStorage.getItem(key))`, walk `path`, inject value.
Requires browser context (`mode: session_http` or `browser_fetch`).

**Detection**: localStorage keys matching `auth|token|session|jwt|MSAL|auth0`.
Bearer format in captured Authorization headers (3-part base64 JWT).

---

### `sessionStorage_token`

Token stored in sessionStorage. Key may be static or templated.

**Schema:**
```yaml
auth:
  type: sessionStorage_token
  key: string            # sessionStorage key (supports ${} templates)
  path: string?          # JSON path within value
  inject: Inject
```

**Example — Costco** (Gaps 002, 012):
```yaml
auth:
  type: sessionStorage_token
  key: "authToken_${cookie:hashedUserId}"
  inject:
    header: Authorization
    prefix: "Bearer "
```

**Sites**: Costco, Azure (MSAL tokens).

**Runtime**: Resolve key template, `JSON.parse(sessionStorage.getItem(key))`,
walk path, inject.

---

### `sessionStorage_msal`

Specialized pattern for Microsoft MSAL token cache in sessionStorage.
Keys are dynamic (`msal.token.keys.*`) and must be scanned by pattern + scope.

**Schema:**
```yaml
auth:
  type: sessionStorage_msal
  key_pattern: string    # glob pattern for sessionStorage keys
  scope_filter: string?  # OAuth scope to match (e.g., "user.read")
  token_field: string    # field in matched entry (e.g., "secret")
  inject: Inject
```

**Example — Excel Online** (Gap 002):
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

**Sites**: OneNote, PowerPoint Online, Excel Online, Azure Portal, Teams.

**Runtime**: Scan sessionStorage keys matching pattern. Parse each as JSON.
Find entry whose `scopes` contains `scope_filter`. Extract `token_field`.

**Detection**: sessionStorage keys matching `msal.*`.

---

### `page_global`

Token or value extracted from `window.*` globals set by the application's
JavaScript during page initialization.

**Schema:**
```yaml
auth:
  type: page_global
  expression: string     # dot path from window (e.g., "netflix.reactContext...")
  inject: Inject
  # For sites needing multiple values from globals:
  values:                # optional array of additional extractions
    - expression: string
      inject: Inject
```

When both `expression`/`inject` and `values` are present, `expression`/`inject`
is the primary extraction and `values` are additional.

**Example — Netflix** (Gap 002):
```yaml
auth:
  type: page_global
  expression: "netflix.reactContext.models.memberContext.data.userInfo.authURL"
  inject:
    query: authURL
```

**Example — YouTube** (needs API key + session index from globals):
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

**Sites**: Netflix, npm (`__context__.context.user`), Sentry (`__initialData`),
PostHog (`POSTHOG_APP_CONTEXT`), YouTube (`ytcfg.data_`), New Relic, Stripe.

**Runtime**: `page.evaluate(() => window.{expression})` for each extraction. Inject.

**Detection**: Window globals matching `__context__|__initialData|reactContext|
POSTHOG_|ytcfg|__nr|bootstrap`.

---

### `webpack_module_walk`

Token extracted by iterating webpack's internal module cache and calling an
export function. Used when tokens are hidden inside bundled modules with no
global exposure.

**Schema:**
```yaml
auth:
  type: webpack_module_walk
  chunk_global: string   # webpack chunk array name on window
  module_test: string    # JS expression to identify the right module
  call: string           # function to call on the matched module
  inject: Inject
```

**Example — Discord** (Gap 002):
```yaml
auth:
  type: webpack_module_walk
  chunk_global: webpackChunkdiscord_app
  module_test: "typeof exports.getToken === 'function' && typeof exports.getToken() === 'string'"
  call: "exports.getToken()"
  inject:
    header: Authorization
```

**Sites**: Discord, X/Twitter (feature flags + tokens).

**Runtime**: Push a loader module into the chunk array. Iterate `require.c`,
evaluate `module_test` on each module's exports. Call `call` on match.

**Detection**: `webpackChunk*` globals on window. Token not found in
localStorage/sessionStorage/cookies.

**Security**: Module code runs in page context (same as L3). The module_test and
call fields are evaluated via `page.evaluate()`.

---

### `websocket_intercept`

Token captured from a WebSocket frame by patching `WebSocket.prototype.send`.
Used when the application sends auth credentials over WebSocket before
making HTTP API calls.

**Schema:**
```yaml
auth:
  type: websocket_intercept
  frame_match:           # fields to match in parsed JSON frame
    field: string        # JSON field name
    value: string        # expected value
  extract: string        # field to extract from matched frame
  inject: Inject
  timeout: number?       # ms to wait for matching frame (default: 15000)
```

**Example — ClickUp** (Gap 003):
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

**Sites**: ClickUp.

**Runtime**: Patch `WebSocket.prototype.send` at page load. Parse each sent frame
as JSON. When frame matches, store extracted value. Unpatch after extraction.

**Detection**: `wss://` connections in network traffic. Auth token not found in
storage/cookies/globals.

---

### `lazy_fetch`

Token fetched on-demand from an auth endpoint. Not present in browser storage
at page load — must be actively requested.

**Schema:**
```yaml
auth:
  type: lazy_fetch
  endpoint: string       # URL or path to call
  method: string?        # HTTP method (default: GET)
  headers: object?       # additional headers for the auth call
  extract: string        # JSON path in response to extract token
  inject: Inject
  cache: boolean?        # cache token across requests (default: true)
  refresh_on: number[]?  # HTTP status codes that trigger re-fetch (default: [401, 403])
```

**Example — ChatGPT** (Gap 008):
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

**Sites**: ChatGPT, Claude (similar pattern).

**Runtime**: On first API call (or after refresh trigger), call endpoint with
current session cookies. Extract token from response. Cache. Inject into
subsequent requests. On 401/403, clear cache and re-fetch.

**Detection**: `/api/auth/`, `/oauth/token`, `/session` calls in HAR before
data API calls. Token not present in storage at page load.

---

### `exchange_chain`

Multi-step token exchange where each step's output feeds the next. Used for
enterprise auth flows where a primary credential is exchanged for a secondary
token via intermediate API calls.

**Schema:**
```yaml
auth:
  type: exchange_chain
  steps:
    - call: string           # HTTP method + URL (e.g., "POST /svc/shreddit/token")
      headers: object?       # headers for this step
      body: object?          # body (supports ${} templates)
      extract: string        # JSON path to extract from response
      as: string?            # name to reference in later steps (default: "token")
      expires_field: string? # JSON path to expiration time in response
  refresh_before: string?    # duration before expiry to trigger refresh (e.g., "30s")
  inject: Inject             # where to put the final token
```

**Example — Reddit OAuth** (Gap 008):
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

**Example — Microsoft Teams** (Gap 008):
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

**Sites**: Reddit (cookie → bearer), Teams (MSAL → Skype JWT), AWS Console
(STS credentials refresh).

**Runtime**: Execute steps sequentially. Each step can reference previous steps
via `${response:field}` or named `as` references. Cache final token. Refresh
proactively based on `refresh_before` or reactively on 401.

**Detection**: Multiple auth-related calls in HAR with token passing between them.
Different tokens used for different API domains.

---

## CSRF Primitives

How CSRF tokens are extracted and injected. Applied only to mutation methods
(POST, PUT, DELETE, PATCH) by default.

**Common fields:**
```yaml
csrf:
  type: ...
  scope: string[]?  # HTTP methods requiring CSRF (default: [POST, PUT, DELETE, PATCH])
```

### `cookie_to_header`

Read a non-HttpOnly cookie and inject its value as a custom header.
The most common CSRF pattern.

**Schema:**
```yaml
csrf:
  type: cookie_to_header
  cookie: string       # cookie name to read
  header: string       # header name to inject
```

**Example — Instagram** (Gap 005):
```yaml
csrf:
  type: cookie_to_header
  cookie: csrftoken
  header: X-CSRFToken
```

**Example — Sentry:**
```yaml
csrf:
  type: cookie_to_header
  cookie: sentry-sc
  header: X-CSRFToken
```

**Sites**: Instagram, LeetCode, Bitbucket, PostHog, Sentry.

**Runtime**: `document.cookie` → parse → find cookie → set header.

**Detection**: Non-HttpOnly cookie with name matching `csrf|xsrf|_token`.
Request header value equals cookie value.

---

### `meta_tag`

Extract CSRF token from `<meta>` tag in the HTML document.

**Schema:**
```yaml
csrf:
  type: meta_tag
  name: string         # <meta name="..."> attribute value
  header: string       # header name to inject
```

**Example — Calendly** (Gap 005):
```yaml
csrf:
  type: meta_tag
  name: csrf-token
  header: X-CSRF-Token
```

**Example — GitHub:**
```yaml
csrf:
  type: meta_tag
  name: csrf-token
  header: X-CSRF-Token
```

**Sites**: Calendly, GitHub (for some operations).

**Runtime**: `document.querySelector('meta[name="${name}"]').content` → set header.

**Detection**: `<meta name="csrf-token">` or `<meta name="_csrf">` in HTML.

---

### `page_global`

Extract CSRF token from a window global variable.

**Schema:**
```yaml
csrf:
  type: page_global
  expression: string   # dot path from window
  inject:
    header: string?    # inject as header
    body_field: string? # inject as body field
```

**Example — npm** (Gap 005):
```yaml
csrf:
  type: page_global
  expression: "__context__.context.csrftoken"
  inject:
    header: x-csrf-token
```

**Example — Airtable** (injects into body, not header):
```yaml
csrf:
  type: page_global
  expression: "initData.csrfToken"
  inject:
    body_field: _csrf
```

**Sites**: Airtable, npm, Stripe (`PRELOADED.csrf_token`), Cloudflare
(`bootstrap.atok`), MongoDB Atlas (`PARAMS.csrfToken`).

**Runtime**: `page.evaluate(() => window.{expression})` → inject.

**Detection**: Window globals containing `csrf|token|atok` in their path.

---

### `form_field`

Fetch a form page and extract CSRF token from a hidden input field.
Used when CSRF tokens are per-form, not per-session.

**Schema:**
```yaml
csrf:
  type: form_field
  fetch_url: string?       # URL to fetch (default: same as operation URL)
  selector: string         # CSS selector for the input element
  attribute: string?       # attribute to read (default: "value")
  header: string?          # inject as header
  body_field: string?      # inject as body field
```

**Example — GitHub form submissions** (Gap 005):
```yaml
csrf:
  type: form_field
  selector: 'input[name="authenticity_token"]'
  header: X-CSRF-Token
```

**Sites**: GitHub (form-based mutations).

**Runtime**: Fetch the form page (GET). Query DOM for selector. Extract attribute.
Inject into the actual mutation request.

**Detection**: Hidden inputs with `name="authenticity_token"` or `name="_token"`.

---

### `api_response`

Fetch CSRF token from an API endpoint's response. Used when the token is
not embedded in HTML but returned by a dedicated API call.

**Schema:**
```yaml
csrf:
  type: api_response
  endpoint: string     # URL to call for token
  method: string?      # HTTP method (default: GET)
  extract: string      # JSON path in response
  inject:
    header: string?
    body_field: string?
  cache: boolean?      # cache across requests (default: true)
```

**Example — Reddit modhash** (Gap 005, 008):
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

**Sites**: Reddit.

**Runtime**: Call endpoint with session cookies. Extract field. Cache. Inject.
Clear cache on 401/403.

**Detection**: Dedicated `/api/me`, `/api/csrf`, `/api/token` calls in HAR.

---

## Signing Primitives

Per-request cryptographic signatures or delegated request mechanisms.
Unlike auth (extract a stored value), signing **computes** a new value per request.

### `sapisidhash`

Google's SAPISID-based SHA-1 signing. Used across all Google web applications.

**Schema:**
```yaml
signing:
  type: sapisidhash
  cookie: string?      # cookie name (default: "SAPISID")
  origin: string       # origin URL for hash computation
  inject:
    header: string     # header name (default: "Authorization")
    prefix: string?    # value prefix (default: "SAPISIDHASH ")
```

**Algorithm**: `SAPISIDHASH ${timestamp}_${SHA1(timestamp + " " + SAPISID + " " + origin)}`

**Example — YouTube** (Gap 004, 010):
```yaml
signing:
  type: sapisidhash
  origin: "https://www.youtube.com"
  inject:
    header: Authorization
    prefix: "SAPISIDHASH "
```

**Sites**: YouTube, Google Analytics, Google Calendar, Google Drive, Google Cloud.

**Runtime**:
```typescript
const ts = Math.floor(Date.now() / 1000);
const hash = SHA1(`${ts} ${getCookie('SAPISID')} ${origin}`);
setHeader(inject.header, `${inject.prefix}${ts}_${hash}`);
```

**Detection**: Authorization header matching `SAPISIDHASH \d+_[0-9a-f]{40}`.
SAPISID cookie present.

---

### `gapi_proxy`

Delegate entire request through Google's `gapi.client.request()` library.
The library handles SAPISIDHASH internally. Used when direct HTTP calls would
require reimplementing Google's auth stack.

**Schema:**
```yaml
signing:
  type: gapi_proxy
  api_key:
    source: page_global
    expression: string     # path to API key (e.g., "preload.globals.gmsSuiteApiKey")
  authuser:
    source: page_global
    expression: string?    # path to authuser index (default: "0")
```

**Example — Google Analytics** (Gap 010):
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

**Sites**: Google Analytics, Google Calendar, Google Drive, Google Cloud.

**Runtime**: Forces `mode: browser_fetch`. All requests routed through
`gapi.client.request()` in page context. The runtime calls:
```javascript
gapi.client.setApiKey(apiKey);
gapi.client.request({ path, method, params, body, headers });
```

**Detection**: `gapi.client` present on window. Google API domains in requests.

---

### `aws_sigv4`

AWS Signature Version 4 request signing. Used for AWS Console and services
that require STS credentials.

**Schema:**
```yaml
signing:
  type: aws_sigv4
  credentials:
    access_key: string     # or extraction source
    secret_key: string     # or extraction source
    session_token: string? # for temporary credentials
  region: string
  service: string
```

**Example — AWS Console** (Gap 004):
```yaml
signing:
  type: aws_sigv4
  credentials:
    source: page_global    # credentials from STS iframe
    expression: "__aws_credentials"
  region: us-east-1
  service: execute-api
```

**Sites**: AWS Console (with credential refresh via STS).

**Runtime**: Standard SigV4 computation. Requires access key, secret, optional
session token, region, service. Signs canonical request and adds Authorization header.

---

## Pagination Primitives

How to page through multi-page result sets. Defined per-operation.

### `cursor`

Cursor-based pagination. Response contains a cursor value that is passed
as a parameter in the next request.

**Schema:**
```yaml
pagination:
  type: cursor
  response_field: string     # JSON path to cursor in response
  request_param: string      # query parameter name for cursor
  has_more_field: string?    # JSON path to boolean "more pages" indicator
```

**Example — Bluesky:**
```yaml
pagination:
  type: cursor
  response_field: cursor
  request_param: cursor
```

**Example — Discord:**
```yaml
pagination:
  type: cursor
  response_field: "messages[-1].id"   # last message ID as cursor
  request_param: before
```

**Sites**: Bluesky, Discord, Reddit (`after`), Slack, X/Twitter.

**Runtime**: Make request. Extract `response_field` from response. If present
(and `has_more_field` is true if specified), make next request with cursor
as `request_param`. Repeat until no more cursor.

---

### `offset_limit`

Classic offset/limit pagination.

**Schema:**
```yaml
pagination:
  type: offset_limit
  offset_param: string       # query parameter for offset (default: "offset")
  limit_param: string        # query parameter for limit (default: "limit")
  total_field: string?       # JSON path to total count in response
  default_limit: number?     # default page size
```

**Example — Airtable:**
```yaml
pagination:
  type: offset_limit
  offset_param: offset
  limit_param: pageSize
```

---

### `link_header`

RFC 8288 Link header pagination. Common in REST APIs.

**Schema:**
```yaml
pagination:
  type: link_header
  rel: string?               # link relation (default: "next")
```

**Example — Sentry:**
```yaml
pagination:
  type: link_header
  rel: next
```

**Example — GitHub REST API:**
```yaml
pagination:
  type: link_header
```

**Sites**: Sentry, GitHub REST API.

**Runtime**: Parse `Link` header. Find entry with `rel="next"`. Follow URL.
Stop when no `rel="next"` present.

---

### `page_number`

Simple page-number pagination.

**Schema:**
```yaml
pagination:
  type: page_number
  param: string              # query parameter name (default: "page")
  starts_at: number?         # first page number (default: 1)
  total_pages_field: string? # JSON path to total pages in response
```

---

## Extraction Primitives

How to get structured data from non-API sources: SSR-rendered HTML, framework
caches, DOM elements. Used when sites serve data in the initial page load
rather than through API calls. Defined per-operation.

### `ssr_next_data`

Extract data from Next.js `__NEXT_DATA__` global.

**Schema:**
```yaml
extraction:
  type: ssr_next_data
  page_url: string?        # URL to fetch (default: current page)
  path: string             # JSON path within __NEXT_DATA__ (e.g., "props.pageProps.listings")
```

**Example — Zillow** (Gap 006):
```yaml
extraction:
  type: ssr_next_data
  page_url: "/homedetails/{zpid}"
  path: props.pageProps.componentProps.gdpClientCache
```

**Sites**: Zillow, other Next.js apps.

**Runtime**: `page.evaluate(() => window.__NEXT_DATA__)`, walk path, return data.
Or fetch page HTML, parse `<script id="__NEXT_DATA__">` tag.

**Detection**: `__NEXT_DATA__` global present. `X-Powered-By: Next.js` header.

---

### `ssr_nuxt`

Extract data from Nuxt.js `__NUXT__` global or `_payload.json`.

**Schema:**
```yaml
extraction:
  type: ssr_nuxt
  path: string             # JSON path within __NUXT__ data
  payload_url: string?     # alternative: fetch _payload.json instead of evaluating global
```

**Sites**: Nuxt-based apps.

---

### `apollo_cache`

Extract data from Apollo Client's in-memory cache. Populated during SSR,
contains normalized GraphQL data without additional network requests.

**Schema:**
```yaml
extraction:
  type: apollo_cache
  source: string?          # global to call (default: "__APOLLO_STATE__")
  key_pattern: string      # cache key pattern (e.g., "Movie:{\"videoId\":\"${videoId}\"}")
  fields: string[]?        # specific fields to extract (default: all)
```

**Example — Netflix** (Gap 006):
```yaml
extraction:
  type: apollo_cache
  source: "netflix.appContext.state.graphqlClient.cache.extract()"
  key_pattern: 'Movie:{"videoId":"${videoId}"}'
```

**Example — Instacart:**
```yaml
extraction:
  type: apollo_cache
  source: "__APOLLO_CLIENT__.cache.extract()"
  key_pattern: 'User:{"id":"${userId}"}'
```

**Sites**: Netflix, Instacart, Medium.

**Runtime**: `page.evaluate(() => window.{source})`. Filter by `key_pattern`.
Return matched entries.

**Detection**: `__APOLLO_STATE__` or `__APOLLO_CLIENT__` globals present.

---

### `html_selector`

Extract data from DOM elements via CSS selectors. Used for pure SSR sites
with no JavaScript data layer.

**Schema:**
```yaml
extraction:
  type: html_selector
  page_url: string?        # URL to fetch (default: current page)
  selectors:               # named selectors → field map
    field_name: string     # CSS selector (extracts textContent by default)
  attribute: string?       # extract this attribute instead of textContent
  multiple: boolean?       # querySelectorAll vs querySelector (default: false)
```

**Example — Hacker News** (Gap 001):
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

**Sites**: Hacker News, Wikipedia, Craigslist.

**Runtime**: Fetch page (or use current DOM). Apply each selector. Return
named map of extracted values.

**Detection**: No XHR/fetch calls in HAR. HTML contains structured content.

---

### `script_json`

Extract JSON embedded in `<script>` tags (common in SSR frameworks).

**Schema:**
```yaml
extraction:
  type: script_json
  selector: string         # CSS selector for the script tag
  path: string?            # JSON path within the parsed content
```

**Example — Airbnb** (Gap 006):
```yaml
extraction:
  type: script_json
  selector: 'script[type="application/json"][id="data-deferred-state-0"]'
  path: "niobeMinimalClientData[0][1].data.presentation"
```

**Example — GitHub embedded React data:**
```yaml
extraction:
  type: script_json
  selector: 'script[data-target="react-app.embeddedData"]'
  path: "payload"
```

**Sites**: Airbnb, GitHub (React embedded data), TikTok.

**Runtime**: Query DOM for selector. Parse `textContent` as JSON. Walk path.

**Detection**: `<script type="application/json">` or `<script data-*>` tags
containing large JSON objects in HTML.

---

### `page_global_data`

Extract structured data from window globals (not auth-related — pure data).

**Schema:**
```yaml
extraction:
  type: page_global_data
  expression: string       # dot path from window
  path: string?            # additional JSON path within extracted value
```

**Example — Yelp:**
```yaml
extraction:
  type: page_global_data
  expression: "yelp.react_root_props"
  path: legacyProps.searchData
```

**Example — TikTok:**
```yaml
extraction:
  type: page_global_data
  expression: "__UNIVERSAL_DATA_FOR_REHYDRATION__"
  path: "__DEFAULT_SCOPE__"
```

**Sites**: Yelp, TikTok, Booking, Google Maps (`APP_INITIALIZATION_STATE`).

---

## Composition: Full Site Examples

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

### Costco (cross-origin bearer, multiple API domains)

```yaml
servers:
  - url: https://www.costco.com
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
  - url: https://api.digital.costco.com
    x-openweb:
      mode: session_http
      auth:
        type: sessionStorage_token
        key: "authToken_${cookie:hashedUserId}"
        inject:
          header: Authorization
          prefix: "Bearer "
  - url: https://ecom-api.costco.com
    x-openweb:
      mode: direct_http
      auth:
        type: cookie_session
```

### GitHub (meta tag CSRF + form field CSRF + script JSON extraction)

```yaml
servers:
  - url: https://github.com
    x-openweb:
      mode: session_http
      auth:
        type: cookie_session
      csrf:
        type: meta_tag
        name: csrf-token
        header: X-CSRF-Token
paths:
  /_graphql:
    post:
      x-openweb:
        csrf:                        # operation-level override
          type: form_field
          selector: 'form[action*="graphql"] input[name="authenticity_token"]'
          header: X-CSRF-Token
  /{owner}/{repo}/issues:
    get:
      x-openweb:
        extraction:
          type: script_json
          selector: 'script[data-target="react-app.embeddedData"]'
          path: payload.listData
```

---

## Pattern Detection Signals (for Compiler)

The compiler observes these signals during capture to auto-detect L2 patterns:

| Signal | Detected Pattern |
|---|---|
| `credentials: 'include'` + HttpOnly cookies | `auth: cookie_session` |
| `Authorization: Bearer <JWT>` where JWT found in localStorage | `auth: localStorage_jwt` |
| `Authorization: Bearer <token>` where token found in sessionStorage | `auth: sessionStorage_token` |
| Token value matches `window.*` global | `auth: page_global` |
| `webpackChunk*` global + token not in storage/cookies | `auth: webpack_module_walk` |
| `wss://` connection + auth frame before HTTP calls | `auth: websocket_intercept` |
| Auth endpoint called before data endpoints | `auth: lazy_fetch` |
| Multiple auth endpoints with token passing | `auth: exchange_chain` |
| Header value = cookie value, header name contains `csrf` | `csrf: cookie_to_header` |
| `<meta name="csrf-token">` in HTML | `csrf: meta_tag` |
| CSRF value matches `window.*` path | `csrf: page_global` |
| `<input name="authenticity_token">` in forms | `csrf: form_field` |
| `Authorization: SAPISIDHASH ...` pattern | `signing: sapisidhash` |
| `gapi.client` on window | `signing: gapi_proxy` |
| `__NEXT_DATA__` global | `extraction: ssr_next_data` |
| `__APOLLO_STATE__` global | `extraction: apollo_cache` |
| `<script type="application/json">` with large JSON | `extraction: script_json` |

---

## Runtime Execution Order

When the executor processes a request through L2 primitives:

```
1. Resolve auth     → extract token(s), inject into request
2. Resolve csrf     → extract CSRF token, inject (mutations only)
3. Resolve signing  → compute signature, inject into request
4. Execute HTTP request
5. Check response   → if 401/403, refresh auth/csrf and retry (once)
6. Resolve pagination → if more pages, goto 1 with cursor
```

For `mode: browser_fetch`, steps 1–4 happen inside `page.evaluate()`.
For `mode: session_http`, steps 1–2 happen in browser, step 4 via HTTP client.
For `mode: direct_http`, only pre-extracted tokens are used (no browser).

---

## TypeScript Type Definitions

```typescript
// ── Inject ──────────────────────────────────────────
interface Inject {
  header?: string;
  prefix?: string;
  query?: string;
  body_field?: string;
  body_merge?: boolean;
}

// ── Auth ────────────────────────────────────────────
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

// ── CSRF ────────────────────────────────────────────
type CsrfPrimitive =
  | { type: 'cookie_to_header'; cookie: string; header: string }
  | { type: 'meta_tag'; name: string; header: string }
  | { type: 'page_global'; expression: string; inject: Inject }
  | { type: 'form_field'; fetch_url?: string; selector: string;
      attribute?: string; header?: string; body_field?: string }
  | { type: 'api_response'; endpoint: string; method?: string;
      extract: string; inject: Inject; cache?: boolean };

// ── Signing ─────────────────────────────────────────
type SigningPrimitive =
  | { type: 'sapisidhash'; cookie?: string; origin: string; inject: Inject }
  | { type: 'gapi_proxy'; api_key: { source: string; expression: string };
      authuser?: { source: string; expression: string } }
  | { type: 'aws_sigv4'; credentials: Record<string, string>;
      region: string; service: string };

// ── Pagination ──────────────────────────────────────
type PaginationPrimitive =
  | { type: 'cursor'; response_field: string; request_param: string;
      has_more_field?: string }
  | { type: 'offset_limit'; offset_param?: string; limit_param?: string;
      total_field?: string; default_limit?: number }
  | { type: 'link_header'; rel?: string }
  | { type: 'page_number'; param?: string; starts_at?: number;
      total_pages_field?: string };

// ── Extraction ──────────────────────────────────────
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

// ── x-openweb server-level ──────────────────────────
interface XOpenWebServer {
  mode: 'direct_http' | 'session_http' | 'browser_fetch';
  auth?: AuthPrimitive;
  csrf?: CsrfPrimitive & { scope?: string[] };
  signing?: SigningPrimitive;
}

// ── x-openweb operation-level ───────────────────────
interface XOpenWebOperation {
  csrf?: CsrfPrimitive & { scope?: string[] };  // override server-level
  pagination?: PaginationPrimitive;
  extraction?: ExtractionPrimitive;
}
```

---

## Pattern Count Summary

| Category | Types | Coverage |
|---|---|---|
| Auth | 9 types | ~90% of authenticated sites |
| CSRF | 5 types | ~95% of CSRF-protected sites |
| Signing | 3 types | ~80% of signed-request sites |
| Pagination | 4 types | ~95% of paginated APIs |
| Extraction | 6 types | ~85% of SSR/non-API sites |
| **Total** | **27 types** | **~90% of all sites** |

The remaining ~10% require L3 code adapters (WhatsApp, Telegram, OnlyFans,
TikTok signing, obfuscated webpack modules).

---

## Cross-References

- **Compiler pipeline** → [compiler-pipeline.md](compiler-pipeline.md): How signals are detected and patterns emitted
- **Runtime executor** → [runtime-executor.md](runtime-executor.md): How primitives execute at request time
- **Pattern library** → [pattern-library.md](pattern-library.md): Complete mapping of sites → primitives
- **L3 code adapters** → [layer3-code-adapters.md](layer3-code-adapters.md): Escape hatch for what L2 can't express
- **Gap matrix** → [gap-coverage-matrix.md](gap-coverage-matrix.md): How each design gap maps to L2 primitives
