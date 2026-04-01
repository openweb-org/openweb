# Analysis Review Reference

How to read `analysis.json` and decide whether captured traffic covers your
target intents.

## When to Load This

Load this during `compile.md` Step 2 (Review). You are reviewing the analysis
report produced by `openweb compile` to decide: continue to curation, re-capture
for more traffic, or stop.

## What to Read and What to Skip

**DO NOT read the entire `analysis.json`.** It can be very large (the `samples`
array alone may contain thousands of entries). Read specific sections only.

Skip the `samples` array — every labeled request, huge.
Skip the `navigation` array — page-level request groups, only useful for
debugging missing traffic.

## `analysis.json` Top-Level Structure

```
{
  "version": 2,
  "site": "...",
  "sourceUrl": "...",
  "generatedAt": "...",
  "summary": { ... },          // ~10 lines - READ THIS FIRST
  "navigation": [ ... ],       // page-level request groups - SKIP
  "samples": [ ... ],          // HUGE - every labeled request - DO NOT READ
  "clusters": [ ... ],         // ~20-100 lines per cluster - READ FOR COVERAGE
  "authCandidates": [ ... ],   // ~10-30 lines - READ FOR AUTH REVIEW
  "extractionSignals": [ ... ],// ~5-20 lines - READ if SSR suspected
  "ws": { ... }                // optional WS analysis - READ if WS expected
}
```

## Review Order

1. Summary signals — quick health check
2. Auth candidates — does detected auth match expectations?
3. Clusters — map target intents to detected operations
4. Extraction signals — SSR data availability
5. WebSocket analysis — if WS traffic expected
6. Coverage decisions — continue, re-capture, or stop?

## Summary Signals

Use offset/limit to read just the first ~30 lines (covers `version` through
`summary`):

- `summary.byCategory.api` — how many requests were labeled as API calls?
  If zero or very low, the capture missed target traffic.
- `summary.byCategory.off_domain` — if high, your API may live on a different
  domain (e.g., `chatgpt.com` calls `api.openai.com`). Re-compile using the
  API domain as the site URL instead.
- `summary.clusterCount` — how many candidate operations were found?

## Auth Candidates

> Before reading: scan `references/knowledge/auth-patterns.md` "Routing Table"
> to know what auth type to expect for this site's archetype.
> Chinese sites: expect `cookie_session`, possibly with custom signing.
> Google properties: expect `sapisidhash`.
> Public APIs: expect no auth (confidence 0).
> SPA with login: expect `localStorage_jwt` or `exchange_chain`.

Search for `"authCandidates"` in `analysis.json`. Read that array. Check the
top candidate (rank 1):

- **`auth.type`** — does it match your expectation from the knowledge file?
- **`confidence`** — above 0.7 is reliable. Below 0.5 is suspect.
- **`evidence.matchedCookies`** — are these real auth cookies or tracking cookies?
  Known tracking cookies (`__cf_bm`, `_ga`, `__gads`, `datadome`) should NOT
  appear. If they do, the detection has a false positive — the tracking cookie
  denylist may need updating.
- **`csrf`** — is CSRF detected? Social sites with write ops usually need it.
  Check `csrf.type` (`cookie_to_header` or `meta_tag`) and the cookie/header names.
- **`evidence.notes`** — human-readable explanation of why this auth was detected.

If `authCandidates` is empty or has only `confidence: 0` entries, no auth was
detected. Expected for public APIs; a red flag for sites that require login.

**If auth looks wrong:** note what needs changing — you will edit the spec's
`servers[0].x-openweb` section during curation. See
`references/knowledge/x-openweb-extensions.md` for the complete extension schema.

### Confidence and Evidence

- Above 0.7 — reliable, auto-curation's choice is likely correct.
- 0.3–0.7 — suspect. Cross-reference with knowledge file expectations.
- Below 0.3 or 0 — no meaningful auth detected. Expected for public APIs;
  investigate if the site requires login.

### CSRF Troubleshooting

The auto-detected CSRF may be wrong. Check `authCandidates[0].csrfOptions` in
analysis.json — it lists ALL cookie-to-header matches ranked by confidence.

Common false positives:
- Locale cookies (e.g., `lc-main=en_US` → `x-li-lang: en_US`) — short values, not tokens
- Preference cookies — browser settings forwarded as headers

How to identify the real CSRF:
- Look for headers named `csrf-token`, `x-csrf-token`, `x-csrftoken`
- Look for cookies named `JSESSIONID`, `csrftoken`, `_csrf`
- Real CSRF tokens are long random strings (>10 chars), not short words

To override: create a curation file and re-compile:
```bash
echo '{"csrfType": "cookie_to_header"}' > curation.json
openweb compile <site-url> --capture-dir <dir> --curation curation.json
```

If re-compiling is not needed, manually edit the generated spec's `csrf` section
in `openapi.yaml` directly.

### Tracking-Cookie False Positives

Cloudflare, GA, Meta pixel cookies trigger `cookie_session` detection. Check
`authCandidates[].evidence.matchedCookies` for tracking cookie names (`__cf_bm`,
`_ga`, `__gads`). If these are the only matched cookies, the auth candidate is
a false positive. Check if a lower-ranked candidate is better, or if the site
is actually public (no auth needed).

## Clusters

> For GraphQL sites: read `references/knowledge/graphql-patterns.md` first —
> check the "Persisted Queries" and "Batched Queries" sections.

Search for `"clusters"` in `analysis.json`. Read that array.

### Mapping Target Intents to Clusters

Map each target intent to a cluster. If a target intent has no matching
cluster, it was not captured — return to `discover.md` for more browsing.

