## 2026-04-09: Polish — docs, schema, examples, adapter bug fix

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (subsections now ###)
- openapi.yaml: added param examples, descriptions on all nested objects (no bare type:object)
- All 3 example files present with replay_safety
- PROGRESS.md: created
- Adapter: fixed missing `errors` arg in 4 checkBotBlock() calls (caused runtime crash)

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify wayfair` — 2/3 PASS, getProductDetail bot_blocked (PerimeterX CAPTCHA, expected for quarantined page site)

## 2026-04-09: Initial add — 3 operations

**What changed:**
- Added Wayfair site with 3 operations: searchProducts, getProductDetail, getReviews
- All operations use page transport with wayfair-web adapter (DOM extraction)
- PerimeterX bot protection requires browser context — navigation via window.location.href
- No auth required for public product data

**Why:**
- Wayfair is the largest online-only home furnishing retailer — product search, pricing, specs, and reviews

**Verification:** 3/3 PASS with `pnpm --silent dev verify wayfair`
