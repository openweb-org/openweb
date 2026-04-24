## 2026-04-24: Userflow QA — adapter rewrite, response trimming

**What changed:**
- Rewrote adapter from old interface (`init`/`execute`) to `CustomRunner.run(ctx)` — adapter was never loading, raw wire returned
- Renamed `grubhub.js` → `grubhub-read.ts` (convention match)
- Added `adapter:` blocks to openapi.yaml for all 3 operations with `adapter-verified` signal
- Response trimming now active: searchRestaurants 47KB→<2KB, getMenu 460KB→38KB, getDeliveryEstimate 6.6KB→<200B
- DOC.md: updated adapter reference, documented searchTerm limitation

**Gaps found (3 personas: student/Chinese, group/catering, dietary/gluten-free):**
- **Adapter not wired (critical):** old interface + no spec adapter blocks → raw wire returned
- **No response trimming:** 47–510KB payloads with internal fields exposed
- **searchTerm ineffective:** all 3 search terms return identical results; Grubhub API ranks by popularity/promotion, not searchTerm filtering (documented as known limitation)

**Verification:** `pnpm dev verify grubhub`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (## → ###), added Extraction subsection, deduplicated cents-to-dollars note
- openapi.yaml: version `1.0.0`, added `compiled_at`, `example` on all parameters, `description` on every property
- All 3 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify grubhub`

## 2026-04-09: Initial add — searchRestaurants, getMenu, getDeliveryEstimate

**What changed:**
- New site package: Grubhub (food delivery)
- 3 operations via adapter (L3): searchRestaurants, getMenu, getDeliveryEstimate
- Page transport (Cloudflare + PerimeterX + DataDome bot detection)
- API at api-gtm.grubhub.com, no auth required for reads

**Why:**
- Cover food delivery vertical alongside Uber Eats, DoorDash, Starbucks

**Verification:** API-level (browser fetch), content-level (real restaurant data), build