For each cluster, check:
- **`suggestedOperationId`** and **`suggestedSummary`** — what operation was detected?
- **`method` + `pathTemplate`** — the HTTP shape
- **`sampleCount`** — how many requests matched

### Path Normalization

- `/users/123` and `/users/456` should normalize to `/users/{id}`
- If different paths got incorrectly merged, `normalization.originalPaths`
  shows what was collapsed.

### GraphQL Collapse and Sub-Clusters

- **`graphql`** — present on GraphQL sub-clusters. Check:
  - `operationName` — does each query get its own cluster?
  - `discriminator` — how were sub-clusters split? (`operationName`, `queryId`,
    `persistedQueryHash`, or `queryShape`)
- A cluster with high `sampleCount` (100+) on a single path like `/graphql`
  with NO `graphql` sub-cluster metadata means all GraphQL operations collapsed
  into one cluster. Sub-clustering failed. Fix: return to capture and interact
  with more diverse features in the UI.

### 4xx-Only and Polling Signals

- **4xx-only clusters:** 401/403/404 clusters appear because the analyzer does
  not filter by status. These indicate auth-required endpoints or stale URLs —
  cross-reference with `authCandidates`.
- **Very high `sampleCount`** (100+) on a single path suggests:
  - GraphQL collapse (see above)
  - A polling endpoint (check if it is a real user-facing operation)
  - Analytics/tracking not filtered — should be excluded during curation
- **`parameters`** — auto-inferred parameters with types and example values.
  Check that required params are marked required and examples are sensible.
- **`responseVariants`** — status codes and content types observed.

Note which clusters to exclude and which names to change — you will apply
these edits during curation.

## Extraction Signals

> Read `references/knowledge/extraction-patterns.md` — check the "Decision Flow"
> to understand when extraction is preferred over API replay.

Search for `"extractionSignals"` in `analysis.json`. The array contains:
- `type: "ssr_next_data"` — Next.js `__NEXT_DATA__` found in HTML.
  `estimatedSize` tells you if there is real data or just a skeleton.
- `type: "script_json"` — `<script type="application/json">` blocks found.
  `selector` and `id` help locate the exact element.

The analyzer only auto-detects these two patterns. Other extraction types
require manual inspection:
- `page_global` (e.g., `window.__INITIAL_STATE__`) — check page source
- `__NUXT__` — check for `window.__NUXT__` or `window.__NUXT_DATA__`
- `html_selector` — when data is only in DOM elements, no JSON at all

If API clusters are weak (few samples, noisy responses) but the page has rich
SSR data, extraction may be the better approach. Note this for curation.

**SSR confirmation:** If `extractionSignals` contains entries and your target
intent's data is in SSR HTML rather than API calls, this confirms it. For
those intents, configure extraction during curation rather than API replay.

## WebSocket Analysis

> Read `references/knowledge/ws-patterns.md` — check "Curation Signals" to
> distinguish operations from noise.

Search for `"ws"` at the top level of `analysis.json`:
- `connections[].url` — is this a real data channel or just telemetry?
- `connections[].executableOperationCount` — are there meaningful WS operations?
- `connections[].heartbeatCandidates` — heartbeat interval and payload detected?
- `connections[].operations[]` — what patterns were found (`subscribe`, `stream`,
  `request_reply`, `publish`)?

Heartbeat-only connections and presence/typing-indicator channels are noise —
exclude them.

## Coverage Decisions

### Fill-Gap Checklist

If target operations are missing from the analysis:

- **No API calls for a feature?** Check if data comes from SSR. In the browser,
  view page source or use `page.evaluate(() => document.querySelector('#__NEXT_DATA__')?.textContent)`
  to check for embedded JSON.
- **API calls on a different domain?** Check `summary.byCategory.off_domain`.
  Re-compile with the API domain as the site URL.
- **Login required?** Open the target URL in the managed browser, log in there,
  then re-capture with authenticated browsing.
- **GraphQL single endpoint?** Try different queries in the UI — the analyzer
  needs varied `operationName` or `queryId` values to sub-cluster correctly.
- **Lazy loading?** Scroll down, click "load more", wait for content to appear.

### Stop-Iterating Rules

- After 2 capture iterations with no new clusters for a target intent, the
  intent may be infeasible with the current pipeline.
- If the site is flagged as BLOCKED in the archetype profile, stop immediately
  and tell the user.
- If bot detection blocks all transports (node returns 403, page returns
  challenge pages), document the blocker in DOC.md Known Issues and tell
  the user which intents could not be fulfilled.

### Common False Negatives

- **Auth not detected**: User was not logged in, or unsupported auth pattern.
  Check `authCandidates` — if the only candidate has `confidence: 0` and the
  `evidence.rejectedSignals` says "No cookie session overlap found", the user
  was probably not logged in during capture. Re-capture with login.
- **CSRF not detected**: Token embedded in JavaScript (not cookie/meta tag).
  Identify manually in browser dev tools and add to spec.
- **Operations missing**: Key pages not visited during capture. Return to
  `discover.md` for targeted browsing.
- **Cross-domain API**: Site calls a different domain. Check `summary.byCategory.off_domain`.
  Re-compile with the API domain or use a multi-server spec.
- **GraphQL collision**: Multiple operations collapsed into one cluster.
  Need capture with more varied queries. Check for missing `graphql` sub-cluster
  metadata.

## Related References

- `references/compile.md` — process doc that loads this reference at Review step
- `references/spec-curation.md` — curation guide loaded at Curate step
- `references/knowledge/auth-patterns.md` — auth primitive detection
- `references/knowledge/graphql-patterns.md` — GraphQL sub-clustering patterns
- `references/knowledge/extraction-patterns.md` — SSR/DOM extraction techniques
- `references/knowledge/ws-patterns.md` — WS connection/message patterns
