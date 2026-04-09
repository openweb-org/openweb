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
