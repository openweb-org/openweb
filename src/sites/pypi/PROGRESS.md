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
