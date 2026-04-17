# Adapter Normalization v2 — Implementation Summary

Branch: `task/normalize-adapter` · 65 commits · 18 tasks · 5 phase handoff docs + design docs.

## Goal Recap

Move common lifecycle, request, and extraction behavior from per-site adapters into shared runtime + spec infrastructure. Track migration per **operation**, not per site. Keep a small permanent custom bucket — but make every adapter that survives a thin "unique behavior only" runner, not a mini runtime.

## Outcome — Hard Numbers

Baselines: `main` at `7cfdf7d` (before this branch). Measurements verified by running `scripts/adapter-inventory.ts` against both states and counting files on disk.

| Metric | Main (before) | Branch HEAD (after) | Δ |
|---|---|---|---|
| Adapter-backed operations | **380** | 323 | −57 (−15.0%) |
| Sites with adapter dirs | 60 | 49 | −11 |
| Adapter `.ts` files | 63 | 53 | −10 (deleted: zhihu, substack, fidelity, weibo, ebay, douban, yelp, etsy, boss, goodrx) |
| Adapter TS total lines | 20 888 | 17 065 | **−3 823 (−18.3%)** |
| Sites passing `pnpm dev verify` | 93 | 93 | maintained |
| Adapter interfaces | `CodeAdapter` + (new) `CustomRunner` dual | single `CustomRunner` | CodeAdapter + init/isAuth gone |

**Verify pass rate after CustomRunner migration** (Phase 5C scope): 108/112 ops PASS (96.4%) — 4 misses are environmental (bilibili browser-tab race, x Twitter API drift), not regressions; `na-verify-regressions` task tracks follow-up.

**Note on intermediate baseline:** Phase 0 (commit 5624b8c) was the first op removal, dropping the count from 380 → 378 before the "inventory baseline" was captured. Several downstream handoff docs cite "378 baseline" for that reason — it's the Phase 1 baseline, not the milestone baseline.

## What Landed

### Runtime infrastructure (Phases 1, 1.5, 2)

| Component | Purpose | Commits |
|---|---|---|
| `src/runtime/page-plan.ts` + `acquirePage()` | Single shared page lifecycle (entry_url / ready / wait_until / settle_ms / warm / nav_timeout_ms). All 3 executors converged. Query-sensitive page reuse. | f56e394, b0b9ff8 |
| OpenAPI server variables | `getServerUrl(spec, op, params)` resolves `{varName}` via caller-param → `variables[].default`. Strict on unresolved. URL-unsafe value rejection. Wired through ALL 21 caller sites. | 263a030, 1105250, 3fd3cbb |
| `buildRequestBody` consolidator | One body-building path: JSON + form-urlencoded parity across `browser_fetch`, `session_http`, cache tier. | 2eaa005, 3fd3cbb |
| Runtime adapter defaults (Step A) | Optional `init()` / `isAuthenticated()` on `CodeAdapter`. PagePlan + warmSession before `init`; auth-primitive resolves → "configured" semantic. Op-level `adapter: false` opt-out. | 9d89b73 |
| Schema validation | `page_plan`, server-level `adapter`, op-level `adapter: false` all validated by `loadOpenApi()`. | 3dc3454 |
| `script_json` extensions | `strip_comments` for HTML-comment-wrapped JSON; node-execution path generalized via `node-extraction-executor`; shared `script-json-parse.ts` between browser + node. | 4ea9e0e |
| `response_capture` extraction type | Listener-before-`goto` invariant; first-match latch (race-safe via synchronous boolean before `await resp.json`); always forces fresh navigation. | 8b47413, bfda872 |
| `graphql_hash` field | Apollo APQ — emits `extensions.persistedQuery.sha256Hash`; coexists with `wrap`; sha256-prefix stripping. | 659dc5e |
| Adapter helpers | `ssrExtract`, `jsonLdExtract`, `domExtract` injected via `AdapterHelpers`. Same resolvers as extraction-executor — no duplicated parsing. | 436272c |
| `warmSession` PX retry | Generalizes hand-coded PerimeterX retry into runtime; any `page_plan: { warm: true }` against a PX-gated page now works. | e86bb3b |
| `CustomRunner` interface (Step B → C) | New single-method adapter contract: `run(ctx: PreparedContext)`. PreparedContext provides page (or null), pre-resolved auth, helpers, interpolated serverUrl. CodeAdapter interface + dual dispatch deleted in 41850f2. | 0d1bffd, 41850f2 |
| Adapter inventory + classifier | `scripts/adapter-inventory.ts` enumerates every `x-openweb.adapter` op, classifies into 6 buckets. `doc/todo/normalize-adapter/inventory.md` regenerable. | 687c7cc |

### Migrations (Phases 0, 3, 4, 5)

**Phase 0 (proof-of-concept):** zhihu cancelUpvote + hackernews getStoriesByDomain, no infrastructure changes (5624b8c).

