# L2 Primitive Resolvers

> Auth, CSRF, signing, pagination, and extraction primitives — the declarative layer that handles ~50% of websites.
> Last updated: 2026-03-26 (M38)

## Overview

L2 primitives are **declarative config units** stored in the `x-openweb` extension of OpenAPI specs. The runtime reads them and resolves auth tokens, CSRF headers, request signatures, etc. — without any site-specific code.

Each primitive has a `type` discriminator and type-specific config fields.

-> See: `src/types/primitives.ts` — all 16 primitive type definitions

---

## Resolution Pipeline

On every L2 HTTP request (`node` or `page` transport), three resolvers run in sequence:

```
resolveAuth(handle, auth, serverUrl)     ->  cookies + auth headers
resolveCsrf(handle, csrf, serverUrl)     ->  CSRF headers (mutations only)
resolveSigning(handle, signing, serverUrl) ->  signing headers (per-request)
```

All results are **merged into a single headers dict** passed to the HTTP request.

The `BrowserHandle` provides access to the Patchright `Page` and `BrowserContext` for browser-side extraction.

```typescript
interface BrowserHandle {
  page: Page
  context: BrowserContext
}

interface ResolvedInjections {
  headers: Record<string, string>
  cookieString?: string
}
```

-> See: `src/runtime/primitives/types.ts`

Extraction-only operations skip this auth/CSRF/signing pipeline and call the extraction resolvers directly through `executeExtraction()`.

---

## Primitive Taxonomy

| Category | Types | Resolved when |
|----------|-------|---------------|
| Auth | cookie_session, localStorage_jwt, sessionStorage_msal, page_global, webpack_module_walk, exchange_chain | Every request |
| CSRF | cookie_to_header, meta_tag, api_response | Mutations only (POST, PUT, PATCH, DELETE) |
| Signing | sapisidhash | Every request |
| Pagination | cursor, link_header | Multi-page fetches |
| Extraction | script_json, ssr_next_data, html_selector, page_global_data | Extraction-only operations |

---

## Inject Schema

All primitives that inject values share the `Inject` interface:

```typescript
interface Inject {
  header?: string       // Set as HTTP header
  prefix?: string       // Prefix the value (e.g., "Bearer ")
  query?: string        // Set as query parameter
  json_body_path?: string   // Set in request body at JSON path
}
```

Most commonly: `{ header: "Authorization", prefix: "Bearer " }`

---

## Pagination Primitives

Pagination is configured at the **operation** level in `x-openweb`.

| Type | Mechanism | Implemented |
|------|-----------|-------------|
| `cursor` | Response field -> request param loop | Yes |
| `link_header` | Follow `Link: <url>; rel="next"` | Yes |

```yaml
x-openweb:
  pagination:
    type: cursor
    response_field: "cursor"
    request_param: "cursor"
    has_more_field: "has_more"
```

Both `response_field` and `has_more_field` support **dotted paths** for nested responses (e.g., `data.actor.entitySearch.results.nextCursor`).

`request_param` also supports dotted paths for writing the cursor into a nested request parameter. This is useful for GraphQL where the cursor must be injected into `variables.cursor` rather than a top-level param:

```yaml
pagination:
  type: cursor
  response_field: "data.actor.entitySearch.results.nextCursor"
  request_param: "variables.cursor"
```

-> See: `src/runtime/paginator.ts`, `src/runtime/value-path.ts`

---

## Extraction Primitives

Extraction primitives read data directly from the page DOM or SSR state — no API call needed.

| Type | What it does | Implemented |
|------|-------------|-------------|
| `script_json` | Extract JSON from `<script>` tags (JSON-LD, HTML-comment-wrapped, multi-block) | Yes |
| `ssr_next_data` | Read `__NEXT_DATA__` | Yes |
| `html_selector` | CSS selector extraction | Yes |
| `page_global_data` | Read page global variable | Yes |
| `response_capture` | Navigate + capture first URL-matched network response | Yes |

### script_json

Extracts structured data from `<script type="application/json">` or inline JSON. Runs under both node (`node-ssr-executor`) and page transports.

```yaml
extraction:
  type: script_json
  selector: "script[data-target='react-app.embeddedData']"
  path: "payload.tree.items"
```

Used by GitHub for SSR-embedded data.

**Strip HTML comments:** some sites (e.g. Yelp) wrap inline JSON in `<!-- ... -->` to prevent early parsing. Set `strip_comments: true` to unwrap before parsing.

