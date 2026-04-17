# normalize-adapter — Next Session Handoff

**Branch:** `task/normalize-adapter` in `.worktrees/normalize-adapter/` · HEAD `f24e8f7` · 67 commits from main.

## Context in One Screen

The milestone collapsed the adapter contract (`CodeAdapter` → `CustomRunner`, single `run(ctx)` entry) and moved page lifecycle into runtime (`PagePlan` + `acquirePage()`). 380 → 323 adapter-backed ops, 20 888 → 17 065 adapter LoC. 10 adapter files deleted, 8 trimmed. All 93 sites verify PASS.

Full story: `doc/todo/normalize-adapter/impl_summary.md`. Phase details: `phase3-handoff.md`, `phase3-extraction-handoff.md`, `phase4-handoff.md`, `phase5b-handoff.md`, `phase5c-handoff.md`. Original design: `final/design.md` + `final/open-questions-resolved.md`.

## Three Hard Rules (do not re-introduce anti-patterns)

1. **No chain in CustomRunner.** Sites that need two calls expose two ops + document the chain in SKILL.md. Agents compose.
2. **No response reshape in runtime.** Response schema describes the **wire shape**. Pretty field names and nested composition belong in SKILL.md, not a runtime primitive.
3. **No unsafe-mode flags on shared primitives for permanent-custom-bucket sites.** Those sites stay CustomRunner — don't add `reuse_page` / similar to force them into spec.

Revisit trigger for any of these: 10+ sites showing the same pattern, OR measurable agent failures, OR runtime-level batching/caching makes server-side materially cheaper. Until one fires, open a `/design`, don't just add a task.

## Ready Tasks (13 as of this commit)

Read `doc/todo/tasks.json`, filter `parent: normalize-adapter`, `state: ready`. Dispatch order by leverage:

**First wave (parallel — no scope conflicts):**
- `na-test-debt` — fix 44 pre-existing puppeteer mock failures + validator.ts TS errors (establishes trustworthy baseline)
- `na-verify-regressions` — reproduce + classify the 4 Phase 5C verify misses (bilibili searchVideos, x getBookmarks/getUserFollowers/searchTweets)
- `na-guardrails` — pattern-report script + biome lint rules + skill/openweb doc sweep

**Second wave (primary runtime gaps — parallel, unblocks finishing-ops):**
- `na-rt-script-json-multimatch` — ✅ done (b44999f). `type_filter` + `multi` on `script_json`; hotel/travel adapter migrations queued under `na-finishing-ops`.
- `na-rt-browser-fetch-errors` — `TypeError: Failed to fetch` retry normalization (unblocks grubhub)
- `na-rt-warm-page-origin` — `warmSession` on page origin not server URL (unblocks apple-podcasts)
- `na-rt-query-templating` — param-level template like `tags=story,author_{id}` (unblocks hackernews 3 reads)
- `na-rt-get-apq` — GET-flavor APQ for `graphql_hash` (unblocks airbnb 2 ops)

**Borderline / lower priority:**
- `na-rt-apollo-ref` — `__ref` resolution for Apollo SSR (goodreads, booking SSR)
- `na-classifier-refinement` — **DONE** (`ece57cb`): `capture-signed` bucket added; centralised-signing sites moved to `custom-permanent`. `capture-simple` dropped 23 → 4.

**Third wave:**
- `na-finishing-ops` — batched migration of deferred ops (depends on the 5 primary runtime gaps)

**Release wave:**
- `na-prod-deploy` — `pnpm build` + skill reinstall smoke test (depends on `na-phase5-migrate-custom` which is done)
- `na-update-doc` — final doc sync after all follow-ups (depends on `na-prod-deploy` + `na-finishing-ops`)

## Cancelled (reference only, don't re-create)

- `na-rt-multicall-composition` — chain primitive (Rule 1)
- `na-rt-response-transform` + `na-rt-array-reducers` — response reshape DSL (Rule 2)
- `na-rt-tiktok-signed-capture` — `reuse_page` unsafe flag (Rule 3)
- `na-final-review` — local commit/push workflow, no branch-gate review

## Gotchas

- `doc/todo/**` is gitignored; `git add -f` when committing handoff/progress docs.
- Phase 3 extraction + Phase 5C workers used a sub-agent-per-site pattern (max 3 parallel). Worked cleanly for isolated-scope migration tranches — re-use this pattern for `na-finishing-ops`.
- No branch-gate codex review — commit and push locally.
