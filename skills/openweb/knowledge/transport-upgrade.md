# Transport Upgrade Decisions

How to choose the right transport tier, diagnose node feasibility, discover APIs, validate assumptions, and recognize when upgrading is not viable.

## Stability Ladder

Seven tiers from most fragile to most stable. Each tier eliminates a fragility surface of the tier below it.

> **Note on scope:** Tiers 1 & 4 describe patterns used **inside adapters**, not runtime transport modes. Runtime transport dispatch operates on `node` vs `page` (see `src/runtime/operation-context.ts`); extraction is a separate branch (Tiers 2–3), and Tier 5 maps to the `page` transport implemented by `executeBrowserFetch()`. Tier 6 (module walk) is an **auth resolution primitive** (`src/runtime/primitives/webpack-module-walk.ts`), not a transport tier — it appears here only to show where rotating-token discovery fits in the stability hierarchy.

### Tier 1 — DOM Action (page.click / page.fill) *(adapter pattern)*

- **Fragility surface:** Selector strings, element render timing, layout shifts, A/B test DOM variants
- **When to use:** Write operations requiring form submission, login flows, or stateful interactions that have no API equivalent
- **When to move up:** If the operation is read-only, any higher tier is better. Check for an API or SSR global first.

### Tier 2 — DOM Extraction (page.evaluate → querySelector)

- **Fragility surface:** CSS selectors, DOM structure changes on redeploy, framework hydration timing
- **When to use:** Data is rendered into DOM but not available in any `<script>` tag, API, or SSR global
- **When to move up:** Look for `__NEXT_DATA__`, `__NUXT__`, `ld+json`, `window.*` globals, or Apollo cache in the page source. Any of those moves you to Tier 3+.

### Tier 3 — SSR / Page Global Extraction

- **Fragility surface:** Global variable name changes on redeploy, JSON structure changes, framework version upgrades
- **When to use:** Page embeds structured data in a `<script>` tag. Common patterns: `__NEXT_DATA__`, Apollo SSR cache, LD+JSON, `window.__data`
- **When to move up:** If the embedded data originates from a fetchable API, call the API directly to skip HTML parsing.

### Tier 4 — API Intercept (response interception via CDP) *(adapter pattern)*

- **Fragility surface:** CDP connection, browser lifecycle, page navigation timing, response body buffering
- **When to use:** API exists but requires browser-context cookies or bot detection tokens that can't be replicated in Node
- **When to move up:** Try `page.evaluate(fetch(...))` — if it works, you skip CDP interception overhead.

### Tier 5 — page.evaluate(fetch)

- **Fragility surface:** Browser startup, page lifecycle, but no CDP interception or DOM dependency
- **When to use:** API works from within the browser JS context but not from Node (bot detection fingerprints the request origin). Common with PerimeterX-protected GraphQL endpoints.
- **When to move up:** Test the same request from Node with appropriate headers. If it returns valid data, skip the browser entirely.

### Tier 6 — Module Walk (runtime JS bundle extraction) *(auth primitive, not transport)*

