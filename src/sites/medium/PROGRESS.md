## 2026-04-01: Fresh rediscovery — 13 ops via GraphQL adapter

**What changed:**
- Rediscovered Medium from scratch with fresh capture
- 13 operations: 10 read (7 GraphQL, 2 DOM, 1 GraphQL detail), 3 write
- Added `getArticle` operation (single post by ID) — replaces prior `getPublicationPosts`
- Fixed `networkidle` → `load` + wait in DOM operations (search, profile)
- Compile pipeline cannot sub-cluster GraphQL — L3 adapter required

**Why:**
- Prior package deleted in batch cleanup; fresh discovery for batch1

**Verification:** adapter-verified via runtime exec (getTagFeed, getArticle, searchArticles, getUserProfile)
**Commit:** pending
