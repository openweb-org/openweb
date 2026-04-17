# Phase 3 Handoff — Extraction-Heavy Sites

Scope of this pass: the 13 extraction-heavy sites called out in the task
brief — boss, douban, ebay, etsy, goodreads, indeed, producthunt, redfin,
reuters, rotten-tomatoes, tripadvisor, yelp, zillow.

Strategy: convert per-operation extraction logic into spec
`x-openweb.extraction` blocks (`page_global_data`, `script_json`,
`html_selector`, `ssr_next_data`, `response_capture`) so the runtime drives
extraction directly. Remove `x-openweb.adapter` references on migrated ops.
Delete adapter files where all ops migrate; keep a thin adapter (using
`pageFetch` / `nodeFetch` / `ssrExtract` / `domExtract` / `jsonLdExtract`
helpers from `src/lib/adapter-helpers.ts`) where the extraction can't be
expressed declaratively.

## Outcome

| Site | Migrated to spec | Kept on adapter | Adapter file | Commit |
|---|---|---|---|---|
| ebay | 3/3 | 0 | deleted | 4db66b6 |
| douban | n/a (dead code) | n/a | deleted | b38e86b |
| yelp | 1/1 (searchBusinesses) | 0 | deleted | dc2062a |
| etsy | 4/4 | 0 | deleted | d16fffa |
| boss | 4/4 page ops | 0 | deleted | 04b4f82 |
| producthunt | 3/4 | 1 (getPost) | trimmed | 7075e96, fix aea53d3 |
| tripadvisor | 6/7 | 1 (searchLocation) | trimmed (586 → 117 lines) | cb44577 |
| zillow | 3/4 | 1 (searchProperties) | trimmed (404 → 177 lines) | 4ac2f3b |
| indeed | 5/8 | 3 (getSalary + 2 autocompletes) | trimmed (327 → 108 lines) | d1723ce |
| reuters | 0/4 | 4 (all) | refactored to `pageFetch` | 6ceadc5 |
| goodreads | 0/4 | 4 (all) | refactored to `nodeFetch` | 33ca3ce |
| rotten-tomatoes | 0/3 | 3 (all) | unchanged (already thin + `nodeFetch`) | — |
| redfin | 0/3 | 3 (all) | unchanged (already thin + `nodeFetch`) | — |

**Totals:** 29 ops moved to spec extraction across 8 sites; ~6 800 LOC of
adapter code removed. All 13 sites verify PASS via `pnpm dev verify <site>
[--browser]`. Per-site `DOC.md` and `PROGRESS.md` updated under commit
`f2e2105`.

## What could not convert, and why

### producthunt `getPost`
`page_global_data` expression couldn't reliably read
`window.__APOLLO_CLIENT__.cache.extract()` for individual post pages — the
Apollo cache wasn't always populated at the moment the extraction ran, even
with `page_plan.settle_ms`. The other 3 ops (homepage feed) read the same
cache reliably. Kept as a 1-op thin adapter that does explicit
`waitForTimeout(3000)` after `goto`.

### tripadvisor `searchLocation`
Adapter calls TypeAheadJson via browser-origin `fetch()` for autocomplete.
`page_global_data` blocks `fetch(`. Could be reframed as `response_capture`
if the autocomplete endpoint fires during a navigation, but the call is
explicitly POST-XHR, not navigation-triggered. Kept on thin adapter.

### zillow `searchProperties`
Search uses an internal `async-create-search-page-state` API plus a
region-id → slug mapping table; result handling needs body decode + region
expansion. No primitive composes that. Kept on thin adapter; PerimeterX
retry now centralised via `page_plan.warm: true` at the server level (also
covers the migrated detail ops).

### indeed `getSalary` + 2 autocompletes
- `getSalary` needs a free-form job title → URL slug transform
  (`lowercase + space→hyphen`) before substituting into `/career/{slug}/salaries`.
  Runtime `encodeURIComponent` substitution can't produce that slug.
- `autocompleteJobTitle` and `autocompleteLocation` use browser-origin
  `fetch()` against Indeed's JSON endpoints. Blocked from `page_global_data`.

### reuters (all 4 ops)
DataDome-gated PF API requires same-origin browser fetch; `page_global_data`
blocks `fetch(`. Adapter refactored to use the `pageFetch` helper but
otherwise unchanged. `getArticleDetail` was attempted as `page_global_data`
with `page_url: https://www.reuters.com{article_url}` but the runtime
percent-encodes the slashes in `{article_url}`, producing an invalid URL.

### goodreads (all 4 ops)
- `getBook`, `getReviews` extract `__NEXT_DATA__.props.pageProps.apolloState`
  but then walk `__ref` pointers and reshape Book/Work/Review entries.
  Returning the raw apolloState would be a massive shape regression and the
  reshape isn't expressible as a primitive path.