- **Fragility surface:** Bundle URL changes on redeploy, minification variable names, webpack chunk structure
- **When to use:** Persisted query hashes, signing keys, or API tokens embedded in the site's JS bundles. Useful when hashes rotate on every deploy.
- **When to move up:** If the values are static (don't rotate), hardcode them. Module walk is for values that change with each deploy.

### Tier 7 — Node Direct (fetch / HTTP)

- **Fragility surface:** Minimal — API contract changes, auth token rotation
- **When to use:** API returns valid data to a Node HTTP request with standard headers. This is the target tier for all read operations.
- **Why it's best:** No browser startup (~5s saved), no CDP, no tab management, no selector fragility, supports parallel execution.

### Decision Flow

```text
Can Node fetch the endpoint with Chrome UA?
  +- 2xx with valid data -> Tier 7 (node direct)
  +- 403/challenge page -> Is the API callable via page.evaluate(fetch)?
       +- Yes -> Tier 5 (page.evaluate)
       +- No -> Can you intercept API response during navigation?
            +- Yes -> Tier 4 (API intercept via interceptResponse)
            +- No -> Is data in SSR globals (__NEXT_DATA__, Apollo cache)?
                 +- Yes -> Tier 3 (node fetch HTML + parse)
                 +- No -> Tier 2 (DOM extraction) or Tier 1 (DOM action)
```

## Node Feasibility Quick-Check

Three-step method to determine whether an endpoint can run on node transport. Run this before writing any adapter code.

### Step 1 — curl with Chrome UA

```bash
curl -s -o /dev/null -w '%{http_code}' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
  'https://example.com/api/endpoint'
```

- **2xx:** Promising — proceed to Step 2
- **403 with challenge HTML:** Bot detection active — likely need page transport
- **401/403 with JSON error:** Auth required — may still work with correct tokens
- **5xx:** Server issue, not transport-related — retry later

### Step 2 — Inspect Response Headers

```bash
curl -sI -H 'User-Agent: ...' 'https://example.com/api/endpoint' | grep -iE 'server|x-cdn|set-cookie|cf-|x-px|datadome|akamai'
```

Key signals:

| Header/Cookie | Meaning | Impact |
|---------------|---------|--------|
| `cf_clearance` | Cloudflare challenge | Node blocked without solved cookie |
| `_abck` | Akamai Bot Manager | Node almost always blocked |
| `_px3` / `_pxhd` | PerimeterX | Node blocked; page.evaluate may work |
| `datadome` | DataDome | Aggressive — even page transport can fail |
| `server: cloudfront` | CloudFront CDN | Usually fine for node — CDN ≠ bot detection |
| No bot cookies | No client-side detection | Strong signal for node feasibility |

### Step 3 — Retry Without UA / With Bot UA

```bash
# No User-Agent
curl -s -o /dev/null -w '%{http_code}' 'https://example.com/api/endpoint'

# Explicit bot UA
curl -s -o /dev/null -w '%{http_code}' \
  -H 'User-Agent: OpenWeb/1.0' \
  'https://example.com/api/endpoint'
```

- **Same 2xx:** Endpoint doesn't check UA — node is safe
- **Different status:** UA-sensitive — set `User-Agent` via adapter headers or `nodeFetch` default (which uses Chrome UA automatically)
- **403 on both:** Not a UA issue — likely IP reputation or cookie-based detection

**Quick-check summary:** If Step 1 returns 2xx and Step 3 shows no UA sensitivity, the endpoint is node-ready. Write the operation with `x-openweb.transport: node`.

## GraphQL API Discovery Path

Five-step process for discovering and modeling a site's GraphQL API. Works whether the site uses Apollo, Relay, or custom GraphQL clients.

### Step 1 — CDP Capture

Record browser traffic, then inspect the capture for GraphQL requests:

```bash
openweb capture start --output capture/
# (browse the site, trigger the operations you want to model)
openweb capture stop
# Filter the recorded HAR/samples for GraphQL endpoints:
grep -lE '"query"|"operationName"|persistedQuery' capture/*.json
```

Look for:
- POST requests to `/graphql`, `/gql`, `/api/graphql`, or similar
- Request bodies with `query`, `operationName`, `variables`, or `extensions.persistedQuery`
- Batched requests (JSON array body)

### Step 2 — Introspection Attempt

```bash
curl -s -X POST 'https://example.com/graphql' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { types { name } } }"}'
```

- **Full schema returned:** Rare but ideal — generate types directly
- **`"introspection is not allowed"`:** Proceed to Step 3
- **Auth error:** Add captured auth headers and retry

### Step 3 — Error-Message Reversal

Send intentionally malformed queries to extract schema information from error messages:

```bash
# Probe for field names via typos
curl -s -X POST 'https://example.com/graphql' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ xyzNotAField }"}'
# Response: "Did you mean 'user', 'users', 'viewer'?"
```

- Error messages like `"Did you mean X?"` reveal valid field and type names
- `"Cannot query field X on type Y"` reveals the type system
- Iterate: use discovered fields to probe deeper (`{ user { xyzBadField } }` → more suggestions)

### Step 4 — Persisted Hash Extraction

If the site uses persisted queries (hash instead of full query text):

```bash
# From captured traffic, extract the hash
# Request: {"extensions":{"persistedQuery":{"sha256Hash":"abc123..."}}, "variables":{...}}
```

- **Apollo-style:** Hash is SHA-256 of query text — deterministic, stable across deploys
- **Relay/custom style:** Server-assigned ID (`doc_id`, `queryId`) — rotates on redeploy, must be re-extracted
- **For rotating hashes:** Use module walk (Tier 6) to extract from JS bundles at runtime

-> See: [graphql.md](graphql.md) § Persisted Queries for hash modeling details

### Step 5 — Auth Test

Test whether the GraphQL endpoint requires authentication:

```bash
# Without auth
curl -s -X POST 'https://example.com/graphql' \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ publicField { id name } }"}'

# With captured session cookie
curl -s -X POST 'https://example.com/graphql' \
  -H 'Content-Type: application/json' \
  -H 'Cookie: session=...' \
  -d '{"query":"{ publicField { id name } }"}'
```

- **Same response:** No auth needed for this query — model as public
- **Different data / auth error without cookie:** Auth required — configure in `x-openweb.auth`
- **Mixed:** Some queries public, some authenticated — split operations accordingly

## Disproved Assumptions Pattern

Common assumptions that block transport upgrades. Each has been disproved in practice — always verify before accepting.

| Assumption | How to Disprove | What Often Happens |
|------------|----------------|--------------------|
| "Site requires a browser" | curl the page URL with Chrome UA — check if HTML contains the data in `<script>` tags | Many SSR sites embed all data server-side; browser only hydrates interactivity |
| "API needs authentication" | Send the captured API request without cookies/tokens | Public read endpoints often work without auth; auth is only enforced for writes |
| "Bot detection blocks everything" | Test `page.evaluate(fetch(...))` from within the browser | PerimeterX blocks node HTTP but allows in-browser fetch — hybrid approach works |
| "Mobile site is the same as desktop" | curl the mobile API endpoint (e.g. `m.example.com/api/`) | Mobile APIs are often separate backends with weaker bot detection |
| "GraphQL requires introspection to model" | Send malformed queries and read error suggestions | Error-message reversal reveals field names and types incrementally |
| "No JSON API exists" | Inspect SSR page source for embedded JSON (`__NEXT_DATA__`, LD+JSON, `window.*`) | Data is in the HTML — no separate API needed, just parse the page |
| "Headers are decorative" | Remove custom headers one at a time, check which cause 403 | Often only 1-2 headers are enforced; the rest are noise from the browser |
| "CORS means node can't call it" | CORS is browser-enforced only — node/curl ignores CORS headers entirely | Node fetch has no CORS restriction; the API works fine from server-side |
| "Rate limiting blocks automation" | Test with reasonable intervals (1-2s between requests) | Most rate limits target burst traffic (>10 req/s), not sequential single requests |

**Verification protocol:** Before accepting any "can't upgrade" conclusion, run the [Node Feasibility Quick-Check](#node-feasibility-quick-check) and document the actual response codes and headers. Assumptions without evidence belong in a probe doc, not a site package.

## When NOT to Upgrade

Clear criteria for stopping a transport upgrade attempt. Document the evidence and move on.

> **Runtime behavior on bot detection:** The runtime does **not** silently fall back from `node` to `page` (or from `page` to extraction) when bot detection fires. Instead, the executor throws a `bot_blocked` failureClass error (see `src/runtime/extraction-executor.ts` and `src/runtime/browser-fetch-executor.ts`) with the action: `Run: openweb browser restart --no-headless`, solve the CAPTCHA in the visible browser, then retry. Tier selection is a **design-time** decision encoded in the site package, not a runtime auto-upgrade.

### Multi-Layer Bot Detection Stacking

When a site combines two or more commercial detection systems (e.g. PerimeterX + DataDome, or Cloudflare + Akamai), the detection surfaces compound:

- Each system independently fingerprints requests
- Passing one layer's challenge doesn't satisfy the other
- Even `page.evaluate(fetch)` may fail because one system fingerprints the fetch origin while the other fingerprints cookies
- **Action:** Document in the site's DOC.md as a Known Issue. Keep page transport.

-> See: [bot-detection.md](bot-detection.md) for detection system specifics

### Single-Layer Detection with No Bypass

If a single bot detection system blocks both node HTTP and `page.evaluate(fetch)`:

- PerimeterX or DataDome with aggressive configuration
- Challenge page appears even in real browser with automated flags
- **Test:** If `page.goto()` + DOM extraction works but nothing else does, stay on Tier 2
- **Action:** Use page transport with DOM or SSR extraction. Don't fight the detection.

### No Discoverable API

Some sites genuinely have no client-accessible API:

- All data is server-rendered HTML with no JSON endpoints
- No `__NEXT_DATA__`, no SSR globals, no `ld+json`
- Network tab shows only static assets (CSS, JS, images) — no XHR/fetch data calls
- **Test:** Full CDP capture with diverse navigation shows zero API calls
- **Action:** Use Tier 2 (DOM extraction) or Tier 3 (HTML parse) from node if no bot detection, or page if blocked.

### IP-Based Blocking

When the site blocks by IP reputation regardless of headers, cookies, or browser context:

- All transports return 403 or CAPTCHA from the same IP
- VPN/proxy with different IP succeeds
- Residential IP succeeds but datacenter IP fails
- **Test:** Same request from different IP ranges
- **Action:** Document as environment-dependent. Not a transport issue — it's an infrastructure constraint.

### Cost Exceeds Benefit

Even when technically possible, don't upgrade if:

- The site has only 1-2 simple read operations on page transport
- The operation already works reliably (no DOM fragility complaints)
- The upgrade would require a complex adapter (module walk + signing + rotating tokens) for marginal stability gain
- **Rule of thumb:** If the adapter would be more fragile than the DOM selectors it replaces, the upgrade makes things worse.
