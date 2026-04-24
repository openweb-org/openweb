# eBay — Progress

## 2026-04-24: Userflow QA — CAPTCHA resilience, response trimming, bot-detect

**What changed:**
- All 3 ops converted from L2 spec extraction to L3 adapter — eBay redirects to
  `/splashui/challenge` (auto-resolving JS challenge, ~10s) on search/detail
  pages; spec extraction ran before challenge resolved, returning empty results
- searchItems: capped at 15 items (fits 4096-byte inline gate), deduped by
  itemId, dropped `image` field (lazy-loaded placeholder)
- getItemDetail: HTML entity decoding for LD+JSON title (`&#039;` → `'`),
  images capped at 5, added brand/model from LD+JSON, shipping/returns from
  LD+JSON `shippingDetails`/`merchantReturnPolicy` with DOM fallback
- getSellerProfile: categories capped at 5 (was 10)
- bot-detect.ts: added eBay challenge signals — `/splashui/challenge`,
  `/splashui/captcha` URL patterns; "pardon our interruption", "checking your
  browser", "security measure" title patterns
- Deleted stale compiled `adapters/ebay.js` (leftover from Phase 3 migration)

**Why:**
- L2 extraction fired on the CAPTCHA page (title "Pardon Our Interruption"),
  returning `{resultCount:0,items:[]}` with no error — bot-detect didn't
  recognize eBay's challenge pages
- `/splashui/challenge` (search/detail) auto-resolves via JS in ~10s;
  `/splashui/captcha` (seller store) requires manual hCaptcha — adapter's
  `waitForSelector` rides through the auto-resolve; hCaptcha triggers clear
  `bot_blocked` error
- 70+ search results exceeded inline gate; duplicate items from multiple
  page sections inflated count

**Key files:** `adapters/ebay.ts` (new), `openapi.yaml`, `manifest.json`,
  `src/runtime/bot-detect.ts`
**Verification:** searchItems "vintage mechanical watch" → 15 items inline;
  getItemDetail → brand/model/shipping populated, title entity-decoded;
  getSellerProfile → clear `bot_blocked` when hCaptcha triggers

## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Convert adapter-based ops to spec extraction primitives so the runtime drives extraction directly from `x-openweb.extraction` blocks.
**Changes:** All 3 ops (`searchItems`, `getItemDetail`, `getSellerProfile`) migrated to `page_global_data` (LD+JSON for item detail, DOM for search/seller). `adapters/ebay.ts` deleted; manifest updated.
**Verification:** 3/3 PASS via `pnpm dev verify ebay --browser`.
**Commit:** `4db66b6` — feat(ebay): migrate to spec extraction — delete adapter

## 2026-04-09: Polish site package

**What changed:**
- openapi.yaml: added `compiled_at`, per-op `build` metadata (stable_id, signals), embedded extraction expressions
- openapi.yaml: added `required` arrays and descriptions on all nested objects — no bare `type: object` remaining
- openapi.yaml: added `example` values on all parameters
- DOC.md: fixed heading hierarchy (Site Internals subsections now ### not ##)

**Verification:** `pnpm build && pnpm --silent dev verify ebay`

## 2026-04-09: Initial site package

**What changed:**
- Added eBay as new site with 3 operations: searchItems, getItemDetail, getSellerProfile
- Adapter-based package using page transport with DOM/LD+JSON extraction
- All operations verified PASS

**Why:**
- eBay is a major e-commerce platform with no prior OpenWeb support

**Verification:** All 3 ops pass verify (searchItems, getItemDetail, getSellerProfile). Build passes.
