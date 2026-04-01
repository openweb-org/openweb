## 2026-03-31: Curate — transport, 14th op, summaries, DOC.md

**What changed:**
- Kept transport `node` — GitLab API v4 works with direct HTTP; meta_tag CSRF resolves from node when cookies available
- Added `listGroupProjects` operation (14th op, stable_id gl0014)
- Enriched all summaries with 3-5 key response fields
- Enriched starProject/unstarProject response schemas (added path_with_namespace, web_url, visibility)
- Added full_path to getGroup response schema
- Added 2 example files (searchUsers, listGroupProjects) — 10 examples total
- Rewrote DOC.md per site-doc.md template: workflows, data flow annotations, quick start, site internals

**Why:**
- Bring site package to curation standard per spec-curation.md and site-doc.md

**Verification:** pnpm --silent dev verify gitlab — all dimensions

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 8 verified operations for discoverability

**Verification:** spec review only — no new capture or compilation
