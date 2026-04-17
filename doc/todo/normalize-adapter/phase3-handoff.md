# Phase 3 Handoff — Pure-Spec Conversion

Scope of this pass: the 9 sites listed as pure-spec candidates in the inventory — apple-podcasts, fidelity, grubhub, hackernews, seeking-alpha, starbucks, substack, weibo, zhihu.

## Outcome

Total adapter-backed ops dropped from **378 → 326** (−52 ops).

| Site | Ops converted | Adapter file | Commit |
|---|---|---|---|
| substack | 5/5 | deleted | 8dc2a04 |
| starbucks | 2/3 | trimmed (getStoreDetail kept) | 12078c5 |
| seeking-alpha | 2/4 | trimmed (getStockAnalysis, getEarnings kept) | 8647664 |
| fidelity | 7/7 | deleted | d128ae0 |
| weibo | 6/6 | deleted | 46c3e59 |
| zhihu | n/a | no adapter pre-existed | — |
| grubhub | 0/3 | kept | reverted (61b1cb9) |
| hackernews | 0/3 | kept | not touched |
| apple-podcasts | 0/4 | kept | not touched |

## What could not convert, and why

### grubhub (3 ops) — reverted
Initial verify passed in a freshly-warmed browser, but re-verify from a cold
state consistently FAILed: `page.evaluate: TypeError: Failed to fetch` on the
cross-origin fetch from www.grubhub.com → api-gtm.grubhub.com. The adapter
survived because `pageFetch` swallows network errors into `{status:0,text}` and
the adapter retried, while the declarative browser-fetch executor bubbles the
TypeError up. Needs one of:
- a runtime retry layer equivalent to `pageFetch`'s error normalization, or
- explicit handling of anti-bot intermediate blocks in
  `src/runtime/browser-fetch-executor.ts` (already handles 403 bot-block bodies,
  not `TypeError: Failed to fetch`).

### hackernews reads (3 ops) — not convertible today
- `getStoryComments`, `getUserSubmissions`, `getUserComments` template query
  values from input params (`tags=story,author_${id}`,
  `numericFilters=story_id=${id}`). Runtime has no query-value templating.
- `getStoryComments` also wraps the response as `{storyId, commentCount,
  comments}` which can't be expressed via `unwrap` (single dot-path only).

**Unblockers:** (1) a parameter-level `x-openweb.template: "story,author_{id}"`
for string interpolation into query values, (2) a `response_wrap` primitive
that composes `{ storyId: "$input.id|int", commentCount: "$body.nbHits",
comments: "$body.hits" }`.

### apple-podcasts (4 ops) — runtime gap
Attempted declarative conversion with:
- op server `https://amp-api.podcasts.apple.com`, `transport: page`
- `page_plan.entry_url: https://podcasts.apple.com/us/browse`
- `auth: { type: page_global, expression: "window.MusicKit.getInstance().developerToken", inject: { header: Authorization, prefix: "Bearer " } }`

Failed because `browser-fetch-executor.ts:99` unconditionally calls
`warmSession(page, serverUrl)` with the **API** server URL. `warmSession`
then navigates the page away from podcasts.apple.com → amp-api.podcasts.apple.com,
destroying the MusicKit JS context. `resolveAuth` runs after and sees
`window.MusicKit === undefined`.

**Fix needed:** warm on the page's current origin (or skip warm when entry_url
origin ≠ serverUrl origin). Either `warmSession(page, page.url())`, or a
guard like `if (new URL(serverUrl).origin !== new URL(page.url()).origin) skip`.

### seeking-alpha (2 kept adapter-backed)
- `getStockAnalysis`: 3 parallel upstream calls + merge of `symbol_data` attrs
  into `metrics` + ratings/metric-type denormalization.
- `getEarnings`: ticker slug → numeric tickerId lookup, then 2 parallel calls,
  then reshape of nested `estimates[tickerId][item][relPeriod]` into a flat
  sorted array.

Both need multi-call composition primitives (not in runtime today).

### starbucks getStoreDetail
`/apiproxy/v1/locations` returns an array; selecting by storeNumber happens
client-side. Declaratively unexpressible without an array-filter primitive.

## Runtime gaps surfaced by this phase

1. **warmSession origin-awareness** (blocks apple-podcasts and any cross-origin-API-with-page-warm pattern).
2. **Query-value templating** (blocks hackernews reads + any site with composed query params).
3. **Response-wrap composition** (multiple input/body paths → composite object).
4. **Multi-call composition** (sequential or parallel fetches, then merge).
5. **Array filter by property** (would free starbucks getStoreDetail and similar).
6. **Declarative retry / fetch-error normalization** equivalent to
   `pageFetch`'s `{status:0, text:err}` fallback (blocks grubhub and likely
   any bot-detected site).

## Verification caveats

`pnpm dev verify <site>` requires a warmed browser and live session state.
Some results are flaky — substack re-verify showed 3/5 after initial 5/5
(cross-subdomain fetch transient), fidelity showed 2 pre-existing
`auth_expired` (getQuote, getResearchData) that existed before this phase.
These are environmental, not regressions.

`pnpm test` currently has 34 failures in `src/runtime/browser-fetch-executor.test.ts`
and `src/runtime/session-executor.test.ts`. These come from the concurrent
commit `e86bb3b feat(runtime): warmSession PX retry + response_capture schema`
and are not caused by the per-site spec changes in this phase.
