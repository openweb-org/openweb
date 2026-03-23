# Redfin Fixture — Progress

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Created `redfin-fixture` with 3 operations: `searchHomes`, `getPropertyDetails`, `getRedfinEstimate`
- All operations use `page_global_data` extraction from SSR-rendered pages
- `searchHomes` extracts JSON-LD `SingleFamilyResidence` + `Product` pairs (~41 listings)
- `getPropertyDetails` extracts JSON-LD `RealEstateListing` with full property info
- `getRedfinEstimate` extracts DOM content from the AVM estimate section
- Added "Real Estate" archetype to `doc/knowledge/archetypes.md`
- Added Redfin to "Not Blocked" list in `doc/knowledge/auth-patterns.md`

**Why:**
- M26 milestone: expand site coverage to real estate vertical
- Redfin chosen as first real estate target — no bot detection, rich structured data

**Discovery notes:**
- Capture + compile pipeline produced "No filtered samples" — all Redfin API traffic (`/stingray/api/*`) was filtered as noise by the analyzer since the real data is SSR
- Manual fixture creation was required: examined page DOM, found JSON-LD as primary data source
- Fixed price range regex to handle `$1.1M` format (period in dollar amounts)
- Fixed schema to allow nullable comparable addresses

**Verification:** All 3 operations return correct data matching the visible page content. `pnpm build` exits 0. No schema warnings.
**Commit:** f8067b6
