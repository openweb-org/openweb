# Page Plan

> Runtime-owned page acquisition: navigation, readiness, settle, warm.
> Last updated: 2026-04-17 (warm_origin)

## What It Is

`PagePlan` is the single contract for "open a real app page and get it ready" that every browser-backed execution path uses. Before normalize-adapter, each executor (extraction, browser-fetch, adapter) hand-rolled its own `page.goto()` + `waitForSelector()` + `setTimeout()`. Now they all call `acquirePage(context, serverUrl, pagePlan, params)`.

A PagePlan is declared in the spec at server or operation level. Operation fields override server fields (same pattern as `transport`, `auth`, `csrf`, `signing`).

---

## Fields

```yaml
servers:
  - url: https://www.example.com
    x-openweb:
      transport: page
      page_plan:
        ready: "#app"
        warm: true

paths:
  /search:
    get:
      x-openweb:
        page_plan:
          entry_url: /search
          ready: ".search-results"
          settle_ms: 500
```

| Field | Type | Default | Purpose |
|---|---|---|---|
| `entry_url` | string | server URL | Where to navigate before executing. Supports server-variable interpolation (`{subdomain}`) and caller-param interpolation (`/{user}/posts`). |
| `ready` | string | — | CSS selector awaited after navigation. |
| `wait_until` | string | `"load"` | Playwright `waitUntil` (`domcontentloaded` / `load` / `networkidle` / `commit`). |
| `settle_ms` | number | `0` | Extra delay after `ready`. Escape hatch — prefer a tighter `ready` selector. |
| `warm` | boolean | `false` | Run `warmSession()` after readiness (PerimeterX / DataDome / Akamai cookie wait with retry). |
| `warm_origin` | `'page' \| 'server' \| URL` | auto | Override the URL `warmSession` navigates against. Default: entry_url when its origin differs from serverUrl, otherwise serverUrl. Use `'page'` for sites whose API lives on a different subdomain than the entry page (e.g. apple-podcasts). |
| `nav_timeout_ms` | number | `30000` | Navigation + readiness timeout. |

---

## Merge Rule

Operation fields override server fields field-by-field. Explicit operation values always win — including falsy ones. To opt out of a server-level `warm: true` on one operation:

```yaml
/public-ping:
  get:
    x-openweb:
      page_plan:
        warm: false    # this op does not warm even though server defaults to true
```

---

## Page Reuse

`acquirePage` reuses an existing page when:
- its origin matches the resolved `serverUrl`, AND
- its current URL path starts with `entry_url`, AND
- if `entry_url` has a query string, the page's query string contains the same keys/values (query-sensitive reuse)

Otherwise it creates a new page and navigates. No user-facing `match` knob — this default covers the real cases. Add one later if a site needs stricter or looser matching.

**Capture is different.** `response_capture` always forces fresh navigation — reusing a loaded page would race the response listener (the interesting response may already have fired).

---

## Non-Applicability

PagePlan is ignored when the resolved transport doesn't need a browser page:
- `transport: node` — the operation uses `node-extraction-executor` or direct `nodeFetch`. No page, no PagePlan.

---

## What acquirePage Does

```
1. Resolve PagePlan (operation over server, field merge)
2. Interpolate entry_url with server variables + caller params
3. Look for a reusable page (origin + entry_url prefix + query match)
4. If no reuse: new page, page.goto(entry_url, { waitUntil: plan.wait_until })
5. If ready selector: page.waitForSelector(plan.ready, { timeout: plan.nav_timeout_ms })
6. If settle_ms: await setTimeout(plan.settle_ms)
7. If warm: warmSession(page, page.url())   // on page origin, not server URL
8. Return { page, owned: newly-created? }
```

`warmSession` runs with the **page's current origin**, not the spec's `serverUrl`. This matters for sites whose entry page is on a different origin from the API server (e.g. apple-podcasts — page on `podcasts.apple.com`, API on `amp-api.podcasts.apple.com`). Warming the API origin would navigate away from the entry page and destroy JS-context auth like `window.MusicKit`.

`browser_fetch` (transport `page`) applies the same rule for its own explicit warm call: if `entry_url` origin differs from `serverUrl` origin, it warms on entry_url; otherwise serverUrl. `page_plan.warm_origin` overrides this when a site needs explicit control.

---

## File Structure

```
src/runtime/
├── page-plan.ts              # acquirePage, matchesEntryUrl, interpolateEntryUrl
├── operation-context.ts      # resolvePagePlan (field merge)
└── warm-session.ts           # warmSession (now with PX retry loop)
```

---

## Related Docs

- [runtime.md](../runtime.md) — full execution pipeline
- [primitives/README.md](README.md) — where PagePlan fits in the resolver cascade
- [adapters.md](../adapters.md) — CustomRunner gets `acquirePage` invoked by runtime before `run()`
- `src/runtime/page-plan.ts` — implementation
- `src/types/extensions.ts` — `PagePlanConfig` type
