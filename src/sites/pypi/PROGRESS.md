## 2026-04-24: Userflow QA — adapter, response trimming, schema fixes

**Personas tested:**
1. Data scientist finding a library (pandas, polars)
2. DevOps checking compatibility (flask across versions)
3. Researcher finding ML tools (transformers, torch)

**Friction found & fixed:**

| # | Gap | Classification | Fix |
|---|-----|---------------|-----|
| 1 | getPackage returned ~80KB for pandas (full README in `description`, deprecated `downloads`, 60KB license text) | response bloat | Added adapter that selects only documented fields |
| 2 | `license` field contained full license text (61KB for pandas) instead of identifier | wrong data | Adapter extracts `license_expression` or first line of `license` text |
| 3 | `home_page` null for many packages despite `project_urls.homepage` existing | missing data | Adapter resolves `home_page` from `project_urls` fallback |
| 4 | getReleases returned 1.4MB for pandas (2261 file entries with hashes/URLs) | response bloat | Adapter returns only `name` + `versions` array (1.2KB) |
| 5 | getPackageVersion missing `upload_time` (unwrapped away from `urls` array) | missing data | Adapter extracts `upload_time` from `urls[0]` |
| 6 | getReleases required user to pass `Accept` header (hidden complexity) | param opacity | Adapter handles header internally; removed from params |
| 7 | Schema described `license` as "identifier" but field is often full text | wrong data description | Updated schema description |

**Not fixable:**
- No search operation — PyPI deprecated XML-RPC search, no replacement API exists

**Size improvements:**
- getPackage (pandas): 80KB → 4.4KB (18x reduction)
- getReleases (pandas): 1.4MB → 1.2KB (1166x reduction)
- getReleases (flask): 56KB → 0.8KB (70x reduction)

**What changed:**
- Created `adapters/pypi.ts` — curated field selection for all 3 ops
- Updated openapi.yaml — adapter refs, removed `unwrap: info`, bumped tool_version to 2
- Added `upload_time` to getPackageVersion schema
- Updated DOC.md — transport notes, known issues
- Removed `Accept` header param from getReleases (adapter handles it)
- Removed `files` array from getReleases schema (versions-only)

**Verification:** `pnpm build && pnpm dev pypi getPackage '{"package":"pandas"}'` — 4.4KB curated response

## 2026-04-09: Polish site package — schemas, docs, verify

**What changed:**
- Added property descriptions to getPackageVersion response schema (was missing vs getPackage)
- Added `summary` to getPackageVersion required fields (matches getPackage pattern)
- Fixed bare `type: object` on `project_urls` — added `additionalProperties: { type: string }`
- Added `required: [filename, url]` to getReleases file items schema
- Created PROGRESS.md

**Why:**
- Pass all three verify dimensions (spec, doc, runtime) per verify.md checklist

**Verification:** `pnpm build && pnpm --silent dev verify pypi`
