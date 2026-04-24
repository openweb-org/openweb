## 2026-04-24: Userflow QA — response trimming, rental schema, region expansion

**What changed:**
- **Adapter: response trimming** — searchProperties now strips non-schema fields from each listing
  (`carouselPhotosComposable`, `list`, `brokerName`, 20+ internal keys), caps results at 20, drops
  `searchList`/`relaxedResults`/extra `searchResults` keys. Response size: ~200KB → ~19KB (sale), ~14KB (rental).
- **Adapter: region expansion** — added 22 cities to `knownRegions` (San Jose, San Diego, Phoenix, Dallas,
  Nashville, Charlotte, Raleigh, Boston, Philadelphia, Minneapolis, Washington DC, Atlanta, Las Vegas,
  Salt Lake City, Indianapolis, Columbus, Tampa, Detroit, Pittsburgh, Sacramento, Kansas City, Orlando).
  Unknown regionIds previously fell back silently to San Francisco.
- **Adapter: rental normalization** — rental (building) listings trimmed to rental-specific fields
  (`minBaseRent`, `maxBaseRent`, `buildingName`, `availabilityCount`, `units`); sale-only fields
  (`price`/`beds`/`baths`/`area`) correctly absent.
- **Schema: required fields relaxed** — listResults items `required` changed from
  `[zpid, detailUrl, price, unformattedPrice, address, beds, baths, area, latLong]` to
  `[zpid, detailUrl, address, latLong]`. Rental listings never have sale-only fields.
- **Schema: rental fields added** — `buildingName`, `minBaseRent`, `maxBaseRent`, `availabilityCount`,
  `units[]` (beds, price) added to listResults item schema.
- **Schema: totalResultCount** — added to searchResults response (peer of listResults).
- **Detail: photo flattening** — extraction expression now resolves multi-resolution photo objects to
  single highest-resolution URL string. Response size: ~11KB → ~2KB.
- **Detail: description truncation** — capped at 500 chars to reduce response size.

**Why:**
- Blind userflow QA across 3 personas revealed rental schema breakage, missing regions, and
  excessive response sizes that would overflow agent context windows.

**Personas tested:**
1. Homebuyer — "homes for sale San Jose under $1M": searchProperties (20 results, San Jose city),
   getPropertyDetail, getZestimate, getNeighborhood all return data
2. Renter — "1BR apartment Austin TX": searchProperties (20 rental buildings w/ units, no schema warnings)
3. Investor — "multi-family homes Denver": searchProperties (20 results), chained detail/zestimate/neighborhood

**Known limitations:**
- `filterState` (price, beds) not applied — adapter navigates to city landing page, doesn't pass API filters
  (Zillow PerimeterX blocks the PUT search API). Results are Zillow's default sort for the region.
- walkScore/transitScore/bikeScore always null — loaded dynamically, not in __NEXT_DATA__
- nearbyHomes sometimes null depending on property
- zestimateHistory always null (not available in SSR data)

**Key files:** `adapters/zillow-detail.ts`, `openapi.yaml`

## 2026-04-17 — Phase 3 Normalize-Adapter (4ac2f3b)

**Context:** Move extraction logic from adapter handlers into spec `x-openweb.extraction` blocks so the runtime can drive extraction directly.
**Changes:**
- `getPropertyDetail`, `getZestimate`, `getNeighborhood` → migrated to `page_global_data` (`__NEXT_DATA__` → `gdpClientCache` → `value.property`); per-op projection in the spec expression
- `searchProperties` → kept on `zillow-detail` adapter (regionId → city-slug translation + region landing page navigation; complex search state)
- Added server-level `page_plan.warm: true` so the runtime's generic PerimeterX retry (about:blank → clearCookies → retry) covers the spec-extraction ops; adapter retains its own `navigateWithPxRetry` for `searchProperties`
- Adapter shrunk from ~410 lines to ~173 lines; removed propertyCache (no longer needed since detail ops are spec-driven)
**Verification:** 4/4 PASS via `pnpm dev verify zillow --browser`.
**Key discovery:** `page_plan.warm: true` is the right hook for sites where the first navigation usually trips a bot wall — the runtime handles the warm-up + retry generically, so each spec op no longer needs a custom adapter wrapper.

## 2026-04-14 — Fix PerimeterX stale page crash during verify

**Context:** `pnpm dev verify zillow` crashes with `Cannot find parent object page@... to create disposable@...` — verify warm-up navigates to zillow.com before the adapter runs, triggering PX CAPTCHA which closes the CDP tab. The adapter then tries to use the stale page object.

**Changes:**
- Added `isStalePage()` helper — detects `Cannot find parent object`, `has been closed`, `Target closed` error patterns
- `adapter.init()` now wraps `page.title()` in try-catch; on stale page error, recovers via `about:blank` + `clearCookies()`
- `navigateWithPxRetry()` now uses try-catch on `page.goto()` instead of `.catch(() => {})`; on stale page error, blanks + clears and continues to next retry attempt

