# Probe Protocol

Full CDP protocol for browser-side discovery of data sources, transport constraints, and auth signals per intent family.

**Load when:** guide.md Step 2 (Probe), or when re-probing after verify failure.

---

## Rules

- Browser only -- no direct Node HTTP probes
- One family at a time
- Keep sessions short (single CDP connection, minimal page loads)
- Watch for block pages, redirect loops, and rate limits as early stop signals
- If blocked, note the block and stop probing that family until login/challenge resolution

## Pre-Probe Checklist

Before running CDP code, do a quick manual sanity check:

1. Open DevTools Network/XHR -- if zero JSON responses appear, it is SSR/DOM-only.
2. Check `view-source:` for `__NEXT_DATA__`, `__INITIAL_STATE__`, LD+JSON -- these are extraction targets (use `x-openweb.extraction`), not adapter-only signals.
3. Try the on-page search box -- some sites serve SSR for direct nav but use JSON APIs for in-app search/pagination.
4. Check if the mobile app calls a hidden public API the web version does not use.

---

## Probe Steps

### 2a. Connect and Navigate

Open a managed-browser CDP session and navigate to the representative page for this intent family.

```typescript
const browser = await chromium.connectOverCDP('http://localhost:9222')
const context = browser.contexts()[0]!
const page = context.pages()[0]!
await page.goto(representativeUrl, { waitUntil: 'load', timeout: 30_000 })
await page.waitForTimeout(3000) // hydration
```

### 2b. Health Check

Read `page.title()` and inspect the URL and title for challenge or block patterns:

- `challenges.cloudflare.com` in URL
- `captcha-delivery.com` in URL
- Title contains `access denied` or `just a moment`

If blocked, note the block and stop probing that family until login or challenge resolution.

### 2c. Inventory SSR and Extraction Sources

Check for structured data already present in the page -- these are extraction candidates that avoid API replay entirely.

```typescript
const ssr = await page.evaluate(() => ({
  nextData: !!document.querySelector('#__NEXT_DATA__'),
  ldJsonCount: document.querySelectorAll('script[type="application/ld+json"]').length,
  initialState: typeof (window as any).__INITIAL_STATE__ !== 'undefined',
  nuxt: typeof (window as any).__NUXT__ !== 'undefined',
  preloadedState: typeof (window as any).__PRELOADED_STATE__ !== 'undefined',
}))
```

Also check obvious DOM selectors for target data (e.g., `.product-title`, `.price`).

**Extraction priority** (prefer higher, use lower only when higher is unavailable):

1. **API** (JSON response) -- cleanest, most stable, clearest schema
2. **SSR JSON** (`__NEXT_DATA__`, `__INITIAL_STATE__`, LD+JSON) -- structured data, no render dependency
3. **In-page JSON** (script tags, window globals) -- structured but less predictable sources
4. **DOM** -- last fallback, slowest and most fragile; if DOM extraction exceeds ~5 lines, escalate to adapter

### 2d. Passively Intercept Network and WS Traffic

Open a **new page** in the same context. Set listeners **before** navigation so nothing is missed.

```typescript
const apis: Array<{url: string, method: string, status: number, contentType: string}> = []
const probePage = await context.newPage()
probePage.on('response', async (resp) => {
  const ct = resp.headers()['content-type'] ?? ''
  if (ct.includes('json') && resp.status() < 400) {
    apis.push({
      url: resp.url(), method: resp.request().method(),
      status: resp.status(), contentType: ct,
    })
  }
})
await probePage.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 })
await probePage.waitForTimeout(5000) // let XHR/fetch calls complete
```

Filter out static and tracking requests by URL pattern. Note:
- API domains and path patterns
- Query params
- GraphQL operation names
- Persisted-query hashes

### 2e. Test Browser-Side Fetch Feasibility

When APIs are found in 2d, pick one representative API URL and replay it via `page.evaluate(fetch)`:

```typescript
const testUrl = apis[0].url
const fetched = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url, { credentials: 'include' })
    const body = await r.json()
    return { status: r.status, topKeys: Object.keys(body) }
  } catch (e) { return { status: 0, topKeys: [] } }
}, testUrl)
// Compare fetched.topKeys to the intercepted response shape.
// Same shape -> browser replay works.
// Empty/error/different -> signing required -> adapter/intercept lane.
```

If no APIs found in 2d, skip this step.

**CORS caveat for cross-origin APIs:**
- This replay test is only meaningful for same-origin requests.
- If the discovered API lives on a different origin, browser fetch may fail because of CORS rather than signing or bot detection.
- For cross-origin APIs, first navigate to the API origin or another same-origin page on that subdomain before using browser-context fetch as a feasibility test.
- Do not classify a family as `intercept_required` from a cross-origin CORS failure alone.

**Interpretation:**

| Outcome | Meaning |
|---|---|
| Same shape as intercepted response | Browser replay works -- `node_candidate` or `page_required` depending on bot-detection evidence |
| Empty / error / different shape | Signing or session binding required -- `adapter_required` or `intercept_required` |
| CORS error on cross-origin URL | Inconclusive -- re-test from same origin before concluding |