```yaml
extraction:
  type: script_json
  selector: "script#wrapped-data"
  strip_comments: true
```

**Multi-block ld+json:** when a page contains several `<script type="application/ld+json">` blocks (hotels, breadcrumbs, FAQs), set `type_filter` to pick the block whose `@type` matches (handles string or string[]). Set `multi: true` to return all parsed blocks as an array (post `type_filter` if both are set).

```yaml
extraction:
  type: script_json
  selector: 'script[type="application/ld+json"]'
  type_filter: Hotel
```

-> See: `src/runtime/primitives/script-json.ts`

### ssr_next_data

Reads structured data from Next.js pages via `window.__NEXT_DATA__` or the `#__NEXT_DATA__` script.

```yaml
extraction:
  type: ssr_next_data
  page_url: "/"
  path: "props.pageProps.bootstrapData.footer.data.contentLayout.modules"
```

Used by Walmart for homepage footer modules.

-> See: `src/runtime/primitives/ssr-next-data.ts`

### html_selector

Extracts DOM content by CSS selectors. Multiple selectors can be zipped into row objects.

```yaml
extraction:
  type: html_selector
  page_url: "/news"
  selectors:
    title: ".titleline > a"
    score: ".score"
    author: ".hnuser"
  multiple: true
```

Used by Hacker News for front-page story extraction.

-> See: `src/runtime/primitives/html-selector.ts`

### page_global_data

Evaluates a safe page-global expression and optionally follows a nested path into the returned object.

```yaml
extraction:
  type: page_global_data
  page_url: "/app"
  expression: "window.__STATE__"
  path: "viewer.profile.id"
```

This shares the same expression safety checks as `page_global` auth resolution.

-> See: `src/runtime/primitives/page-global-data.ts`

### response_capture

Navigate to a page via PagePlan and return the first network response whose URL matches a glob. The response listener is installed before `page.goto` so fast responses that fire before navigation resolves are not missed. Capture always forces fresh navigation (no page reuse).

```yaml
extraction:
  type: response_capture
  page_url: /flights/search
  match_url: "*/api/search/flights*"
  unwrap: data.results
```

`page_url` aliases PagePlan's `entry_url` for capture operations; when both are set, `page_url` wins. Only the first matching response is returned — progressive / best-of-N / multi-response capture stays in a CustomRunner.

-> See: `src/runtime/primitives/response-capture.ts`

---

## File Structure

```
src/runtime/primitives/
├── types.ts                # BrowserHandle, ResolvedInjections
├── registry.ts             # Primitive resolver registry
├── index.ts                # Re-exports
├── cookie-session.ts       # cookie_session auth
├── cookie-to-header.ts     # cookie_to_header CSRF
├── localstorage-jwt.ts     # localStorage_jwt auth
├── page-global.ts          # page_global auth/CSRF
├── page-expression.ts      # shared safe expression evaluator
├── sessionstorage-msal.ts  # sessionStorage_msal auth
├── sapisidhash.ts          # SAPISIDHASH signing
├── meta-tag.ts             # meta_tag CSRF
├── api-response.ts         # api_response CSRF
├── exchange-chain.ts       # exchange_chain auth
├── script-json.ts          # script_json extraction
├── ssr-next-data.ts        # ssr_next_data extraction
├── html-selector.ts        # html_selector extraction
├── page-global-data.ts     # page_global_data extraction
├── webpack-module-walk.ts  # webpack_module_walk auth
├── ws-upgrade-header.ts    # ws_upgrade_header WS auth
├── ws-first-message.ts     # ws_first_message WS auth
├── ws-url-token.ts         # ws_url_token WS auth
├── ws-http-handshake.ts    # ws_http_handshake WS auth
├── ws-registry.ts          # WS primitive resolver registry
└── primitives.test.ts      # Unit tests
```

---

## Detailed Docs

- [auth.md](auth.md) — Auth primitives (cookie_session, localStorage_jwt, sessionStorage_msal, page_global, webpack_module_walk, exchange_chain)
- [signing.md](signing.md) — CSRF, signing, and bot detection primitives

## Related Docs

- [architecture.md](../architecture.md) — System overview and 3-layer model
- [runtime.md](../runtime.md) — Execution pipeline that invokes primitives
- [meta-spec.md](../meta-spec.md) — Type definitions for all 16 primitives
- [adapters.md](../adapters.md) — L3 escape hatch when primitives aren't enough
- `src/types/primitives.ts` — Full type definitions
