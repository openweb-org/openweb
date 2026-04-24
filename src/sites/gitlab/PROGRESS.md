## 2026-04-24 — QA: adapter for response trimming, pipeline filters, getGroup fix

**Context:** Userflow QA across three personas (DevOps/pipelines, developer/MRs, manager/milestones) exposed severe response bloat across all read operations. getGroup returned 614KB (embedded 100 full project objects). listProjectBranches returned full commit objects per branch. MR responses carried 55 fields (schema declares 8). listProjectPipelines lacked `status` and `ref` filter params — a DevOps engineer cannot filter failed pipelines.

**Changes:**
- Created `adapters/gitlab.ts` — custom runner for all 11 read operations with response trimming via `nodeFetch`
- Added `simple=true` to searchProjects and listGroupProjects (reduces project fields from 95→20 before further trim)
- Added `with_projects=false` to getGroup (614KB→200B — stops embedding 100 project objects)
- Added `status` and `ref` query params to listProjectPipelines
- searchGroups: skip auth cookies (authenticated search only returns user's groups, defeating discovery), default `order_by=similarity`
- Enriched schemas: MR response adds author, reviewers, draft, has_conflicts, labels, created_at, updated_at; issue adds author, created_at, updated_at; pipeline adds created_at, updated_at; branch adds commit_short_id, commit_title; project detail adds open_issues_count, last_activity_at, created_at
- Fixed manifest stats (operation_count 18→17, l1 18→6, l3 0→11)

**Verification:** `pnpm dev verify gitlab` — 10/10 PASS. All tests pass (1049/1049). Adapter lint-clean.

**Response size improvements (per item):**
| Operation | Before | After |
|-----------|--------|-------|
| getGroup | 614KB | 200B |
| listGroupProjects | ~5KB | ~200B |
| searchProjects | ~5KB | ~250B |
| listProjectMergeRequests | ~6KB | ~500B |
| listProjectIssues | ~5KB | ~400B |
| listProjectBranches | ~800B | ~200B |

**Known gap:** searchGroups returns public group forks/mirrors sorted by similarity — the original gitlab-org (ID 9970) isn't ranked first due to GitLab API behavior with unauthenticated group search. Users can still fetch it directly via getGroup.

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