### 2f. Inspect Auth, CSRF, Signing, Bot-Detection Signals

```typescript
const cookies = await context.cookies()
const botCookies = cookies.filter(c =>
  ['_abck', '_px3', '_pxhd', 'datadome', 'cf_clearance'].includes(c.name) ||
  c.name.startsWith('ry_ry-')
)
```

Inspect:
- **Cookies** for session auth signals (names like `session`, `sid`, `token`, `auth`)
- **Intercepted request headers** for `Authorization`, CSRF-like cookie-to-header patterns
- **Per-request headers or params** for rotation between intercepted requests (signing signal)
- **Bot-detection cookies:** `botCookies.length > 0` means `page_required` even if browser-side fetch works (Node will likely fail)
- **Monkey-patched fetch (signing signal):** Run `await page.evaluate(() => window.fetch.toString().length)`. Native `fetch.toString()` is short (~40 chars). If length > ~100, `fetch` is monkey-patched — the site injects signing/header logic into every request. This means node transport cannot bypass the signing layer; route to `adapter_required` or `intercept_required`.

### 2g. Record Transport Hypothesis

Based on all evidence from 2a-2f, record one hypothesis per family:

| Hypothesis | Condition |
|---|---|
| `node_candidate` | Browser-side replay works AND no strong bot-detection evidence |
| `page_required` | Browser replay works BUT bot-detection evidence suggests Node may still fail |
| `adapter_required` | Family needs browser interaction or logic beyond direct replay |
| `intercept_required` | Site's own JS can fetch data but programmatic replay cannot |
| `extraction` | SSR/JSON/DOM is the simplest stable path |

> **Transport decision guidance:** Before committing to a transport hypothesis, run the **Node Feasibility Quick-Check** in [`knowledge/transport-upgrade.md`](../knowledge/transport-upgrade.md) §Node Feasibility Quick-Check — a 3-step curl-based test that validates whether node transport is actually viable for each family.

### 2h. Persist the Probe Matrix

Write the family decision to `DOC.md` under `## Internal: Probe Results`. One row per family.

**Format:**

```markdown
## Internal: Probe Results

| Family | Representative page/action | Evidence kind | Replay test | Auth/CSRF/signing | Transport hypothesis | Lane | Capture mode | Compile role |
|---|---|---|---|---|---|---|---|---|
| detail | product page load | api + intercept | browser fetch blocked | custom signing | intercept_required | adapter/intercept | none or micro | helpful |
| search | in-page search | ssr + dom | n/a | none | extraction | extraction | none | skip |
```

**Column definitions** (common values, not enums -- agent may use natural language for novel situations):

| Column | Common values |
|---|---|
| Evidence kind | `api`, `graphql`, `ws`, `ssr`, `dom`, `mixed` |
| Transport hypothesis | `node_candidate`, `page_required`, `adapter_required`, `intercept_required`, `extraction` |
| Lane | replay, extraction, adapter/intercept, ws |
| Capture mode | `none`, `micro`, `targeted`, `broad` |
| Compile role | `required`, `helpful`, `skip` |

These values are consumed by agents reading the guide to make routing decisions, not by code. Do not hardcode as enums -- the routing table matches on evidence semantics, not literal values.

---

## Additional Probe Guidance

- **Write-oriented families:** Ensure the probe notes whether login and CSRF evidence will require a safe write during later capture.
- **GraphQL persisted queries:** If present, record explicitly -- this affects compile usefulness and replay stability.
- **Rate limiting:** If rate limiting appears during probe, stop escalating requests and route conservatively.

---

## Probe Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Challenge/captcha page (Cloudflare, DataDome, PerimeterX) | Bot detection triggered before probe completes | Stop probe, resolve challenge or login first, then re-probe |
| Zero API responses in 2d | Site is SSR-only or APIs fire only on user interaction | Check pre-probe checklist items 1-3; try triggering in-app search or pagination before concluding extraction-only |
| Browser fetch returns different shape than intercepted response | Per-request signing, token rotation, or server-side session binding | Route to adapter/intercept lane; do not force replay |
| CORS error on browser fetch | API is cross-origin; failure is CORS policy, not signing | Navigate to API origin first and re-test; do not classify as `intercept_required` from CORS alone |
| Rate limit during probe (429, throttle page) | Too many probe requests in short session | Stop escalating, record what you have, route conservatively based on partial evidence |
| DOC.md claims site needs browser, but probe suggests node is viable | Stale transport assessment in existing docs | Do not trust old docs — verify against [`knowledge/transport-upgrade.md`](../knowledge/transport-upgrade.md) §Disproved Assumptions Pattern. Probe evidence overrides historical DOC.md claims. |

---

## Related Files

- `add-site/guide.md` -- main workflow (probe is Step 2)
- `add-site/capture.md` -- capture modes and evidence collection
- `knowledge/auth-routing.md` -- auth family routing patterns
- `knowledge/bot-detection.md` -- bot-detection signals and mitigation
- `knowledge/extraction.md` -- extraction lane details
- `knowledge/transport-upgrade.md` -- node feasibility quick-check, stability ladder, disproved assumptions
