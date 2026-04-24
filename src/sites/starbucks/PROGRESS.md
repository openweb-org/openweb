## 2026-04-24: Userflow QA — response trimming and fixes

**What changed:**
- searchStores: moved back to adapter for response trimming — 130KB→70KB. Stripped `isFavorite`, `isNearby`, `isPrevious`, `recommendationReason`, `id`, `closingSoon`, `internalFeatures`, `regulations`, `warningLabels`, `acceptedCampusCardIssuers`, `acceptsNonSvcMop`, `marketBusinessUnitCode`, `timeZone`, `pickUpOptions`. Renamed `openStatusFormatted`→`openStatus`, `hoursStatusFormatted`→`hours`, `ownershipTypeCode`→`ownershipType`. Normalized address from `lines[]` to flat `streetAddress`.
- getMenu: moved back to adapter for response trimming — 150KB→76KB. Stripped `displayOrder`, `uri`, `id`, `heroCategoryImageURL`, `formCode`, `productNumber`, `defaultSize`. Flattened `sizes` from `[{sizeCode}]` to `["Tall","Grande"]`.
- getStoreDetail: unchanged — already adapter-backed with clean response.
- Removed `X-Requested-With` header parameter from spec — adapter handles it internally.
- Updated openapi.yaml response schemas to match trimmed output (removed `additionalProperties: true`).

**Why:**
- Blind userflow QA: 3 personas (commuter: SF stores + menu, student: Berkeley stores with Wi-Fi filter, gift buyer: browse menu items). All 3 ops functional. Main gap: raw BFF responses with internal/noisy fields bloating responses.

**Key files:** `src/sites/starbucks/adapters/starbucks.ts`, `src/sites/starbucks/openapi.yaml`.
**Verification:** `pnpm dev verify starbucks` — 3/3 PASS.

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

## 2026-04-17 — Phase 3 Pure-Spec Migration

**Context:** Phase 3 of normalize-adapter.
**Changes:** searchStores and getMenu moved to declarative OpenAPI:
- Real `/apiproxy/v1/locations` and `/apiproxy/v1/ordering/menu` paths in spec.
- `X-Requested-With: XMLHttpRequest` declared as parameter with default for searchStores.
- Response schemas relaxed to raw BFF shape with `additionalProperties: true`.
- getStoreDetail kept adapter-backed: upstream `/locations` returns an array filtered client-side by `storeNumber` — no declarative way to express that filter today.
- Adapter trimmed to export only getStoreDetail.
**Verification:** `pnpm dev verify starbucks` → 3/3 PASS (consistent across re-verify).
