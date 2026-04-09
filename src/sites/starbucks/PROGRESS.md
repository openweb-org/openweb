## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- PROGRESS.md: created
- openapi.yaml: added `required` arrays to all nested response objects, `description` on every property, `example` on all parameters
- All 3 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify starbucks`

## 2026-04-09: Initial site package

**What changed:**
- Added 3 operations: searchStores, getStoreDetail, getMenu
- Adapter-only package — store finder via BFF API proxy, menu via ordering API
- Page transport for all operations (Cloudflare + Akamai + PerimeterX + DataDome bot detection)

**Why:**
- Net-new site addition per add-site guide

**Verification:** adapter-verified against live site (search, detail, menu)