- `searchBooks`, `getAuthor` do regex over raw HTML — no primitive covers
  that. Adapter refactored from raw `fetch` to `nodeFetch` for SSRF +
  redirect + timeout guards.

### redfin (all 3 ops)
- `searchHomes`: JSONP-prefixed response (`{}&&...`), `resultCode` check, +
  `uiPropertyType` enum decode. No primitive does body transform.
- `getPropertyDetails`: multiple LD+JSON blocks, must filter by `@type`
  containing `RealEstateListing`; `script_json` returns first match only.
- `getMarketData`: regex over stripped-text HTML.

### rotten-tomatoes (all 3 ops)
LD+JSON covers half the fields; tomatometer scores live in
`<media-scorecard>` custom element slots scraped from raw HTML. `script_json`
alone would drop ~half the data. Already a thin `nodeFetch` adapter so left
as-is.

## Runtime gaps surfaced by this phase

1. **`page_url` `{token}` always `encodeURIComponent`s** — blocks any
   path-typed param that legitimately contains slashes (reuters `article_url`,
   plausibly BBC and similar). A `{token:path}` raw form, or `encodeURI`
   instead of `encodeURIComponent`, would unblock this class.
   File: `src/runtime/extraction-executor.ts:54-58`.

2. **`script_json` returns first match only, no `@type` filter** — blocks
   sites with multiple `<script type="application/ld+json">` blocks where
   the relevant one isn't first (redfin `getPropertyDetails`). Adding
   `type_filter` (or `entry_filter` for any field) to the `script_json`
   primitive would unblock this.

3. **No primitive for free-form HTML regex over node-fetched HTML** —
   redfin `getMarketData`, rotten-tomatoes search/scoring, goodreads
   search/author. These are inherently regex-shaped and don't fit any
   structured primitive. Two options: (a) accept thin adapters as the
   permanent home for this class, or (b) add an `html_regex` primitive
   that accepts a list of `{ field, pattern, group, transform }` entries.

4. **No body transform for response data** — JSONP prefix stripping (redfin),
   enum-int → string decoding (redfin), `unwrap` only supports a single dot
   path. Would benefit from a small expression-style `transform` on the
   declarative HTTP/extraction primitives (or a generalised post-processing
   pipeline).

5. **No multi-source merge / multi-call composition** — sites where one op
   needs to fetch two pages and merge (none in this batch hit it hard, but
   was previously called out for seeking-alpha, etsy multi-page reviews,
   etc.). Would unblock keeping more ops in spec.

6. **Apollo `__ref` resolution** — recurring pattern across producthunt,
   goodreads, several others. A purpose-built primitive
   (`apollo_state: { path, root_query?, follow_refs: true }`) would let many
   "Next.js + Apollo" sites drop their adapters entirely.

7. **Slug transforms for path params** — indeed `getSalary` needs
   `lowercase + space → hyphen`. Runtime substitution is verbatim
   `encodeURIComponent`. A per-parameter `x-openweb.encode: slug` (or
   similar) would help.

## Verification caveats

- All commits cite the per-site verify outcome inline. Re-runs may flake
  due to anti-bot (DataDome, PerimeterX, Cloudflare, indeed Cloudflare).
  When that happens: re-run `pnpm dev verify <site> --browser` against a
  warmed Chrome.

- **Stale shadow site copies bite hard**: `src/lib/site-resolver.ts`
  resolves in order `$OPENWEB_HOME/sites/` → registry → `dist/sites/` →
  `src/sites/`. During the indeed migration, copies cached at
  `~/.openweb/sites/indeed/` and `dist/sites/indeed/` masked the dev source
  and made verify run the pre-migration adapter. Future migrations: clear
  shadows before verify, or bake a "dev source priority" flag for
  contributors.

- `pnpm test` failures (~33) are pre-existing in this worktree from
  concurrent runtime/runner work (`src/runtime/adapter-executor.ts`,
  `instagram-api.ts`); not caused by this phase. `pnpm lint` clean.

## Hand-off checklist for next phase

- [ ] Decide whether to extend primitives per the gaps above (mostly
      `script_json` filtering + `page_url` raw-token + body transform).
- [ ] Run a full-fleet drift sweep (`pnpm dev verify --all`) to confirm no
      regressions on neighbouring sites that weren't in this batch.
- [ ] If primitives are extended, revisit reuters / redfin / rotten-tomatoes
      / goodreads to push more ops to spec.
- [ ] Update `doc/todo/normalize-adapter/inventory.md` to reflect new
      per-site adapter-op counts (currently still reads from the Phase 1
      classifier output).
