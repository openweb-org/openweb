## 2026-03-26: Expand coverage from 2 to 6 ops

**What changed:**
- Added getPackageVersion (specific version metadata)
- Added getDistTags (latest, next dist-tags)
- Added getDownloadStats (total downloads via api.npmjs.org)
- Added getDownloadRange (daily download counts via api.npmjs.org)
- Uses per-operation server override for api.npmjs.org endpoints
- Updated DOC.md with all 6 operations

**Why:**
- Expand npm coverage beyond basic search/metadata to include version details and download statistics

**Verification:** All 6 operations PASS via `openweb verify npm`

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 2 verified operations against public npm registry API

**Verification:** spec review only — no new capture or compilation
