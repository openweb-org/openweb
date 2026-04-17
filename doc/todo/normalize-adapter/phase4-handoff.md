# Phase 4 Handoff — GraphQL Persisted + Capture-Simple Migrations

Scope of this pass: the four sites named in the Phase 4 task — **booking**, **costco**, **goodrx**, plus one proof site from the capture-simple / graphql-persisted buckets — riding the `graphql_hash`, `response_capture`, `script_json`, and `page_global_data` infrastructure laid down in commits b8b47413..bfda872.

## Outcome

| Site | Ops migrated | Adapter | Commit | Verify |
|---|---|---|---|---|
| goodrx | 3/3 | deleted | 67c05fd | 3/3 PASS (live `pnpm dev verify goodrx --browser`) |
| tiktok (getExplore) | 0/1 | restored | 019f878 → 8f1f469 (revert) | n/a — out of scope, see below |
| booking | 0/5 | kept | not touched | deferred — see below |
| costco | 0/14 | kept | not touched | deferred — see below |

Plus one runtime improvement landed during the goodrx work:

- **e86bb3b feat(runtime): warmSession PX retry + response_capture schema** — generalizes the adapter's hand-coded PerimeterX retry into `warmSession`, and registers `response_capture` in `primitive-schemas.ts` (it was being accepted only by lazy validation).

Total adapter-backed ops dropped by 3 in this pass (377 → 374; current global total 323 reflects parallel Phase 3 + Phase 5 work landing concurrently).

## What worked

### goodrx (3/3 → spec-only)
All three ops moved onto `extraction.type: page_global_data` with inline JS expressions ported from the adapter's DOM-scrape paths. Server-level `page_plan: { warm: true }` replaces the adapter's PerimeterX warm-up. Adapter file deleted (200 LoC removed).

Key change to make this work: **`warmSession` now retries on PX block.** The first verify pass returned `bot_blocked 0/3` because the runtime `warm: true` previously did only a 3 s fixed delay; the PX challenge survived. Extending `warmSession` with `detectPageBotBlock` + `clearCookies` + re-`goto` in a 3-attempt loop flipped the same spec to PASS 3/3 with zero spec changes. This generalizes for any site that wants `page_plan: { warm: true }` against a PX-gated page.

### response_capture schema entry
`primitive-schemas.ts` was missing the `response_capture` `oneOf` branch. Bilibili `searchVideos` slipped through on lazy validation; the moment a second site tried it (tiktok), validation tripped. Added the schema entry — `type` + `match_url` required, `page_url`/`unwrap` optional.

## What could not convert, and why

### tiktok getExplore (reverted) — not actually capture-simple
Inventory bucket "capture-simple" is a URL-shape heuristic and over-counts here. tiktok's read intercepts work in the adapter only because the adapter calls them via `interceptApi` on the **patched** page where `window.fetch` is monkey-patched with X-Bogus / X-Gnarly / msToken / ztca-dpop signing. response_capture's `forceFresh: true` opens a fresh blank page and navigates from there — no patched fetch, no signing, no `/api/*/item_list/*` request ever fires. Spec migration is unavailable until the runtime can either:
- Re-use an existing site-warmed page for response_capture (lose the listener-before-goto safety), or
- Inject the X-Bogus signing as a runtime primitive.

For now: any tiktok read keeps its custom adapter. The bucket classifier should learn to demote sites with `signing` or `interceptApi`+patched-fetch evidence out of capture-simple.

### booking (5 ops kept) — primitive gap
- `getHotelDetail` is the only LD+JSON op, but `script_json` returns the **first** matching `<script>` tag and Booking has many `script[type="application/ld+json"]` blocks; the adapter walks them looking for `@type === 'Hotel'` and reshapes (`aggregateRating.ratingValue → rating`, address flattening). Pure spec needs (1) multi-match + filter on `script_json`, and (2) a response-transform primitive for the reshape.
- `searchHotels` (Apollo cache walk), `getHotelReviews` / `getHotelPrices` (page-evaluated GraphQL fetches against `/dml/graphql`), `searchFlights` (DOM) — all stay custom per task scope.