**Verification:** `pnpm dev verify zillow` → 4/4 PASS, `pnpm build` clean

**Key discovery:** The `.catch(() => {})` pattern on `page.goto()` silently swallowed stale page errors, making the function return `true` (success) with a broken page. Subsequent `page.evaluate()` calls then crashed. The fix uses try-catch to distinguish stale page errors (which need recovery) from other navigation errors (which can be ignored).

## 2026-04-13 — Transport downgrade: GraphQL API → __NEXT_DATA__ SSR extraction

**Context:** All 4 ops failing verify — PerimeterX now blocks all programmatic fetch calls to `/graphql/` (both `page.evaluate(fetch())` and `page.request.fetch()` return 403 with CAPTCHA HTML). Previous adapter used GraphQL persisted query via in-page fetch.

**Changes:**
- Rewrote `adapters/zillow-detail.ts` from GraphQL API calls to page navigation + `__NEXT_DATA__` extraction
- Added `navigateWithPxRetry()` — about:blank → clearCookies → retry pattern (up to 4 attempts)
- Added `propertyCache` — same zpid reuses extracted data across getPropertyDetail/getZestimate/getNeighborhood
- Moved searchProperties from transport:page (executeBrowserFetch) to adapter — navigates to search page URL + extracts `searchPageState` from `__NEXT_DATA__`
- Updated `openapi.yaml` — added adapter reference to searchProperties
- `adapter.init()` clears cookies if current page shows CAPTCHA (handles verify warm-up poisoning)
- Fixed `zestimateLowPercent`/`zestimateHighPercent` type coercion (string from SSR → number for schema)

**Verification:** `pnpm dev verify zillow --browser` → 4/4 PASS

**Key discovery:** PerimeterX on Zillow blocks ALL programmatic API calls — `page.evaluate(fetch())`, `page.request.fetch()`, and direct HTTP. Only full page navigation works. The verify warm-up (autoNavigate to site URL) poisons PX session — adapter must detect CAPTCHA page and reset via about:blank + clearCookies. First 1-2 navigation attempts after browser start typically CAPTCHA; retries succeed after cookie reset.

**Pitfalls encountered:**
- `page.request.fetch()` (Costco pattern) doesn't bypass Zillow's PX — their PX validates at network/cookie level, not just JS interception
- `clearCookies({ domain: '.zillow.com' })` insufficient — must use `clearCookies()` (all cookies) for reliable reset
- Must navigate to `about:blank` before clearing cookies — clearing while on CAPTCHA page doesn't reset PX state
- Verify warm-up navigates to site before adapter runs, creating stale CAPTCHA page; adapter init must handle this

## 2026-04-09: Polish zillow site package

**What changed:**
- Fixed DOC.md heading levels (Site Internals subsections now `###`)
- Added `required` arrays to all 4 response schemas — top-level and nested objects (address, latLong, regionInfo items, school items, nearbyHome items, zestimateHistory items)
- Added `description` on every property at every nesting level — no bare type-only fields
- Added `example` values to all path parameters (zpid, slug)
- Added `verified: true` and `signals: [adapter-verified]` to adapter build sections; `signals: [page-verified]` for searchProperties
- Added `replay_safety: "safe_read"` to all 4 example files
- Fixed `requires_auth` mismatch in manifest.json (`true` → `false` to match openapi.yaml)

**Why:**
- Quality checklist: no bare type:object, required where data always present, complete property descriptions, examples on parameters, replay_safety on examples
- Enhanced site (1→4 ops): getPropertyDetail, getZestimate, getNeighborhood schemas fully hardened

**Key files:**
- `src/sites/zillow/openapi.yaml` — schema hardening across all 4 ops
- `src/sites/zillow/DOC.md` — heading level fix
- `src/sites/zillow/manifest.json` — requires_auth fix
- `src/sites/zillow/examples/*.example.json` — replay_safety added

**Verification:** pnpm build, pnpm dev verify zillow

## 2026-04-06: Initial site package

**What changed:**
- Created zillow site package with 1 operation: searchProperties
- PUT /async-create-search-page-state — search properties by location, price, beds/baths
- Page transport (PerimeterX blocks node HTTP)
- cookie_session auth (search works without login)
- Added example fixture for San Francisco search
- Response schema covers listResults and mapResults with property details

**Why:**
- Zillow's SPA search API provides structured property data (address, price, beds, baths, sqft, zestimate, lat/lng, photos)
- PerimeterX bot detection requires page transport with real Chrome profile
- Search does not require login (`requires_auth: false`), though logged-in users get personalized results

**Verification:** compile-time verify (page transport ops pending browser verify)

## 2026-04-05: Verify fixes

**What changed:**
- Created examples/searchProperties.example.json (San Francisco search fixture)
- Fixed requires_auth mismatch: manifest.json said `true`, openapi.yaml said `false` — aligned to `false`
- Created PROGRESS.md

**Verification:** `openweb verify zillow --browser` → `auth_expired` (expected — needs `openweb login zillow` for active session)
