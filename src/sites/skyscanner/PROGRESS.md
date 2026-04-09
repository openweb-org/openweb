## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- openapi.yaml: added `required` arrays to all response objects, `description` on every property, `example` on all parameters, `verified`/`signals` in build sections
- DOC.md: verified heading hierarchy and content — no changes needed
- All 3 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify skyscanner`

## 2026-04-09: Initial site package

**What changed:**
- Added 3 operations: searchFlights, getFlightDetail, getPriceHistory
- Adapter-based with page transport (heavy bot detection — Cloudflare, PerimeterX, DataDome)
- searchFlights/getFlightDetail use intercept pattern (navigate + capture radar API)
- getPriceHistory uses browser-side fetch to pricecalendar API
- Auto-resolves PerimeterX press-and-hold captcha

**Why:**
- New site addition — flight comparison and booking search engine

**Verification:** All 3 ops PASS via `pnpm dev verify skyscanner --browser`