### costco (14 ops kept) — needs response-transform primitive
Every op reshapes the upstream API response: flattens `attributes[]` into `{key: value[]}`, builds `address.{street,city,state,zip}` from disparate nested fields, maps service codes (`pharmacy`/`gas`/`auto`/`food-court`), filters `programTypes`, etc. None of this is expressible declaratively. The ops that come closest to passthrough (`addToCart`, `removeFromCart`, `updateCartQuantity`) still wrap a query-string POST through `cartRequest` with specific `ajaxFlag` + Referer semantics.

Until a response-transform primitive lands, costco stays adapter-backed.

### airbnb graphql_hash — wrong APQ flavor
`getListingAvailability` and `getListingReviews` are tagged `graphql-persisted` in the inventory, but airbnb uses **Relay-style GET APQ** — hash + variables + extensions encoded as URL query params (`/api/v3/{OperationName}/{hash}?variables=...&extensions=...`). The current `graphql_hash` field only injects into POST body (`extensions.persistedQuery.sha256Hash`). Migrating airbnb requires extending `graphql_hash` to support GET-encoded APQ.

## Runtime gaps surfaced by this phase

1. **Multi-match + filter on `script_json`** (selector, `match: { "@type": "Hotel" }`, return first valid match). Unblocks booking `getHotelDetail` and any LD+JSON site with multiple typed blocks.
2. **Response-transform primitive** (declarative `mapping: {a: "$.x.y", addr: {street: "$.address.line1"}}` or similar). Unblocks costco and the booking Hotel reshape, and would be load-bearing for many Phase-5 candidates.
3. **GET-flavored APQ** for `graphql_hash` (URL-encoded `variables` + `extensions` instead of POST body). Unblocks airbnb.
4. **Patched-fetch reuse** for `response_capture` — option to attach the listener to an already-warmed signing-enabled page instead of forceFresh. Unblocks tiktok-style read intercepts.
5. **Bucket classifier refinement** — capture-simple should exclude sites with signing/CSRF evidence so the inventory doesn't over-promise.

## Verification caveats

- `pnpm dev verify goodrx --browser` — 3/3 PASS confirmed live.
- `pnpm test` — 34 failures pre-existing (patchright mock gaps in `session-executor.test.ts`, `browser-fetch-executor.test.ts`, `adapter-executor.test.ts`, `extraction-executor.test.ts`). The warm-session changes added **1 new failure** in `browser-fetch-executor.test.ts` (a test that previously errored on `page.addInitScript` now errors on `No open page matches https://example.com/` — same root cause, different surface). Worth a follow-up to update the mock to expose the page lookup, but not a behavior regression.
- `pnpm lint` — clean.
- Live verify against booking/costco was not attempted (deferred per task scope; both still adapter-backed and unchanged).

## Files touched

- `src/sites/goodrx/openapi.yaml` — 3 ops rewritten with `page_global_data` + server-level `warm: true`.
- `src/sites/goodrx/adapters/goodrx-web.ts` — deleted.
- `src/sites/goodrx/DOC.md` — Transport / Extraction / Known Issues sections rewritten to reflect spec-only model.
- `src/sites/goodrx/PROGRESS.md` — appended 2026-04-17 entry.
- `src/runtime/warm-session.ts` — added `botRetries` option, default 3, with `detectPageBotBlock` + `clearCookies` + re-`goto` loop.
- `src/types/primitive-schemas.ts` — added `response_capture` to `ExtractionPrimitive` `oneOf`.
- `skill/openweb/knowledge/bot-detection.md` — annotated the PerimeterX stale-session-reset entry to note the runtime now does this automatically under `page_plan: { warm: true }`.
