# Etsy — Progress

## 2026-04-24 — Userflow QA: response trimming and fixes

**Context:** Blind userflow QA across 3 personas (gift shopper, home decorator, wedding planner). All 4 ops functional but several data quality issues found.
**Changes:**
- searchListings: capped results to 20 (was 60-65, 30KB→10KB).
- getListingDetail: fixed broken `image` field (`[object Object]` → proper URL via LD+JSON `contentURL`), added `lowPrice` fallback for custom/variant items where `offers.price` is null, added HTML entity decoding.
- getReviews: added HTML entity decoding for review text and author names.
- openapi.yaml schema: updated photos description (up to 5), price description (lowPrice fallback), description field (max 500 chars).
**Key discovery:** Etsy LD+JSON `product.image` is an array of `ImageObject` with `contentURL` (not `url`). `String()` coercion produced `[object Object]`.
**Verification:** `pnpm dev verify etsy` — 4/4 PASS. 12/12 persona calls succeed.

## 2026-04-17 — Phase 3 Normalize-Adapter

**Context:** Convert adapter-based ops to spec extraction primitives so the runtime drives extraction directly from `x-openweb.extraction` blocks.
**Changes:** All 4 ops (`searchListings`, `getListingDetail`, `getReviews`, `getShop`) migrated to `page_global_data` with embedded LD+JSON parsing and DOM fallback expressions in `openapi.yaml`. `adapters/etsy.ts` deleted; manifest updated.
**Verification:** 4/4 PASS via `pnpm dev verify etsy --browser`.
**Commit:** `d16fffa` — feat(etsy): migrate all 4 ops to spec extraction

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals
- openapi.yaml: version 1.0.0, compiled_at, build metadata, param examples, property descriptions, no bare type:object, review items required array
- All 4 example files present with replay_safety

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify etsy`

## 2026-04-09: Initial site package

**What changed:**
- Added Etsy site package with 4 operations: searchListings, getListingDetail, getReviews, getShop
- Adapter-based extraction using LD+JSON (schema.org) and DOM
- Page transport required — Cloudflare + PerimeterX + DataDome block direct HTTP

**Why:**
- New site request for handmade/vintage marketplace coverage

**Verification:** All 4 operations PASS runtime verify (searchListings, getListingDetail, getReviews, getShop)