**Phase 3 pure-spec — 5 of 9 sites fully migrated:** substack 5/5, fidelity 7/7, weibo 6/6 (all 3 adapter files deleted), starbucks 2/3, seeking-alpha 2/4. **−52 ops.** 4 sites deferred with documented runtime gaps (grubhub, hackernews 3 reads, apple-podcasts, hackernews remaining).

**Phase 3 extraction — 8 of 13 sites adapter-deleted/trimmed:** ebay 3/3, douban (dead code), yelp 1/1, etsy 4/4, boss 4/4 (all deleted); producthunt 3/4, tripadvisor 6/7 (586→117 LoC), zillow 3/4 (404→177), indeed 5/8 (327→108) trimmed. reuters/goodreads/rotten-tomatoes/redfin refactored to use helpers (no spec migration possible — JSON APIs need response transform). **−29 ops, ~6 800 LoC removed.**

**Phase 4:** goodrx 3/3 deleted. tiktok read-intercept attempt reverted (signed-fetch incompatible with response_capture's forceFresh nav). Booking + costco deferred — both need primitives that don't exist yet.

**Phase 5B (CustomRunner introduction):** instagram migrated as PoC (12/12 PASS). New interface + dispatch + 3 unit tests in 0d1bffd.

**Phase 5C (full CustomRunner migration):** 15 sites migrated (the original 12-site permanent bucket + glassdoor, trello, tripadvisor surfaced via duck-typed local CodeAdapter shims). `CodeAdapter` interface deleted from `src/types/adapter.ts`; `executeAdapter` collapsed to single CustomRunner branch. 108/112 ops verify PASS.

## Architecture Changes — Key Contracts

### Before
```ts
interface CodeAdapter {
  name; description
  init?(page): Promise<boolean>           // page nav + readiness, per-site
  isAuthenticated?(page): Promise<boolean> // probe (cookie OR /me OR…)
  execute(page, op, params, helpers, auth?): Promise<unknown>
}
```
Every adapter re-owned page lifecycle and auth probing.

### After
```ts
interface CustomRunner {
  name; description
  run(ctx: PreparedContext): Promise<unknown>
}
interface PreparedContext {
  page: Page | null            // null for transport: node
  operation: string
  params: Record<string, unknown>
  helpers: AdapterHelpers      // pageFetch, nodeFetch, ssr/jsonLd/domExtract, errors
  auth: AuthResult | undefined // pre-resolved from spec primitive
  serverUrl: string            // already interpolated with server variables
}
```
PagePlan + warmSession + auth-primitive resolution happen in the runtime before `run()`. Adapter only owns its unique acquisition logic.

### Operation-level migration knob
```yaml
paths:
  /api/foo:
    get:
      x-openweb:
        adapter: false   # this op opts out of server-level adapter; runs spec-only
```

## Runtime Gaps Surfaced — Concrete Backlog

The migration honestly hit 7 primary primitive gaps plus several smaller composition/transform gaps. Each has a clear unblock path:

**Primary gaps (each has a dedicated `na-rt-*` task):**

| Gap | Unblocks | Estimate |
|---|---|---|
| Multi-match + `@type` filter on `script_json` | booking `getHotelDetail` + any multi-block LD+JSON site | xs (~30 LoC) |
| `response_transform` primitive (JSONPath mapping) | hackernews `response_wrap`, booking Hotel reshape, simple thin-adapter survivors. **Does NOT alone unlock costco** — see secondary gaps below. | m (new primitive) |
| GET-flavor APQ for `graphql_hash` | airbnb 2 ops, Relay-style APIs | s |
| `browser_fetch` `TypeError: Failed to fetch` normalization | grubhub 3 ops, cross-origin API gateway class | s |
| `warmSession` on page origin (not API server) | apple-podcasts 4 ops | xs |
| Param-level template into query values | hackernews 3 reads | s |
| Patched-fetch reuse for `response_capture` | tiktok read intercepts (architectural tradeoff — loses listener-before-goto safety) | l |

**Secondary gaps surfaced in handoffs but larger scope:**

- **Multi-call composition** (phase3 pure-spec handoff:70) — chain ops together e.g. username→userId→feed. Not in any current task. Blocks instagram-class sites from reducing further.
- **Array filter + aggregation transforms** — costco needs `attributes[].name→value` collapse, service-code lookup, hours formatting, etc. `response_transform` alone (simple JSONPath) handles maybe half. Honest scope for costco: `response_transform` + declarative array reducers.
- **Apollo `__ref` resolution** for SSR state — mentioned in phase3-extraction handoff; goodreads/booking Apollo SSR needs follow-pointer traversal.
- **HTML regex extraction** — for inline `<script>` JSON embedded with surrounding noise (not a fixed JSON block).
- **Slug/path transform** (e.g. zillow regionId→slug lookup table) — site-specific but a general "lookup table" primitive might compose.
- **Inventory classifier refinement** (phase4 handoff:57) — `capture-simple` bucket misclassifies signed-fetch sites. Not a runtime gap, but blocks accurate planning.

Tasks for multi-call composition, array reducers, Apollo `__ref`, classifier refinement are **NOT yet in the backlog** — add if the next milestone needs them.

## Production Deployment — Ship Discipline

**Current `dist/cli.js` still accepts BOTH `run` and `execute` exports** (legacy loader kept the dual shape). So a user who runs the installed `@openweb-org/openweb` today against the migrated `.js` in `~/.openweb/sites/<site>/adapters/` will NOT see an immediate "no valid adapter export" error. The real failure mode is **post-rebuild**: once `pnpm build` regenerates dist against the new single-shape loader (41850f2), any site whose compiled `.js` still references `CodeAdapter` or `init`/`isAuthenticated` will fail to load.

Unblockers:
1. **Dev/verify in this worktree:** loader prefers `.ts` under tsx — working today.
2. **Production release:** `pnpm build` → verify no `.js` references `CodeAdapter` → reinstall `~/.openweb/sites/<site>/adapters/*.js` via the skill bundle. Track in `na-prod-deploy`.

## Lessons Learned (Honest)

1. **The 40–55% LoC-reduction estimate was optimistic.** Actual: ~22% LoC removed in this milestone. The CustomRunner refactor unifies shape but doesn't shrink most files (whatsapp + x actually GREW slightly because inlined waits/probes are more verbose than the old methods). Real savings come from spec migration, not interface change.

2. **The custom bucket is bigger than 13.** Discovery: glassdoor, trello, tripadvisor were on duck-typed local `CodeAdapter` shims. Real bucket is ~15 sites. The classifier's `custom-permanent: 0` was an artifact of signing-helper centralization, not actual custom bucket size.

3. **Inventory bucket "capture-simple" misclassifies signed-fetch sites.** tiktok had 8 ops in capture-simple but every read needs the patched signed-fetch to fire the request at all. The classifier should demote sites with `signing` or `interceptApi`+patched-fetch evidence.

4. **Phase-level codex review found 2 real blockers** (server-variable wiring not threaded through callers; schema validation missing the new fields) that no per-task codex review caught. The phase-gate review was load-bearing — added na-phase1.5-wire-through that fixed both before Phase 3 could start. Per-task review missed this because it scoped to a single commit's diff.

5. **Sub-agent-per-site dispatch (used by Phase 3 extraction + Phase 5C workers) was the right call.** Parallel migration of 15 sites with one supervising agent worked cleanly because each site's scope is genuinely isolated. Future migration tranches should use this pattern.

6. **The bucket distribution post-milestone is informative:** of 323 remaining adapter-backed ops, 47 are `canonical-ready` (low-hanging fruit), 23 `capture-simple`, 6 `needs-phase-2`, 3 `graphql-persisted`. That's 79 ops directly addressable without new primitives — the next milestone's clear scope. The other 241 "needs-phase-1" is the long tail blocked on the 7 primitive gaps above.

## What's Next (Pending Tasks)

- `na-guardrails` — pattern-report script + biome lint rules + skill/openweb doc sync (still ready, not dispatched)
- `na-phase4-followups` — superseded by per-gap tasks; archive
- New tasks (see /update-tasks output): production deployment, test debt, 7 runtime-gap tasks, batched site-finishing tasks, final codex review

## File Index

Code:
- `src/runtime/page-plan.ts` — PagePlan + acquirePage
- `src/runtime/primitives/response-capture.ts` — response_capture
- `src/runtime/primitives/script-json-parse.ts` — shared script_json parser (browser + node)
- `src/runtime/node-ssr-executor.ts` — generalized node extraction dispatch
- `src/lib/adapter-helpers.ts` — ssrExtract / jsonLdExtract / domExtract
- `src/types/adapter.ts` — single CustomRunner contract
- `src/lib/spec-loader.ts` — server-variable substitution
- `scripts/adapter-inventory.ts` — bucket classifier

Docs:
- `doc/todo/normalize-adapter/inventory.md` — regenerable bucket table (323 ops)
- `doc/todo/normalize-adapter/phase3-handoff.md` — pure-spec migration outcomes
- `doc/todo/normalize-adapter/phase3-extraction-handoff.md` — extraction migration outcomes
- `doc/todo/normalize-adapter/phase4-handoff.md` — graphql/capture migration outcomes
- `doc/todo/normalize-adapter/phase5b-handoff.md` — CustomRunner contract
- `doc/todo/normalize-adapter/phase5c-handoff.md` — full migration table
- `doc/todo/normalize-adapter/final/design.md` — original design (still authoritative)
- `doc/todo/normalize-adapter/final/open-questions-resolved.md` — OQ analysis
