## 2026-04-18 — Write-op verify fix
**Context:** Write-verify campaign exposed that `starProject` and `unstarProject` had no `example.json` fixtures — `verify --write --ops` filter found no matches and returned "0/0 ops" (silent skip, falsely green). Separately, `unstarProject` was documented with a 200 response status but the live API actually returns 201.
**Changes:** Added `examples/starProject.example.json` and `examples/unstarProject.example.json` against a real `projectId`. Corrected `unstarProject` response status 200 → 201 in `openapi.yaml`. (commit 4e740e4)
**Verification:** 2/2 PASS — starProject, unstarProject.
**Key discovery:** "0/0 ops" in a verify run is a silent failure mode, not a pass — when an example file is missing, the runner has nothing to dispatch and the site appears clean. Both write ops on every site need fixtures, even idempotent ones.

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
