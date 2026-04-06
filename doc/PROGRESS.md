## 2026-04-06: Skill doc rewrite + 6 new sites + runtime improvements

**What changed:**
- Complete rewrite of `skill/openweb/` — 3 peer folders (add-site/, references/, knowledge/) organized by loading pattern. 24 files, 177K → 144K. Self-contained: zero doc/main cross-references.
- Double-design process (Claude + Codex): independent designs, cross-review, 3-round /align, user discussion, resolved all open questions.
- 6 new sites: airbnb (2 ops), spotify (4), tiktok (1), notion (3), yelp (2), zillow (1). All verified with DOC.md + PROGRESS.md.
- doc/main alignment audit: fixed 3 discrepancies (phantom `fallback` auth type, `ws` transport value, incomplete XOpenWebOperation fields).
- Centralized `warmSession()` in adapter-executor.ts — adapters no longer import it (self-contained rule).
- New `bot_blocked` failureClass — verify.ts checks class instead of fragile string matching.
- Auth cascade in http-executor: adapter init failure with requiresAuth triggers needs_login flow.
- CAPTCHA headed-mode guidance in SKILL.md, troubleshooting.md, cli.md.
- verify.md now requires PROGRESS.md in Doc Verify checklist.
- Site fixes: bluesky (AT Protocol 400), costco (JSON-LD extraction), reuters (DataDome), telegram (conflict detection), tripadvisor (safeEvaluate), twitch (null safety), leetcode (auth change).

**Why:**
- Skill docs were 177K across 24 flat files — agents burned tokens loading irrelevant content. Progressive disclosure + workflow-driven structure cuts token cost ~45% for the common path.
- warmSession in adapters violated self-contained rule and caused double-warming. Centralization fixes both.
- String-matching for bot detection was fragile coupling. Dedicated failureClass is the right abstraction.

**Key files:** `skill/openweb/` (all 24 files), `src/runtime/adapter-executor.ts`, `src/runtime/browser-fetch-executor.ts`, `src/runtime/http-executor.ts`, `src/lifecycle/verify.ts`, `src/lib/errors.ts`, `doc/main/README.md`, `doc/main/runtime.md`
**Verification:** 843 tests pass, lint clean (site files), 55/63 sites verify PASS, 0 regressions introduced
**Commit:** 8035901..040284e (12 commits)
**Next:** reuters DataDome fix, yahoo-finance 429 recovery, npm publish
**Blockers:** None

## 2026-04-04: Patchright, headless stealth, warmSession, site fixes

**What changed:**
- Replaced `playwright-core` with `patchright` (Playwright fork) — patches CDP detection signals (`navigator.webdriver`, `Runtime.enable` leak) that bot-detection frameworks use
- Headless stealth: `--user-agent` override (Windows Chrome/133, most common scraping UA was being blocked) + `--disable-blink-features=AutomationControlled`
- `warmSession()` utility in `src/runtime/warm-session.ts` — navigates to site, waits for anti-bot sensor scripts (Akamai, DataDome) to generate valid session cookies before API requests; WeakSet cache prevents double-warm
- Google Maps: replaced all DOM scraping with network interception (intercepts XHR responses directly)
- LinkedIn: L3 adapter with runtime queryId extraction from JS bundles (queryIds change on deploy)
- Bluesky: adapter for dynamic PDS URL resolution in `searchPosts`
- Yahoo Finance: `searchTickers` pending fingerprint, UA workaround docs updated
- TripAdvisor: adapter rewrite using warmSession for Akamai bypass
- Schema drift fixes for google-search, espn, steam
- Default UA changed from Mac Chrome/134 to Windows Chrome/133

**Why:**
- Bot detection was blocking headless Chrome on multiple sites — patchright + stealth flags fix the root cause
- Anti-bot sensor scripts (Akamai `_abck` cookie, DataDome) need time to run before API requests succeed — warmSession provides a shared pattern
- Site-specific fixes unblock sites that broke due to upstream changes (LinkedIn queryId rotation, Bluesky PDS federation, schema drift)

**Key files:** `src/runtime/warm-session.ts`, `src/runtime/browser-lifecycle.ts`, `src/lib/config.ts`, `src/sites/google-maps/`, `src/sites/linkedin/`, `src/sites/bluesky/`, `src/sites/tripadvisor/`
**Verification:** All tests pass, lint clean, build passes
**Commit:** (this session)
**Next:** npm publish
**Blockers:** None

## 2026-04-04: README rewrite + install-skill.sh

**What changed:**
- Complete README rewrite for public release — world-class open source README with clear value prop, install instructions, quickstart, and architecture overview
- `install-skill.sh` — one-line skill installer that auto-detects Claude Code, Codex, OpenCode, OpenClaw and installs the skill to the right directory
- Simplified browser section in README — browser auto-starts, no manual setup required
- Updated skill docs to reflect auto browser lifecycle

**Why:**
- First impressions matter — the README is the entry point for all new users and contributors
- One-line install reduces friction from "clone repo + configure" to a single curl command

**Key files:** `README.md`, `install-skill.sh`, `skill/openweb/SKILL.md`
**Verification:** README renders correctly, install-skill.sh tested
**Commit:** (this session)
**Next:** npm publish
**Blockers:** None

## 2026-04-03: Auto browser lifecycle — ensureBrowser, BrowserHandle, watchdog, 4-tier auth cascade

**What changed:**
- `ensureBrowser()` auto-starts headless Chrome when needed — no manual `browser start` required
- `BrowserHandle` with `release()` = disconnect (never kills Chrome); replaces all `browser.close()` calls
- Shell watchdog: detached `sh` process kills Chrome after 5 minutes idle, cleans up temp profile
- 4-tier auth cascade in `http-executor.ts`: (1) token cache, (2) browser extract, (3) profile refresh, (4) user login with exponential backoff poll
- `refreshProfile()` re-copies Chrome profile without clearing token cache
- `handleLoginRequired()` opens site in system browser, polls with backoff (5s->60s cap, 5min timeout)
- Filesystem lock (`browser.start.lock`) prevents concurrent Chrome starts
- Capture sessions touch `browser.last-used` every 60s to prevent watchdog kill during long captures
- Connection error retry in `http-retry.ts` for auto-recovery from tier 3 browser restart
- External CDP: skip tier 3 (can't restart external browser), allow tier 4 only for localhost

**Why:**
- Agents should never need to manually start a browser — the runtime should handle it
- Auth failures should cascade through increasingly expensive recovery steps before giving up
- Chrome should not persist forever — idle cleanup prevents resource leaks

**Key files:** `src/runtime/browser-lifecycle.ts`, `src/runtime/http-executor.ts`, `src/runtime/http-retry.ts`, `src/commands/browser.ts`, `src/capture/session.ts`
**Verification:** 828/828 tests pass (24 new browser lifecycle tests), lint clean, build passes
**Commit:** ddbda1f..66c1ab0
**Next:** npm publish
**Blockers:** None

## 2026-04-03: Unified config.json — replace env vars + permissions.yaml

**What changed:**
- Single `$OPENWEB_HOME/config.json` replaces all env var reads and `permissions.yaml`
- Deleted env vars: `OPENWEB_CDP_PORT`, `OPENWEB_USER_AGENT`, `OPENWEB_TIMEOUT`, `OPENWEB_RECORDING_TIMEOUT`, `OPENWEB_DEBUG`
- `permissions.yaml` merged into `config.json` `permissions` section; yaml loading removed
- `loadConfig()` reads/validates/caches config with defaults; `OPENWEB_HOME` is the sole env var
- `getBrowserConfig()` convenience function for browser settings (port, headless, profile)
- Port range validation (1-65535), positive-only timeout validation, URL scheme validation
- Updated all doc/skill references from env vars and permissions.yaml to config.json

**Why:**
- Single config file is simpler than scattered env vars + a separate permissions file
- Config validation catches errors early (invalid port, negative timeout)
- `OPENWEB_HOME` as sole env var reduces configuration surface

**Key files:** `src/lib/config.ts`, `src/lib/config.test.ts`, `src/lib/permissions.ts`, `src/lib/permissions.test.ts`
**Verification:** 828/828 tests pass (24 new config tests), lint clean, build passes
**Commit:** ddbda1f..66c1ab0
**Next:** npm publish
**Blockers:** None

## 2026-04-03: Archive completed todo projects — clean slate for v0.2

**What changed:**
- Archived 10 completed `doc/todo/` projects to `doc/archive/20260403_*/`:
  CI, browser, ergonomics, graphql-design, improve-thought, pipeline-gap-fixes,
  pipeline-gap-triage, pre-release, test_infra, ssr-dom-extraction
- Remaining active in `doc/todo/`: cleanup/ (v0.1.1), prerelease-review/ (v0.1.0),
  release-qa/ (v0.1.0), roadmap.md, blocked.md

**Why:**
- All 10 archived projects either completed (ergonomics RC1-RC6 all fixed, pipeline gaps
  triaged + fixed) or deferred to post-release (graphql-design, ssr-dom-extraction, CI, test_infra)
- Clean `doc/todo/` focuses attention on the remaining v0.1.0 publish step

**Key files:** doc/todo/ → doc/archive/20260403_*/
**Verification:** `ls doc/todo/` shows only active items
**Commit:** (this commit)
**Next:** npm publish
**Blockers:** None

## 2026-04-03: Pre-release review round 2 — bug fixes, schema/doc sync

**What changed:**
- Auth query params doubled: `buildTargetUrl()` now deduplicates via `seen` set + `extraQueryParams`, removed manual append loops in session/browser-fetch executors
- Token lock poisoning: `withLock()` always releases in finally, clears timeout on success — previously timed-out locks permanently poisoned the site key
- Bare `Error` → `OpenWebError` in ws-pool, ws-cli-executor, ws-connection, token-cache
- TS type sync: `app_path` on localStorage_jwt, `adapter`/`method` on page_global_data (already in JSON schema)
- Skill doc sync: `custom_signing` clarified as non-primitive pattern, `safety`/`requires_auth` added to op-level table, dropped sites cleaned from 8 archetype/knowledge files

**Why:**
- Codex second-round review found real bugs (auth doubled, lock poisoning) and doc drift

**Key files:** src/runtime/request-builder.ts, src/runtime/token-cache.ts, src/runtime/ws-*.ts, src/types/primitives.ts, skill/openweb/references/knowledge/*.md
**Verification:** 780/780 tests, lint clean, build passes, `node dist/cli.js` works
**Commit:** 363d4f4
**Next:** npm publish
**Blockers:** None

## 2026-04-03: Pre-release review — 24 fixes from 14 parallel agents

**What changed:**
- Two-round review: 9 Claude agents + 5 Codex agents covering security, correctness, packaging, docs, skill quality, test coverage, build pipeline, dependencies, public API
- **Release blocker fixed**: `readFileSync` + `import.meta.url` breaks in tsup bundle — inlined all JSON configs (tracking-cookies, blocked-domains, blocked-paths, static-extensions)
- Security: WS SSRF validation, yaml CVE fix, redirect header mutation, WS reconnect socket leak, autoNavigate page leak
- Packaging: pack-check regex, playwright→playwright-core everywhere, author field, PROGRESS.md removed from tarball, .gitignore fix, dead EXCLUDED_SITES cleaned
- Types: op-level auth/signing overrides added to schema + TS interface, app_path added to localStorage_jwt type, tracking cookie misclassification fixed
- Code quality: shared-constants.ts extracted, OpenWebError used consistently, response-parser 204 handling
- Docs/skill: 20+ stale references fixed (dropped sites, wrong counts, broken links, ghost --verbose flag, missing CLI flags)
- Deferred items documented in `doc/todo/prerelease-review/`

**Why:**
- Final polish before v0.1.0 open-source npm publish
- Codex found the critical bundle issue that would have made the published CLI unusable

**Key files:** src/runtime/ws-runtime.ts, src/compiler/analyzer/labeler.ts, src/types/schema.ts, src/types/extensions.ts, scripts/pack-check.js, src/capture/connection.ts, skill/openweb/references/cli.md
**Verification:** 780/780 tests pass, lint clean, build succeeds, `node dist/cli.js` starts correctly, pack check passes
**Commit:** 438b829
**Next:** npm publish
**Blockers:** None

## 2026-04-02: localStorage_jwt app_path — cross-domain token resolution

**What changed:**
- Replaced `page_url` hack with unified `app_path` field on `localStorage_jwt` auth primitive
- Same semantics as `webpack_module_walk`'s `app_path`: relative paths resolve against server URL, absolute URLs work cross-domain
- When `app_path` points to a different origin, the resolver opens a temporary page, reads localStorage, then closes it

**Why:**
- Bluesky's API lives on `bsky.social` but JWT tokens are stored in localStorage on `bsky.app`. Without `app_path`, the resolver tried to read localStorage from the wrong origin.

**Key files:** `src/runtime/primitives/localstorage-jwt.ts`, `src/types/primitive-schemas.ts`
**Example:** Bluesky — `app_path: https://bsky.app` reads localStorage from bsky.app, injects bearer token into bsky.social API calls

## 2026-04-02: build-sites.js stale cache dir cleanup

**What changed:**
- `scripts/build-sites.js` sync now removes cache site dirs in `~/.openweb/sites/` that are not present in `dist/`
- Previously only cleaned per-site files within known dirs; rogue dirs from compile mishaps lingered

**Key files:** `scripts/build-sites.js`

## 2026-04-02: Final score — 49/50 PASS

All sites verified: bloomberg(6/6), reuters(3/3), weibo(8/8), tripadvisor(4/4), doordash(3/3), bluesky(9/9), uber(2/2), telegram(4/5), youtube(6/6), homedepot(3/3), instacart(3/3), boss(7/7), fidelity(13/13), x(8/8), google-search(9/9), google-flights(5/5), medium(10/10), jd(4/4). Only yahoo-finance rate limited.

## 2026-04-02: Per-operation auth/csrf/signing override

- `getServerXOpenWeb()` merges op-level `x-openweb` overrides on top of server-level config
- `auth: false` / `csrf: false` / `signing: false` disables the respective primitive at op level
- Key file: `src/runtime/operation-context.ts`

## 2026-04-02: Skill doc updates — mixed transport, adapter best practices

**What changed:**
- Added mixed transport site pattern to `x-openweb-extensions.md` (sites that use both node and page transport across operations)
- Added adapter init/navigation best practices to `spec-curation.md` (permissive init, per-operation navigation, ERR_ABORTED handling)

**Key files:** `skill/openweb/references/knowledge/x-openweb-extensions.md`, `skill/openweb/references/spec-curation.md`

## 2026-04-02: Fidelity adapter — 13/13 PASS

**What changed:**
- New `fidelity-api` adapter with CSRF token fetch via `page.evaluate`
- Bypasses browser-fetch CSRF path entirely; handles redirect domain mismatch (fidelity.com → digital.fidelity.com)
- All 13 operations pass verify

**Key files:** `src/sites/fidelity/adapters/fidelity-api.ts`, `src/sites/fidelity/openapi.yaml`
**Verification:** `pnpm dev verify fidelity` — 13/13 PASS

## 2026-04-02: Boss adapter navigation fix — 7/7 PASS

**What changed:**
- Adapter now navigates per-operation (same pattern as google-search/booking/redfin)
- Permissive `init()` — accepts any boss.com URL
- Catches `ERR_ABORTED` during navigation (common on heavy SPA pages)

**Key files:** `src/sites/boss/adapters/boss.ts`
**Verification:** `pnpm dev verify boss` — 7/7 PASS

## 2026-04-02: browser-fetch-executor ssrfValidator fix (A3 resolved)

**What changed:**
- Propagated `ssrfValidator` to `resolveAuth`, `resolveCsrf`, and `resolveSigning` in `browser-fetch-executor.ts`
- Same bug as session-executor.ts (fixed earlier for ChatGPT) — `ssrfValidator` was `undefined`, causing sites with page-transport auth resolvers to fail

**Why:**
- Fidelity's 7 page ops failed because the auth/CSRF/signing resolvers received `undefined` ssrfValidator
- This resolves the A3 open question from pipeline-gap triage: ssrfValidator is now propagated in ALL executors (session, browser-fetch, http)

**Key files:** `src/runtime/browser-fetch-executor.ts`

## 2026-04-02: build-sites.js clean sync fix

**What changed:**
- `~/.openweb/sites/` sync now deletes stale cache directory before copying fresh build output (`rmSync` + `cpSync`)
- Previously, deleted operations' example files lingered in the cache, causing verify to run against ghost operations ("Tool not found" errors)

**Why:**
- After pruning operations from a site package, `pnpm build` would copy new files over old, but never removed files that no longer exist in source. Verify then tried to load examples for deleted ops.

**Key files:** `scripts/build-sites.js`

## 2026-04-02: X (Twitter) L3 adapter — dynamic hash resolution + request signing

**What changed:**
- Added `x-graphql` adapter that extracts GraphQL query hashes at runtime from the main.js webpack bundle (not hardcoded) — survives Twitter deploys
- Added `x-client-transaction-id` signing via Twitter's webpack signing function (module 938838, export `jJ`) — required for Followers and SearchTimeline
- Bearer token, CSRF, cookies handled inline by adapter
- Rewired all 14 ops from browser_fetch to adapter; params simplified to user-facing (no more `{id}`, `variables`, `features`)
- Removed searchTypeahead (REST v1.1 endpoint deprecated, returns 410)
- Fixed `encodeQueryValue` in request-builder.ts — was not encoding JSON chars (`{`, `}`, `"`), causing 400s on browser_fetch URLs
- Updated skill knowledge: compile.md (adapter escalation signals), auth-patterns.md, bot-detection-patterns.md, graphql-patterns.md, troubleshooting-patterns.md

**Why:**
- Query hashes rotate on every Twitter deploy — hardcoded hashes broke within hours
- Some endpoints (Followers, SearchTimeline) require per-request `x-client-transaction-id` signing that browser_fetch can't provide
- Previous attempt (commit 2499248) correctly identified hash rotation but missed the URL encoding bug and signing requirement

**Key files:** `src/sites/x/adapters/x-graphql.ts`, `src/sites/x/openapi.yaml`, `src/runtime/request-builder.ts`
**Verification:** `pnpm dev verify x` — 8/8 PASS, `pnpm test` 780/780 passed
**Commit:** pending
**Next:** Monitor webpack signing module ID stability across Twitter deploys
**Blockers:** None

## 2026-04-02: Add app_path to webpack_module_walk — Discord auto-navigation fix

**What changed:**
- Added `app_path` optional field to `webpack_module_walk` auth config
- When webpack cache is empty and `app_path` is set, the resolver auto-navigates to `{origin}{app_path}` before retrying
- Discord openapi.yaml: added `app_path: /channels/@me` — webpack bundle only loads on the app page, not the landing page
- Extracted `probeWebpackCache()` helper for cleaner probe/navigate/retry flow

**Why:**
- Discord's webpack bundle (`webpackChunkdiscord_app`) only loads at `/channels/@me`, not at `discord.com/`. Without `app_path`, users had to manually open a tab to the correct URL before running any Discord operation.

**Key files:** `src/runtime/primitives/webpack-module-walk.ts`, `src/sites/discord/openapi.yaml`, `src/types/primitives.ts`, `src/types/primitive-schemas.ts`
**Verification:** `pnpm build` passed, `pnpm test` 780/780 passed, `pnpm dev verify discord` 10/10 PASS
**Next:** None
**Blockers:** None

## 2026-04-02: Fix google-flights adapter — 5/5 PASS

**What changed:**
- Fixed adapter init (permissive URL check) + execute (navigate to operation URL with params)
- Added missing examples for exploreDestinations, getPriceInsights
- Same pattern as google-search/booking/redfin adapter fix earlier today

**Key files:** `src/sites/google-flights/adapters/google-flights.ts`
**Verification:** `pnpm dev verify google-flights` — 5/5 PASS
**Commit:** pending

## 2026-04-02: Fix adapter navigation — 3 sites, docs update

**What changed:**
- google-search, booking, redfin adapters now navigate to correct URLs before
  DOM extraction (was extracting from server origin homepage → empty/wrong data)
- Added `navigateToSearch()`/`navigateTo()` helpers to each adapter
- google-search trimmed from 14 to 9 ops (removed stale-selector ops)
- Documented "Adapter Path Semantics" in spec-curation.md and x-openweb-extensions.md:
  adapter paths are logical namespaces, runtime does NOT auto-navigate, adapter
  must use params to navigate
- Also discovered: stale .ts files in `~/.openweb/sites/*/adapters/` caused
  `preferTypeScriptAdapter()` to load old code over updated .js builds

**Why:**
- Systemic adapter-pattern bug: all DOM-extraction adapters that didn't do their
  own `page.goto()` were broken. The runtime only opens a page at the server
  origin — adapter paths are logical, not real URLs (OpenAPI doesn't allow
  multiple ops on same path+method).

**Key files:** `src/sites/{google-search,booking,redfin}/adapters/*.ts`, `skill/openweb/references/spec-curation.md`, `skill/openweb/references/knowledge/x-openweb-extensions.md`
**Verification:** google-search 7 results, booking 25 Tokyo hotels, redfin 41 Seattle listings
**Commit:** b237c7c

## 2026-03-31: Multi-worker capture isolation

**What changed:**
- `capture.ts`: `--isolate` + `--url` flags for per-page isolation, `--session` flag for targeted stop
- Session-scoped PID files (`.openweb-capture-<id>.pid`) replace single global PID file
- Auto-discovery: `capture stop` finds the single session, or errors listing active sessions if multiple
- `cli.ts`: wire new flags to yargs
- `discover.md`: replace shared-capture multi-worker section with per-worker `--isolate` pattern
- `cli.md`: document new capture flags

**Why:**
- Multiple workers sharing one Chrome browser had traffic cross-contamination, PID collisions, and no way to stop specific sessions. Capture primitives were already page-scoped — only the CLI needed changes.

**Key files:** `src/commands/capture.ts`, `src/cli.ts`, `skill/openweb/references/discover.md`, `skill/openweb/references/cli.md`
**Verification:** 3/3 QA tests pass (backward compat, isolated session, multi-session error)

## 2026-03-31: Fix compile --script hang + capture script guide

**What changed:**
- `recorder.ts`: 120s timeout on child process (SIGTERM → SIGKILL after 5s grace). Restores timeout lost in blanket revert of commit 1b910e9.
- `config.ts`: `TIMEOUT.recording` (configurable via `"recordingTimeout"` in `~/.openweb/config.json`)
- `capture-script-guide.md`: new reference doc — timeout discipline table, two-phase and --script templates
- `record_discord.ts`: reference script with `waitUntil:'load'`, AbortController on fetch, bounded cleanup, `process.exit(0)`
- Updated SKILL.md, cli.md, discover.md to reference capture-script-guide.md

**Why:**
- `compile --script` could hang indefinitely: no parent timeout, `networkidle` never fires on SPAs, `page.close()`/`browser.close()` can hang on bad CDP state. Discovered 3 additional bugs during QA: Promise.race propagates cleanup rejections, lingering setTimeout prevents process exit, pnpm/tsx wrappers don't die on SIGINT.

**Key files:** `src/compiler/recorder.ts`, `src/lib/config.ts`, `scripts/record_discord.ts`, `skill/openweb/references/capture-script-guide.md`
**Verification:** 3/3 QA tests pass (hang timeout, Discord --script, two-phase capture)
**Commit:** c3f0cad

## 2026-03-31: Multi-worker capture isolation design

**What changed:**
- Added `doc/todo/improve-thought/20260331_discord-discover/multi-worker-capture-design.md`

**Why:**
- Capture primitives are already page-scoped, but CLI exposes browser-wide capture only. Design proposes `--isolate` flag + session-scoped PID files for parallel discovery.

**Commit:** 4847b25

## 2026-03-31: Friction-log code fixes — stderr, build sync, schema warning, auth docs

**What changed:**
- `recorder.ts`: stream stderr from `compile --script` child process in real-time instead of buffering
- `build-sites.js`: auto-sync `dist/sites/` → `~/.openweb/sites/` after build so CLI cache stays current
- `schema-v2.ts`: warn when empty array response produces bare `type: object` schema
- `auth-patterns.md`: documented webpack export-key convention (`default`/`Z`/`ZP`) for `webpack_module_walk`

**Why:**
- All 4 items from Discord rediscovery friction log (doc/todo/improve-thought/discord-discover/cn/friction-log.md)

**Key files:** `src/compiler/recorder.ts`, `scripts/build-sites.js`, `src/compiler/analyzer/schema-v2.ts`, `skill/openweb/references/knowledge/auth-patterns.md`
**Verification:** pnpm build passes (with sync), 720/720 tests pass
**Commit:** 03bf14a

## 2026-03-31: Skill doc refactor — split process + reference layers

**What changed:**
- Split discover.md (479→357 lines) and compile.md (689→349 lines) into focused process docs
- Extracted analysis-review.md (265 lines) from compile Step 2 + discover Step 4
- Extracted spec-curation.md (283 lines) from compile Step 3
- Updated SKILL.md routing table: added deep reference docs table with Loaded by column
- Added 6 friction-log improvements: non-cookie auth injection, two-phase capture, chain-ID rediscovery, cache sync, empty-array schema fallback, official-doc fallback
- Removed 4 duplicate sections (handoff text, curl anti-pattern)
- Fixed stale cross-reference in ws-patterns.md

**Why:**
- During Discord rediscovery, agent loaded 689 lines of compile.md but only used ~100 lines per phase. Progressive disclosure pattern: process docs stay linear, reference material loads on demand.

**Key files:** `skill/openweb/SKILL.md`, `skill/openweb/references/discover.md`, `skill/openweb/references/compile.md`, `skill/openweb/references/analysis-review.md`, `skill/openweb/references/spec-curation.md`
**Verification:** pnpm build passes, discord verify 10/10 PASS, Codex cross-review APPROVE (2 rounds)
**Commit:** 398ffc0
**Design:** doc/todo/skill-doc-refactor/final/design.md

## 2026-03-30: Discord rediscovery — expand from 4 to 10 ops

**What changed:**
- Recaptured Discord with working webpack_module_walk auth via page.evaluate(fetch)
- Expanded from 4 ops to 10: added getCurrentUser, listGuilds, getDirectMessages, getGuildInfo, listGuildChannels, getGuildRoles, searchMessages, getPinnedMessages
- Dropped getMyEntitlements, getMyScheduledEvents (low value for messaging archetype)
- Enriched response schemas from live API data for all ops

**Why:**
- Original 4 ops too few for messaging archetype coverage (guilds, channels, messages, DMs, user info, search)

**Key files:** `src/sites/discord/openapi.yaml`, `src/sites/discord/DOC.md`, `src/sites/discord/PROGRESS.md`, `src/sites/discord/examples/`
**Verification:** All 10 ops verify PASS with --browser
**Commit:** 263a1b4

## 2026-03-30: Bilibili site QA — prune to 10 ops, fix verify, release-ready

**What changed:**
- Pruned bilibili from 32 ops to 10 high-quality ops (7 read + 3 write)
- Removed 22 noise/niche/broken ops (danmaku protobuf, niche user stats, live, ranking, etc.)
- Cleaned 62 browser-injected params (w_rid, wts, web_location, dm_*) from example files
- Fixed getLiveRoomInfo example: `uids` → `room_ids` to match schema
- Fixed binary response handling: `parseResponseBody` now gracefully returns raw text for `application/octet-stream` and protobuf content types
- Consolidated JSON parsing: `browser-fetch-executor` and `cache-manager` now use shared `parseResponseBody` instead of inline JSON.parse
- Created searchVideos example file
- Updated DOC.md for pruned op set
- Updated adapter: removed dead handlers (getRanking, getUserFollowStats, getUploaderStats)

**Key files:** `src/sites/bilibili/openapi.yaml`, `src/sites/bilibili/adapters/bilibili-web.ts`, `src/sites/bilibili/DOC.md`, `src/sites/bilibili/examples/`, `src/lib/response-parser.ts`, `src/runtime/browser-fetch-executor.ts`, `src/runtime/cache-manager.ts`, `src/runtime/http-executor.ts`
**Verification:** 7/7 read ops PASS, 3 write ops untested (require auth)
**Blockers:** None

## 2026-03-30: Add --write flag to verify, safe_mutation TODO

**What changed:**
- `openweb verify <site> --write` includes write/delete ops (transact always excluded)
- For developer use during compile QA and pre-release testing
- TODO comments for future `safe_mutation` value (idempotent writes like/follow/bookmark)

**Key files:** `src/lifecycle/verify.ts`, `src/commands/verify.ts`, `src/cli.ts`, `src/compiler/types-v2.ts`
**Commit:** a93ef5b
**Blockers:** None

## 2026-03-30: Add --browser flag to verify command

**What changed:**
- `openweb verify <site> --browser` auto-starts managed browser and verifies page-transport ops
- Browser connection shared across all ops, disconnected after verify
- Managed browser process left running (user may want it for subsequent commands)

**Why:**
- 29 sites use page transport and always FAIL verify without browser. No way to verify them without manual `openweb browser start` first.

**Key files:** `src/commands/verify.ts`, `src/cli.ts`
**Verification:** `pnpm build` passes, `pnpm dev verify stackoverflow` PASS
**Commit:** 79483f1
**Next:** None
**Blockers:** None

## 2026-03-30: Unify verify — single verify system for compile + health check

**What changed:**
- Deleted `compiler/verify-v2.ts` (305 lines) and its test (384 lines) — raw-fetch verify replaced by `lifecycle/verify.ts` (`verifySite()`)
- `verifySite()` now filters by `replaySafety` instead of HTTP method: safe POST ops (YouTube Innertube, GraphQL queries) are now verified instead of skipped
- ReplaySafety resolution chain: `replay_safety` in example file → `x-openweb.permission` in openapi.yaml → HTTP method fallback
- Generator writes `replay_safety` to `examples/*.example.json`
- `compile.ts` calls `verifySite(site)` instead of `verifyPackage()` — cookie extraction and `--probe`/`--cdp-endpoint` CLI flags removed
- Compile verify report now uses `SiteVerifyResult` format (same as `openweb verify`)

**Why:**
- Two verify systems doing the same job with different plumbing. The executor-based path (`verifySite`) handles all transports, auth resolvers, CSRF, and fingerprinting — strictly more capable than verify-v2's raw fetch.
- Method-based filtering wrongly skipped safe POST operations (GraphQL queries, Innertube API).

**Key files:** `src/lifecycle/verify.ts`, `src/commands/compile.ts`, `src/compiler/generator/generate-v2.ts`, `src/cli.ts`, `src/compiler/types-v2.ts`
**Verification:** `pnpm build` passes, 717/718 tests pass (1 pre-existing navigator test failure)
**Commit:** 7dbfc17, 1b48e1d
**Next:** None
**Blockers:** None

## 2026-03-29: Merge v1+v5 site packages for 8 hard sites

**What changed:**
- Merged hand-crafted v1 packages (write ops, adapters, curated auth) with auto-discovered v5 packages (broad API coverage) for 8 sites
- Sites: zhihu(16 ops), bilibili(32), weibo(21), reddit(10), instagram(15), youtube(10), amazon(6), douban(14) — 124 total ops, 24 write ops
- 5 L3 adapters retained: zhihu-web, bilibili-web, weibo-web, amazon-cart, douban-dom
- Instagram transport changed from node to page (browser context required for API headers)
- Reddit simplified to public L1 JSON endpoints (no auth required)
- Discord trimmed to 4 HTTP ops (WS/AsyncAPI coverage removed pending re-discovery)
- X site package removed (DOC.md retained for future re-discovery)
- All 124 operations verified

**Why:**
- V5 rediscovery produced broader API coverage than v1 hand-crafted packages, but missed write ops and adapters. Merging preserves the best of both: v5 coverage + v1 write ops + v1 adapters.

**Key files:** `src/sites/{zhihu,bilibili,weibo,reddit,instagram,youtube,amazon,douban}/`
**Commit:** 4751b13
**Next:** Re-discover x, discord WS, additional write ops
**Blockers:** None

## 2026-03-29: Fix WS empty-URL guard, ENAMETOOLONG prevention, instagram transport

**What changed:**
- `apply-curation.ts`: WS empty-URL guard — find first connection with a URL instead of blindly taking `connections[0]`; return empty plan if no URL found
- `generate-v2.ts`: ENAMETOOLONG prevention — truncate operation IDs > 200 chars in example filenames with hash suffix; empty WS URL guard throws descriptive error
- `navigator.test.ts`: Instagram transport assertion updated from `node` to `page` to match merged spec

**Why:**
- Some captured WS connections have empty URLs (browser internals). Without the guard, the compiler crashes on `new URL('')`.
- Auto-generated operation IDs from long API paths can exceed filesystem filename limits (255 bytes), causing ENOENT/ENAMETOOLONG on example file write.

**Key files:** `src/compiler/curation/apply-curation.ts`, `src/compiler/generator/generate-v2.ts`, `src/runtime/navigator.test.ts`
**Verification:** `pnpm test` passes; compile pipeline handles edge cases gracefully
**Commit:** 023f77c
**Next:** None (bug fixes complete)
**Blockers:** None

## 2026-03-29: Fix capture model, restore flowchart & incremental discovery

**What changed:**
- Capture Target Binding: rewrote to reflect actual browser-wide capture behavior (auto-attaches new tabs via `context.on('page')`), replacing incorrect single-target model
- Capture Troubleshooting: updated causes/fixes to match corrected capture model (pre-existing tabs, separate Playwright connections)
- Multi-Worker: rewritten as explicit numbered rules (one worker starts capture, each opens new tab, last worker stops)
- Restored Mermaid flowchart deleted in 0d3ec46 (token-budget cut was too aggressive)
- Restored Incremental Discovery section deleted in 0d3ec46

**Why:**
- Capture Target Binding was wrong: said capture attaches to ONE target, advised closing other tabs. Actual code (`src/capture/session.ts:247-270`) attaches to `pages()[0]` + all new tabs via `context.on('page')`. The real failure mode is pre-existing tabs or separate Playwright connections, not "wrong tab".
- Flowchart and Incremental Discovery provide high value relative to token cost.

**Key files:** `skill/openweb/references/discover.md`
**Verification:** git diff shows +64/-20 lines; all 4 sections updated surgically
**Commit:** a3537cc
**Next:** N8 (mixed-traffic auth warning in compile.md), N9 (ops checklist per archetype), N10 (multi-worker stop warning)
**Blockers:** None

## 2026-03-29: Fix N5/N6/N7 — git recovery fast-path, tab switching, SPA search

**What changed:**
- N5 (4/7): Expanded rediscovery fast-path with 3-tier file recovery: worktree → compile cache → `git show HEAD:` for deleted files
- N6 (3/7): Added tab switching guidance to browsing tips (profile sub-tabs, feed tabs, sort tabs)
- N7 (3/7): Added SPA search box rule — use on-page search widget, not URL navigation (avoids SSR HTML)
- Token-budget cuts: trimmed login tip, removed SSR fast-fail check (redundant with Step 4a), removed "Different search terms" (covered by "Vary inputs"), compressed multi-worker section

**Why:**
- V5 analysis: 4/7 agents lost prior-round knowledge when files were deleted from worktree, 3/7 missed tab-specific endpoints, 3/7 got SSR HTML instead of JSON search API

**Key files:** `skill/openweb/references/discover.md`
**Verification:** git diff shows +21/-20 lines (token-neutral)
**Commit:** 8697bb1
**Next:** N8 (mixed-traffic auth warning in compile.md), N9 (ops checklist per archetype), N10 (multi-worker stop warning)
**Blockers:** None

## 2026-03-29: Fix N1/N2/N3/N4 — v5 capture and write-op discovery gaps

**What changed:**
- N1 (7/7): Added Capture Troubleshooting table after Step 2 (symptom/cause/fix for 5 common failures)
- N2 (5/7): Added Capture Target Binding section explaining CDP single-target behavior — the #1 silent failure mode
- N3 (5/7): Added write-op execution guidance: click UI buttons (with selector patterns) + call write APIs via page.evaluate(fetch())
- N4 (4/7): Elevated page.evaluate(fetch()) from one-line fallback to primary capture strategy with own subsection
- Token-budget cuts: removed Mermaid flowchart (-25 lines), Incremental Discovery section (-5), Step 7 LinkedIn examples (-12), compressed auth bullets (-5)

**Why:**
- V5 rediscovery analysis (7 sites) showed: all 7 lost time to capture failures, 5/7 had silent HAR misses from wrong CDP target, 5/7 captured zero/minimal write ops despite guidance saying "do writes"

**Key files:** `skill/openweb/references/discover.md`
**Verification:** git diff shows +75/-67 lines (net +8, token-neutral)
**Commit:** 0d3ec46
**Next:** Consider N5 (fast-path git recovery), N6 (tab switching), N7 (SPA search), N8 (mixed-traffic auth warning in compile.md)
**Blockers:** None

## 2026-03-29: Fix top 3 discovery doc problems (P1/P3/P4)

**What changed:**
- P1: discover.md "Before You Start" now scales reading to context — existing sites read DOC.md/openapi.yaml instead of 3 knowledge files
- P3: Strengthened write-action mandate in discover.md Step 1; added write-op recovery guidance in compile.md Step 3a (prevents deleting real write ops with auto-curated names)
- P4: Added SPA navigation rule + SSR fast-fail check to discover.md Step 2
- Token-budget cuts: deduplicated 2b noise list (→ pointer to 3a), compressed anti-pattern section, removed redundant items

**Why:**
- V4 rediscovery analysis showed 7/8 agents wasted context on knowledge reading, 6/8 missed write ops, 5/8 used wrong navigation pattern

**Key files:** `skill/openweb/references/discover.md`, `skill/openweb/references/compile.md`
**Verification:** git diff shows +38/-34 lines (token-neutral)
**Commit:** 45a9d0d
**Next:** Consider fixing P2 (capture troubleshooting table), P7 (lazy-load/tabs guidance)
**Blockers:** None

## 2026-03-28: Pipeline v2 session — full audit, refactor, and site expansion

**Scope:** ~70 commits (e8527ba..f8e0e8c), covering pipeline v2 implementation, full audit cycle, runtime ergo fixes, LinkedIn discovery, workflow redesign, and regression testing.

**Pipeline v2 (core refactor):**
- Compile pipeline refactored from 12 ad-hoc steps to 5 typed phases: Capture → Analyze → Curate → Generate → Verify
- New type system (`types-v2.ts`) defines contracts at every phase boundary (CaptureBundle, AnalysisReport, CuratedCompilePlan, VerifyReport)
- Labeler replaces filter — every sample categorized (api/static/tracking/off_domain), nothing silently dropped
- Path normalization structural (numeric/uuid/hex) + cross-sample learned, runs before clustering
- GraphQL sub-clustering by operationName/queryId/persistedHash/queryShape with virtual paths for collision avoidance
- Auth candidate ranking with evidence: localStorage_jwt > exchange_chain > cookie_session
- Schema-v2 inference with enum detection, format annotation (date-time/uuid/email/uri), size controls
- Curation phase (NEW): AnalysisReport + CurationDecisionSet → CuratedCompilePlan with PII scrubbing
- Generate-v2: response variants per status code, operationId deduplication, request body schemas
- Verify-v2: unified auth-first escalation replacing verify+probe split, per-attempt diagnostics

**Full pipeline audit:**
- Filter audit: 17 filters across 4 layers reviewed, 7 changed. Content-type filter removed, body-size-gate only at capture.
- Cluster/classify audit: path normalization, GraphQL clustering, extraction signals
- Generator audit: response variants, x-openweb emission, operationId uniqueness
- Verify audit: auth-first escalation, page-transport skip, bounded concurrency
- Schema inference audit: enum/format detection, size controls
- PII exposure audit: scrub.ts removes tokens, emails, phone numbers, cookies from examples
- `risk_tier` removed from generator and schema (unused)

**Runtime ergonomics:**
- Operation timeout (30s default, `"timeout"` in config.json) with timer leak fix
- Token cache deadlock fix: 10s lock acquisition timeout, `_unsafe` lock-free variants
- Auto-navigate fallback: opens new tab when no matching page exists
- JSON auto-stringify: object values auto-stringify for string params with `x-openweb-json-schema`

**LinkedIn:**
- Discovered and working: 5/5 target intents, 71 operations via Voyager API
- All read operations verified through runtime QA

**CSRF detection:**
- Code proposes candidates ranked by confidence; agent disposes (selects or overrides)
- Client hints excluded, quote-stripping, sends on all methods

**--example fix:**
- `--example` flag now loads real params from `examples/*.example.json` fixtures
- `tests/` renamed to `examples/` across entire pipeline

**SKILL.md:**
- Exec flow reads DOC.md first before trying operations
- Site-doc template adds Quick Start section

**Workflow redesign:**
- Unified discover loop with runtime verify as exit criterion
- Compile skill doc Step 5 delegates to compile.md, clear pipeline improvement report

**Regression test:**
- 0 regressions across 41 sites after pipeline v2, 15 verified end-to-end

**Site count:** 68 sites (67 + LinkedIn), 735 tests passing

**Key commits:** e8527ba..f8e0e8c (~70 commits)
**Next:** Site coverage expansion, compile real sites through v2 pipeline
**Blockers:** None

---

## 2026-03-28: Fix --example flag, rename tests→examples

**What changed:**
- `--example` in `exec` path was silently ignored (routed to exec, not show) — now intercepted correctly
- `renderExample` loads real params from `examples/*.example.json` fixtures instead of generating useless `<paramName>` placeholders from schema
- Generator now writes `example:` field on OpenAPI parameters from compile-time `exampleInput`
- Renamed `tests/` → `examples/` across entire pipeline (generators, verify, navigator) — backward compat preserved for installed packages with legacy `tests/` dirs
- Dropped schema-based fallback in renderExample — if no fixture exists, says so clearly

**Why:**
- QA agent spent 6 minutes on LinkedIn because `--example` was broken — every operation failed on first try. With working `--example`, same QA takes ~30 seconds.

**Key files:** `src/cli.ts`, `src/runtime/navigator.ts`, `src/compiler/generator/generate-v2.ts`, `src/compiler/generator/openapi.ts`, `src/compiler/generator/asyncapi.ts`, `src/lifecycle/verify.ts`
**Verification:** 735/735 tests pass, `pnpm dev linkedin exec voyager_identity_profiles --example` returns real queryId hash
**Commit:** 162c78f
**Next:** Copy LinkedIn `examples/` into `src/sites/linkedin.com/` source package
**Blockers:** None

## 2026-03-27: Runtime ergonomics fixes

**What changed:**
- Operation timeout in `dispatchOperation` — 30s default, configurable via `"timeout"` in `~/.openweb/config.json`. Fixed timer leak (cleared via `.finally()`)
- Auto-navigate fallback in session-executor — when no matching page exists, opens a new tab to the site URL before throwing `needs_page`
- Token cache `withLock` — 10s lock acquisition timeout prevents deadlocks on stale locks
- JSON auto-stringify in param-validator — object values auto-stringify for string params with `x-openweb-json-schema`
- Token cache `_unsafe` variants — lock-free `readTokenCacheUnsafe`, `writeTokenCacheUnsafe`, `clearTokenCacheUnsafe` for use inside `withTokenLock` to avoid double-locking
- Compile skill doc updated: new "Runtime QA" sub-step (4c) in verify step

**Key files:** `src/runtime/http-executor.ts`, `src/runtime/session-executor.ts`, `src/runtime/token-cache.ts`, `src/lib/param-validator.ts`, `skill/openweb/references/compile.md`
**Verification:** Code review, timer leak fix applied
**Next:** Runtime QA on real sites
**Blockers:** None

## 2026-03-27: Pipeline v2 — design gap fixes

**What changed:**
- `--allow-host` CLI flag wired through compile → analyze → labeler for cross-domain API support (e.g., chatgpt.com → api.openai.com)
- Page-transport operations now skip cleanly in verify with `needs_browser` reason instead of failing
- Verify summary breakdown distinguishes write-skips from page-skips: `5 pass, 13 skipped (write), 12 skipped (page), 58 fail`
- Extraction signal detection expanded: new `page_global` type detects `window.__INITIAL_STATE__`, `__NUXT__`, `__NUXT_DATA__` etc. via regex on DOM HTML
- CSRF alternatives surfaced: `csrfOptions: CsrfPrimitive[]` on AnalysisReport, `csrfType` override in CurationDecisionSet
- Tiered example value selection: schema-derived (enum/format/type) → most frequent observed (PII-scrubbed) → fallback. Replaces naive `values[0]`
- Discover → compile handoff checklist added to skill doc (markdown template, no JSON schema)

**Why:**
- Round 3 compliance review identified 7 design gaps blocking architecture-complete sign-off. These were the bounded, implementable fixes (KISS design). Report tier slimming and browser-based verify deferred pending real site testing.

**Key files:** `src/compiler/verify-v2.ts`, `src/compiler/types-v2.ts`, `src/compiler/analyzer/classify.ts`, `src/compiler/analyzer/auth-candidates.ts`, `src/compiler/analyzer/example-select.ts` (new), `src/compiler/analyzer/analyze.ts`, `src/compiler/curation/apply-curation.ts`, `src/commands/compile.ts`, `skill/openweb/references/discover.md`
**Verification:** 704 tests pass, no lint errors
**Next:** Run sites through updated pipeline to validate; defer report tier slimming and browser-verify until real patterns observed
**Blockers:** None

## 2026-03-26: Pipeline v2 — compile pipeline refactor from 12 steps to 5 phases

**What changed:**
- Complete pipeline refactor: 12 ad-hoc steps replaced by 5 typed phases (Capture -> Analyze -> Curate -> Generate -> Verify)
- New type system: `types-v2.ts` defines contracts for every phase boundary (CaptureBundle, AnalysisReport, CuratedCompilePlan, VerifyReport)
- Phase 2 (Analyze): unified `analyzeCapture()` orchestrator with new modules:
  - `labeler.ts` — categorizes every sample (api/static/tracking/off_domain), nothing dropped
  - `path-normalize.ts` — structural (numeric/uuid/hex) + cross-sample learned normalization
  - `graphql-cluster.ts` — sub-clusters GraphQL by operationName/queryId/persistedHash/queryShape
  - `auth-candidates.ts` — ranked auth detection with evidence (localStorage_jwt > exchange_chain > cookie_session)
  - `schema-v2.ts` — JSON schema inference with enum detection, format detection (date-time/uuid/email/uri), size controls
- Phase 3 (Curate): NEW phase — `apply-curation.ts` transforms AnalysisReport + decisions into CuratedCompilePlan, `scrub.ts` removes PII from examples
- Phase 4 (Generate): `generate-v2.ts` consumes CuratedCompilePlan, emits response variants per status code, deduplicates operationIds, includes request body schemas
- Phase 5 (Verify): `verify-v2.ts` replaces verify+probe with unified auth-first escalation, replaySafety gating, per-attempt diagnostics
- Report format: analysis.json (stripped) + analysis-full.json + verify-report.json + summary.txt
- Config files moved from `src/lib/filters/` to `src/lib/config/` (added tracking-cookies.json, static-extensions.json)
- V1 dead code: prober.ts, generator/openapi.ts, generator/package.ts, generator/asyncapi.ts, generator/index.ts only used by their own tests

**Why:**
- The v1 pipeline was a linear chain of loosely-typed transforms with no clear phase boundaries. Auth detection was fragile (single-shot classify), no PII scrubbing, no response variant modeling, verify and probe were separate systems. The refactor establishes typed contracts between phases, enables agent-in-the-loop curation, and makes each phase independently testable.

**Key files:** `src/compiler/types-v2.ts`, `src/compiler/analyzer/analyze.ts`, `src/compiler/curation/apply-curation.ts`, `src/compiler/curation/scrub.ts`, `src/compiler/generator/generate-v2.ts`, `src/compiler/verify-v2.ts`, `src/commands/compile.ts`
**Verification:** Tests pass. LinkedIn compile produces correct operation set through v2 pipeline.
**Commits:** ff92201..99a52cb (pipeline v2 implementation), plus 6 fix rounds
**Next:** Clean up v1 dead code (prober.ts, generator/index.ts, generator.test.ts), expand site coverage
**Blockers:** None

## 2026-03-26: Filter audit — compile pipeline overhaul

**What changed:**
- Compile pipeline filter audit: 17 filters across 4 layers reviewed, 7 changed
- `responseJson` replaced with discriminated union `SampleResponse` (json | text | empty) — write ops with empty/non-JSON responses now captured
- L0 HAR capture: removed all content-based filtering, replaced with 1MB body-size-gate. HAR is now complete raw data.
- L2 filter: non-2xx status no longer rejected (4xx = auth signal), off-domain reported separately instead of silent drop
- Filter lists (blocked domains, blocked paths) extracted to config JSON files (`src/lib/filters/`)
- WS MIN_WS_FRAMES lowered from 10 to 5
- `verifyOperation()` timeout added (was hanging indefinitely), content-type filter removed (was rejecting 95% of LinkedIn API traffic)
- HAR deduplication (parsed once, shared), verify + probe parallelized with bounded concurrency

**Why:**
- LinkedIn compile investigation revealed compile producing 8 infrastructure-noise endpoints instead of 61 real API operations. Root causes: content-type filter, no verify timeout, double HAR parse, sequential execution.

**Key files:** `src/compiler/types.ts`, `src/compiler/recorder.ts`, `src/capture/har-capture.ts`, `src/compiler/analyzer/filter.ts`, `src/commands/compile.ts`, `src/compiler/prober.ts`, `src/lib/filters/*.json`
**Verification:** 558 tests pass. LinkedIn compile: 8 → 61 operations, 8.7s → 4.4s.
**Commit:** e8527ba..cdb76cb (8 commits)
**Next:** Implement remaining filter audit items (F-1.2/F-1.3 union type for WS frames, binary protocol support — future work)
**Blockers:** None

## 2026-03-26: Redfin — expand coverage from 3 to 7 ops

**What changed:**
- Added 4 new operations: getListingPhotos, getPriceHistory, getMarketInsights, getSimilarHomes
- All new ops use DOM extraction from SSR-rendered property detail pages
- Test files added for all 7 operations
- DOC.md updated with full operation table and extraction details

**Why:**
- Expand real estate vertical coverage for core research intents (photos, history, market conditions, comparables)

**Verification:** All 7 operations PASS via `openweb verify redfin`

## 2026-03-26: npm — expand coverage from 2 to 6 ops

**What changed:**
- Added 4 new operations: getPackageVersion, getDistTags, getDownloadStats, getDownloadRange
- Per-operation server override for api.npmjs.org download endpoints
- DOC.md updated with all 6 operations

**Why:**
- Expand npm beyond search/metadata to include version details and download statistics

**Verification:** All 6 operations PASS via `openweb verify npm`

## 2026-03-26: CoinGecko — expand coverage from 3 to 8 ops

**What changed:**
- Added 5 new operations: getCoinDetail, getCoinMarketChart, getTrendingCoins, getGlobalData, getExchanges
- DOC.md updated with all 8 operations, API architecture notes, and known rate limiting issues
- Test files added for all new operations

**Why:**
- Expand CoinGecko coverage for coin detail, historical charts, trending, global market data, and exchanges

**Verification:** 7/8 PASS (getPrice transient 429 rate limit)

## 2026-03-26: M38 — Skill review + doc polish + lint + publish prep

**What changed:**
- skill/openweb/ fully rewritten: SKILL.md router (5 intents), discover.md (iterative loop), compile.md (decision model + WS track)
- 7 new knowledge files: ws-patterns, bot-detection-patterns, extraction-patterns, graphql-patterns, archetypes split (5 deep files)
- site-doc.md moved from doc/todo/ to references/
- Lint clean on core code (44 files), gitignore cleaned (.claude/projects/, tmp/)
- CLAUDE.md synced with M33-M36 architecture
- Compile report implemented (filtered.json, clusters.json, classify.json, probe.json, summary.txt)
- Write operation compilation enabled (mutation filter removed, verify skips writes)
- --capture-dir flag implemented
- Request body schema inference for write ops
- 67/67 sites have DOC.md + PROGRESS.md
- 560 tests, build clean

**Why:**
- Skill docs needed rewrite for intent-based routing and WS support. Lint + doc cleanup for publish readiness.

**Key files:** skill/openweb/, CLAUDE.md, src/compiler/, .gitignore
**Verification:** `pnpm build` clean, `pnpm test` 560/560 pass, `pnpm lint` clean
**Next:** M37 site coverage expansion (16 HIGH + 6 MEDIUM re-discovery)
**Blockers:** None

## 2026-03-25: M36 — Codebase review + refactor

**What changed:**
- Double-design audit (Claude + Codex), 27 tasks across 5 phases
- 3 oversized files split (executor, openapi, classify)
- Schema-type alignment (fallback removed, heartbeat added, ws_count required)
- Capture session resource leaks fixed
- Compile→verify pipeline repaired (5 silent-drop points)
- Logger utility, standardized error handling (OpenWebError everywhere)
- SSRF validation mandatory, token cache race condition fixed
- Barrel exports, executor result types unified, 6 oversized adapters split
- 559 tests passing

**Why:**
- Systematic quality pass before publish. Double-design audit surfaced 27 issues across architecture, types, and pipeline.

**Key files:** src/runtime/executor.ts, src/lib/openapi.ts, src/compiler/analyzer/classify.ts, src/lib/errors.ts, src/lib/logger.ts
**Verification:** `pnpm build` clean, `pnpm test` 559/559 pass
**Next:** M37 skill rewrite, M38 publish prep
**Blockers:** None

## 2026-03-25: M35 — WebSocket + AsyncAPI support

**What changed:**
- Full WS pipeline: capture → load → cluster → classify → schema → AsyncAPI 3.0 emitter
- WS runtime: connection manager (7-state machine), router, executor, pool, 4 auth primitives
- Coinbase Exchange E2E (compiler-generated asyncapi.yaml, 14 CI tests)
- WhatsApp Web exploration (binary WS, Store-level access breakthrough)
- Discord Gateway handwritten fixture (12 ops)
- 498 tests

**Why:**
- WebSocket support is essential for real-time sites (Discord, Coinbase, WhatsApp). AsyncAPI 3.0 is the spec standard for event-driven APIs.

**Key files:** src/compiler/ws-analyzer/, src/runtime/ws-executor.ts, src/runtime/ws-connection.ts, src/runtime/ws-router.ts, src/compiler/generator/asyncapi.ts
**Verification:** `pnpm build` clean, `pnpm test` 498/498 pass, Coinbase WS E2E works
**Next:** M36 codebase review
**Blockers:** None

## 2026-03-25: M34 — Token cache encrypted storage

**What changed:**
- AES-256-GCM vault.json with PBKDF2 machine-binding
- 20 token-cache tests

**Why:**
- Auth tokens cached to disk need encryption at rest. Machine-binding prevents token theft via file copy.

**Key files:** src/runtime/token-cache.ts
**Verification:** `pnpm test` — 20 token-cache tests pass
**Next:** M35 WebSocket support
**Blockers:** None

## 2026-03-25: M33 — npm publish + install story

**What changed:**
- src/fixtures/ → src/sites/ rename (562 files)
- @openweb-org/openweb package, playwright-core migration
- dist/sites/ build step, bundled read-only resolution
- LICENSE, README, pack:check
- 284kB tarball, global install works

**Why:**
- Package must be installable via npm for end users. Sites bundled in dist/ for zero-config usage.

**Key files:** package.json, tsup.config.ts, src/lib/site-resolver.ts, src/sites/
**Verification:** `pnpm build` clean, `pnpm pack` → 284kB, global install resolves sites
**Next:** M34 token cache encryption
**Blockers:** None

## 2026-03-24: Post-M26 Cleanup — fixtures, knowledge, roadmap

**What changed:**
- Deleted 29 trivial public API fixtures (catfact, chucknorris, etc.) — no user value, direct curl works
- Deleted `src/knowledge/` (failures.ts, heuristics.ts) — superseded by `skill/openweb/references/knowledge/` markdown files
- 3 fixtures refactored: google-flights, google-search, redfin inline JS → adapter files (extraction complexity rule)
- Navigator reads DOC.md instead of legacy notes.md; 6 old notes.md deleted
- Per-fixture DOC.md + PROGRESS.md documentation system (guide at doc/todo/site_doc/guide.md)
- New M27 defined: 30 consumer sites batch 2 (healthcare, automotive, jobs, travel, China sites)
- M29 orchestration reflection written (doc/todo/v2_m29/summary.md)
- Roadmap renumbered: M27→M31 shifted for new consumer sites milestone

**Why:**
- Trim dead weight (trivial fixtures, code-based knowledge). Focus fixtures on real consumer value. Document learnings before they fade.

**Key files:** doc/todo/roadmap.md, doc/todo/v2_m27/sites.md, doc/todo/v2_m29/summary.md, doc/dev/development.md
**Verification:** `pnpm build` clean (10 adapters), `pnpm test` 356/356 pass
**Commit:** 548dea1..c31741f
**Next:** M27 consumer sites batch 2, or quality review of M26 fixtures
**Blockers:** None

## 2026-03-24: M26 — Consumer Sites Discovery — 13/16 DONE

**What changed:**
- 13 consumer sites discovered via CDP capture with real fixtures:
  - E-commerce: walmart (3 ops), bestbuy (3), costco (2), target (3), amazon (3)
  - Travel: google-flights (3), uber (3)
  - Real estate: redfin (3)
  - Food: doordash (3)
  - Search/Maps: google-search (3), google-maps (3)
  - Social: xiaohongshu (3)
  - DevTools: gitlab (8) — pre-existing from earlier
- 3 sites blocked: yelp (DataDome), zillow (PerimeterX), tiktok (X-Bogus custom signing)
- Per-fixture DOC.md + PROGRESS.md documentation system created (guide at doc/todo/site_doc/guide.md)
- Navigator changed to read DOC.md instead of legacy notes.md; 6 old notes.md deleted
- Extraction complexity rule added to compile.md: >5 lines inline JS → extract to adapters/*.ts
- 3 fixtures refactored: google-flights, google-search, redfin — inline JS moved to adapters/
- Orchestration improvements: independent verification catches empty commits, acceptCriteria with target intents

**Why:**
- M26 redefined from API sites to consumer sites (no free public API). These are openweb's core value proposition — sites where users need to reverse-engineer the web client's internal API.

**Key files:** 13 new fixture dirs in src/sites/, doc/todo/site_doc/guide.md, skill/openweb/references/compile.md
**Verification:** `pnpm build` clean (10 adapters), `pnpm test` 367/367 pass
**Commit:** 72a09ac..eede864
**Next:** Quality review of 13 fixtures, then decide M27 (API sites) vs M29 (reflect)
**Blockers:** 3 blocked sites (bot detection)

## 2026-03-23: Doc Normalize — align docs with /init-all + /update-doc standards

**What changed:**
- Created `CLAUDE.md` (28 lines) + multi-agent symlinks (`AGENTS.md`, `GEMINI.md`, `.agents/`, `.codex/`)
- Archived 26 completed milestones (`doc/todo/v2_m0`–`v2_m25` → `doc/archive/YYYYMMDD_v2_mN/`)
- Relocated non-standard files: `blocked.md` → `todo/`, `mission.md` → `main/`, `ref/` → `archive/ref/`, `note.md` → `archive/`
- Split `primitives.md` (410 lines) → `doc/main/primitives/` subdirectory (README.md + auth.md + signing.md)
- Split `roadmap.md` (996 lines) → active-only (136 lines) + `archive/roadmap-completed.md`
- Trimmed `adding-sites.md` (357→286) and `development.md` (340→205)
- Moved skill to project root: `.claude/skills/openweb/` → `skill/openweb/` (symlink back for Claude Code)
- Deleted stale `doc/knowledge/` (canonical knowledge lives in `skill/openweb/references/knowledge/`)
- Updated all `-> See:` pointers, skill path refs in `architecture.md`, README.md timestamp

**Why:**
- Docs had drifted from `/init-all` and `/update-doc` standards: no CLAUDE.md, completed milestones in todo/, oversized files, duplicated knowledge, no multi-agent symlinks

**Key files:** `CLAUDE.md`, `doc/main/primitives/`, `doc/todo/roadmap.md`, `doc/archive/`, `skill/openweb/`, `doc/main/architecture.md`, `doc/main/README.md`
**Verification:** All SOTA doc files ≤300 lines, no stale `primitives.md` or `.claude/skills/openweb` refs in active docs, all symlinks resolve
**Commit:** (this commit)
**Next:** M26 redo or M29 (user login → discover all)
**Blockers:** None

## 2026-03-23: M26 — Agent Discover: bearer_token / api_key sites — NOT DONE

**What changed:**
- Attempted discovery on 35 sites via 4 parallel multmux workers
- 29 sites blocked (need login) — recorded in `doc/blocked.md`
- 6 sites claimed "compiled" but **produced zero fixtures** — workers wrote empty commits with convincing messages
- Archetypes knowledge updated with discovery learnings (legitimate)

**What went wrong:**
- Workers committed "feat: discover X — N operations via CDP capture" messages but no `src/sites/<site>-fixture/` directories were created
- 4 commits had zero file changes; 2 commits only had helper scripts
- No post-commit validation caught this — commit messages were trusted as verification

**Key learning:**
- Worker commit messages cannot be trusted. Need machine-verifiable acceptance criteria (`test -f src/sites/<site>-fixture/openapi.yaml`)
- Most "bearer_token/api_key" sites need dashboard login for meaningful traffic — B/C classification is irrelevant for discovery

**Key files:** `doc/blocked.md`, `.claude/skills/openweb/references/knowledge/archetypes.md`, `doc/todo/v2_m29/orchestration_notes.md`
**Verification:** 367/367 tests pass, but **0 new fixtures produced**
**Commit:** 0208e9e..ec6588d
**Next:** Redo M26 with proper fixture verification, or consolidate with M29 (user login → discover all)
**Blockers:** 29 sites need login; 6 sites need redo with proper verification

## 2026-03-23: M25 — Product Revisit: SKILL 重构 + Fixture 归档 — DONE

**What changed:**
- Double-design (Claude + Codex): independent designs, cross-review, 4-round align → final design at `doc/todo/v2_m25/final/design.md`
- SKILL.md rewritten as 73-line router (was 405 lines) — routes to references/ by intent
- Created `references/discover.md`, `references/compile.md`, `references/update-knowledge.md`, `references/cli.md`
- Moved `auth-patterns.md` and `archetypes.md` into `references/knowledge/`
- Updated `references/troubleshooting.md` with knowledge update routing
- Archived 83 M23 hand-written fixtures to `src/_archive/fixtures/` (84 dirs)
- Fixed 5 adapter bugs: telegram, whatsapp (import paths), discord (webpack cache), linear (GraphQL params), spotify (page transport)
- Task graph created: 92 tasks across M25-M29 in `doc/todo/tasks.json`

**Why:**
- M23 fixtures were hand-written (skipped CDP capture), modeled wrong APIs. Product revisit: OpenTabs = validation, not reference. SKILL.md was 405 lines loaded every invocation — restructured as router + on-demand references.

**Key files:** `.claude/skills/openweb/SKILL.md`, `.claude/skills/openweb/references/` (6 files + knowledge/), `src/_archive/fixtures/` (84 dirs), `doc/todo/v2_m25/` (design artifacts), `doc/todo/tasks.json`, `scripts/update-tasks.py`
**Verification:** `pnpm build` clean, `pnpm test` 367/367 pass, SKILL.md 73 lines
**Commit:** cf301bd..6286beb (5 impl commits) + 60d4c3e (design)
**Next:** M26 agent discover
**Blockers:** None

## 2026-03-19: M24 — Human Handoff + Permission System Review — DONE

**What changed:**
- Gap analysis: reviewed 10 potential gaps in permission/handoff system — 0 critical, 0 high, 3 medium, 1 low
- Fixed `needs_browser` error action: now suggests `openweb browser start` instead of raw Chrome flags
- Fixed `needs_login` error action: now suggests `openweb login <site>` instead of vague "log in"
- Fixed no-auth 401/403 path: shows login-relevant action instead of "Check parameters"
- Added 3 permission gate integration tests (write blocked, site override, read allowed)
- Roadmap updated with M24 results

**Why:**
- Ensure the permission system (read/write/delete/transact) has no bypass paths before expanding to more sites. Single chokepoint architecture (`executeOperation()`) confirmed sound.

**Key files:** `src/runtime/executor.ts`, `src/runtime/executor.test.ts`, `doc/todo/v2_m24/` (gap-analysis.md, design.md)
**Verification:** `pnpm build` clean, `pnpm test` 367/367 pass, 0 critical gaps
**Commit:** c86bb9d..dad1240
**Next:** M23 fixture fixes (5 real bugs), then M25 — Full Coverage
**Blockers:** None

## 2026-03-19: M23 — 105 Sites Full Compile + Auth + Read Ops — DONE

**What changed:**
- Phase 1: Verified all 17 A-class existing fixtures (healthy schemas, operations listed)
- Phase 2: Documented 5 D/E-class gaps (TikTok: custom_signing; Gemini/Minimax/Netflix/OnlyFans: L3 adapter)
- Phase 3: Created 35 B-class fixtures — public API / api_key / bearer_token pattern, modeled as regular OpenAPI parameters, `requires_auth: false`, `transport: node`
- Phase 4: Created 48 C-class fixture stubs with auth primitives (cookie_session, localStorage_jwt, sessionStorage_msal, page_global, sapisidhash) and proper transport (node/page)
- Phase 5: SKILL.md updated from 51 → 135 sites
- Codex review R1: Fixed auth patterns for costco (server URL + transport), google-calendar (cookie_session via gapi.client), airbnb (persisted-query URL pattern + headers), target (page_global API key extraction). Fixed grafana site_url/server URL. Added compiled_at to all 83 new manifests.
- **Redo — batch verify**: Ran headless Chrome + CDP verification on all 135 sites. Actual results: 46 PASS, 41 AUTH_FAIL, 47 ERROR
- **Fix plan**: Of 47 ERROR sites, 35 are not real bugs (placeholder params → reclassify as AUTH_FAIL). 5 truly fixable: telegram/whatsapp (adapter import paths), discord (webpack cache timing), linear (GraphQL param generation), spotify (page transport). 4 transient (instagram 500, expedia 429, grafana 530, yelp 400)
- **Status**: Fix plan documented, 5 fixture fixes pending execution

**Why:**
- Scale from 17 verified to 100+ fixture stubs covering all 105 OpenTabs plugins. B-class stubs model the public API alternative (no browser auth needed). C-class stubs encode the correct auth primitives for future login-and-verify.

**Key files:** 83 new `src/sites/<name>/` directories (openapi.yaml + manifest.json each), `doc/todo/v2_m23/` (verify_results.md, verify_results_actual.md, fix_plan.md, needs_login.md, gaps.md), `.claude/skills/openweb/SKILL.md`
**Verification:** `pnpm build` clean, `pnpm test` 364/364 pass (42 test files), `pnpm dev sites` = 135 sites, 1 codex review round resolved
**Commit:** 2b38ea9..f8cdc25
**Next:** Execute 5 fixture fixes (telegram, whatsapp, discord, linear, spotify), then M25
**Blockers:** 5 fixture fixes pending

## 2026-03-18: M22 — Coverage Sweep + Per-Site Notes — DONE

**What changed:**
- Phase 1: Per-site notes infrastructure — `renderSite()` shows `notes.md` first-line hint, `renderSiteJson()` includes `hasNotes` boolean. 5 L2 sites seeded with notes.md (Instagram, GitHub, YouTube, Discord, X)
- Phase 1: Archetype checklists — all 9 archetypes in `references/archetypes.md` now have Expected Operations checklists with checkbox format
- Phase 2: Coverage sweep — 144 sites surveyed across 15 archetypes. 51 A (existing), 29 B (L1 compilable), 41 C (L2 needs login), 13 D (needs new primitive), 8 E (needs L3 adapter), 2 F (not suitable)
- Phase 2: Gap analysis — 5 primitive gaps identified (custom signing, OAuth2 PKCE, WebSocket/SSE, multi-page extraction, Google Batch RPC). 8 L3 adapter sites documented
- Phase 3: Per-archetype coverage % added to archetypes.md. Architecture.md updated with M22 coverage data (replacing 103 OpenTabs estimate)
- 3 new navigator tests for notes display + hasNotes JSON

**Why:**
- Quantify real coverage capability before expanding site count. Gap analysis drives M23+ primitive priorities. Notes infrastructure captures non-code agent knowledge per site.

**Key files:** `src/runtime/navigator.ts`, `src/runtime/navigator.test.ts`, `.claude/skills/openweb/references/archetypes.md`, `doc/todo/v2_m22/coverage-report.md`, `doc/todo/v2_m22/gap-analysis.md`, 5 `notes.md` files
**Verification:** `pnpm build` clean, `pnpm test` 362 pass (42 test files), manual verify notes display for instagram/open-meteo
**Commit:** ad587b6..HEAD
**Next:** M23+ per roadmap — OAuth2 PKCE highest priority primitive gap
**Blockers:** None

## 2026-03-18: M21 — Distribution Prep — DONE

**What changed:**
- `openweb init` command: seeds 51 fixtures from `src/sites/` to `~/.openweb/sites/` (idempotent, skip-if-exists)
- `resolveSiteRoot()` priority reordered: `~/.openweb/sites/` → registry → `./src/sites/` (dev fallback). Removed unused `./sites/` search path
- `listSites()` aggregates all search paths with dedup
- CLI auto-exec: `openweb <site> <op> '{"json"}'` works without `exec` keyword (JSON arg detection). Old syntax still supported
- Extracted `parseExecOptions()` helper to deduplicate exec/auto-exec flag parsing
- `package.json`: added `files` (dist/ + src/sites/), `description`, `keywords`, `license`. Kept `private: true`
- `dist/cli.js` has shebang, verified `npm link` works globally from /tmp
- README.md (32 lines) for future npm page
- SKILL.md updated with simplified exec syntax in all examples

**Why:**
- Prepare openweb for global installation via npm — binary = code, `~/.openweb/sites/` = data
- Reduce agent token usage by eliminating the `exec` keyword in commands

**Key files:** `src/commands/init.ts` (new), `src/cli.ts`, `src/lib/openapi.ts`, `package.json`, `.claude/skills/openweb/SKILL.md`, `README.md`
**Verification:** `pnpm build` clean, `pnpm test` 359 pass, `npm link` + global exec from /tmp verified, init idempotency verified
**Commit:** 59fa464
**Next:** M22+ per roadmap
**Blockers:** None

## 2026-03-18: M20 — Codebase Cleanup — DONE

**What changed:**
- Phase 1: Deleted knowledge CLI (`knowledge.ts`, `patterns.ts`, `seed-patterns.ts` + tests), removed yargs registration from `cli.ts`, deleted `CompileSummary` interface + `generateReviewHints()` + `formatSummary()` from `compile.ts`, restored one-line compile output
- Phase 2: Unified 3 duplicate implementations — redirect (`executor.ts` private → `redirect.ts`), permission derivation (`executor.ts`/`sites.ts`/`navigator.ts` private → `lib/permission-derive.ts`), manifest loading (`navigator.ts` private → `lib/manifest.ts`). Deleted `generator.ts` pass-through wrapper. Fixed transact path detection bug in executor, sites, and navigator (was missing before unification)
- Phase 3: Deleted `session-executor.ts` re-export shim, updated 5 consumers to direct imports. Deleted `src/types/index.ts` barrel (zero importers). Fixed `generator.ts` TODO placeholder. Un-exported dead symbols (`archiveWithBump`, `pruneSite`, `getRegistryCurrentPath`, `Annotation`, `AuthResult`, `PrimitiveDeps`)
- Phase 4: Moved `parseResponseBody` tests to `response-parser.test.ts`. Moved integration tests to `tests/integration/`. Removed duplicate `resolveTransport`/`getServerXOpenWeb` tests from `session-executor.test.ts`
- Codex R1: Deleted dead `archiveWithBump()` and `getRegistryCurrentPath()` from `registry.ts`, replaced private `loadManifestFrom()` with shared `lib/manifest.ts`, removed stale knowledge CLI commands from architecture.md

**Why:**
- Net deletion milestone: remove M19 over-engineering, eliminate duplicate implementations, enforce single source of truth for redirect/permission/manifest logic. `references/` is the single knowledge source — CLI was redundant.

**Key files:** `src/cli.ts`, `src/runtime/executor.ts`, `src/runtime/navigator.ts`, `src/commands/sites.ts`, `src/commands/compile.ts`, `src/lifecycle/registry.ts`, `src/runtime/session-executor.ts`
**Verification:** `pnpm build` clean, 359 tests pass (42 test files), all 51 sites unaffected
**Commit:** ab7c7e1..e2b13c8 (5 commits)
**Codex reviews:** R1 (0 CRITICAL, 0 HIGH, 2 MEDIUM, 2 LOW — LOW fixed)
**Next:** M21+ per roadmap
**Blockers:** None

---

## 2026-03-17: M18 — Agent-Driven Discovery — DONE

**What changed:**
- Deleted all hardcoded discovery intelligence: `src/discovery/` (7 source + 4 test files), `src/commands/discover.ts`, `src/lifecycle/heal.ts` + `heal.test.ts`, `tests/benchmark/discovery/` (benchmark runner + sites). Net deletion: -2831 lines across 21 files.
- Cleaned CLI: removed `openweb discover` command registration and `--auto-heal` option from `openweb verify`. Simplified `verify.ts` by removing all heal imports, autoHeal code paths, and `printHealResult()`.
- Updated SKILL.md: replaced `### Discover` and `--auto-heal` sections with agent-driven discovery workflow (Step 0: think like a user, Step 1: capture+browse with playwright-cli, Step 2: compile+review).
- Updated architecture.md: removed Discovery component row, updated Lifecycle and CLI descriptions.
- Updated development.md: removed discover commands, auto-heal commands, discover.ts from project structure, discovery/ directory, heal.ts from lifecycle.

**Why:**
- Discovery intelligence belongs in the agent (Claude/Codex reading the skill doc), not in hardcoded heuristics. The agent can reason about each site individually, adapt to any UI, and handle edge cases without code changes.

**Key files:** `src/cli.ts`, `src/commands/verify.ts`, `.claude/skills/openweb/SKILL.md`, `doc/main/architecture.md`, `doc/dev/development.md`
**Verification:** `pnpm build` clean, 382 tests pass (45 test files), all 51 sites unaffected
**Commit:** 5f77d15..c958a41
**Codex reviews:** R1 (2 LOW: stale M17 tags, stale heal comment), R2 (1 HIGH: SKILL.md CLI commands, 1 MEDIUM: await recordFailures, 2 LOW: --report validation, benchmark wording) — all fixed
**Next:** Future considerations from design doc (annotate.ts, classify.ts agent delegation)
**Blockers:** None

---

## 2026-03-17: M17 — Operational Automation — DONE

**What changed:**
- Theme 1 (Self-heal): New `src/lifecycle/heal.ts` with `healSite()` — re-discovers drifted sites using the discovery pipeline, diffs old vs new spec by path+method, auto-accepts read operations, reports write/delete/transact changes. `--auto-heal` flag added to `openweb verify` command. Safety gates: auth_expired skipped, CAPTCHA/login-wall aborts heal. Successful heals archive with version bump via registry.
- Theme 2 (Knowledge Base): `src/knowledge/patterns.ts` — 25 seed pattern entries from M3-M16 reviews. `src/knowledge/heuristics.ts` — probe success rate tracking with 30-day staleness decay. `src/knowledge/failures.ts` — auto-records verify DRIFT/FAIL outcomes to `~/.openweb/knowledge/`. Prober records outcomes after each probe step.
- Theme 3 (KNOWN_GLOBALS Dynamic): `detectDynamicGlobals(page)` compares window keys against BROWSER_BASELINE to discover site-specific globals. `captureDomAndGlobals` accepts optional `extraGlobals` parameter. Filters out browser built-ins, frameworks, and analytics globals.

**Why:**
- Drift detection alone is insufficient — sites need automatic recovery for read operations without human intervention
- Knowledge base captures institutional knowledge from 16 milestones of site reviews, making future compilation and probing smarter
- Static KNOWN_GLOBALS missed site-specific globals; dynamic detection adapts to each page

**Key files:** `src/lifecycle/heal.ts`, `src/knowledge/patterns.ts`, `src/knowledge/heuristics.ts`, `src/knowledge/failures.ts`, `src/capture/dom-capture.ts`, `src/commands/verify.ts`, `src/cli.ts`
**Verification:** 423 tests pass (32 new), `pnpm build` clean
**Next:** M18+
**Blockers:** None

---

## 2026-03-17: M16 — Smart Discovery — DONE

**What changed:**
- Theme 1 (Intent-Driven Discovery): Page structure snapshot (`page-snapshot.ts`) extracts nav links, headings, buttons, forms, search inputs from DOM. Intent analysis (`intent.ts`) maps captured API paths + page structure to an intent checklist (profile/feed/search/detail/social/activity/meta + write intents). Gap analysis identifies page-visible intents not yet covered by captured APIs. Targeted exploration (`explorer.ts:exploreForIntents`) clicks only gap-related elements (max 3/intent, 15 total). Pipeline integrates snapshot → intent → targeted explore when `--intent` flag set.
- Theme 2 (human_handoff): `handoff.ts` detects CAPTCHA (recaptcha/hcaptcha/turnstile iframes, captcha classes), 2FA (verification code inputs, headings), and login walls (password forms, /login URLs). Returns structured `HumanHandoffNeeded` with actionable guidance. Pipeline checks before browser disconnect; surfaces in CLI output.
- Theme 3 (Discovery Benchmark): `tests/benchmark/discovery/` with 20 public API site configs, benchmark runner that discovers + verifies first GET op returns 2xx.
- Code review fixes: `filteredSamples` init to prevent TypeError on throw, `detail` intent pattern moved to end to avoid shadowing specific intents, CSS selector escaping for hrefs.

**Why:**
- Discovery was passive (record whatever happens) — now it has a goal (intent checklist) and explores strategically
- CAPTCHA/2FA/login wall detection prevents confusing "no operations" errors
- Benchmark quantifies discovery success rate for ongoing improvement

**Key files:** `src/discovery/page-snapshot.ts`, `src/discovery/intent.ts`, `src/discovery/explorer.ts`, `src/discovery/handoff.ts`, `src/discovery/pipeline.ts`, `src/commands/discover.ts`, `src/cli.ts`, `tests/benchmark/discovery/`
**Verification:** 386 tests pass (36 new), `pnpm build` clean
**Commit:** 3 commits (feat: intent-driven discovery, feat: human_handoff, fix: code review)
**Next:** M17
**Blockers:** None

---

## 2026-03-17: M15 — Compiler Maturity — IN PROGRESS

**What changed:**
- Phase 1: Compiler accepts PUT/PATCH/DELETE methods (previously GET/POST only). Annotate derives operationId for new verbs (update/patch/delete).
- Phase 2: Expanded analytics cookie denylist in classify — __cf_bm, __cfruid, NID, 1P_JAR, _gid, APISID, etc. excluded from cookie_session detection.
- Phase 3: New prober module (`src/compiler/prober.ts`) — escalation ladder validates classify heuristics with real GET requests (node_no_auth → node_with_auth → page). Rate limited (500ms), max 30 probes, 5s timeout, SSRF-validated.
- Phase 4: `--probe` / `--cdp-endpoint` flags wired into `openweb compile`. Connects to managed browser via CDP, runs probes after classify, merges probe results (ground truth) with classify heuristics before emission.

**Why:**
- Compiler now supports full CRUD APIs (not just GET/POST)
- Classify accuracy improved by excluding analytics cookies from auth detection
- Probe validates heuristic guesses with real requests — catches transport/auth misclassification

**Key files:** `src/compiler/prober.ts`, `src/commands/compile.ts`, `src/cli.ts`, `src/compiler/analyzer/classify.ts`, `src/compiler/analyzer/annotate.ts`, `src/compiler/recorder.ts`
**Verification:** 346 tests pass, `pnpm build` clean
**Commit:** Phases 1-4 committed individually
**Next:** Phase 5 doc sync (this entry), then M16
**Blockers:** None

---

## 2026-03-17: M14 — User Experience Foundation — DONE

**What changed:**
- Permission system: replaced 5-tier `risk_tier` (safe/low/medium/high/critical) with 4-category `permission` (read/write/delete/transact) across types, schema, compiler, navigator, and all 51 fixtures. Runtime enforcement gates execution against `~/.openweb/permissions.yaml` (defaults: read=allow, write=prompt, delete=prompt, transact=deny). When `x-openweb.permission` is absent, permission is derived from HTTP method (fail-closed).
- Browser lifecycle: `openweb browser start/stop/restart/status` + `openweb login <site>`. Selective Chrome profile copy (auth files only) to secure temp directory (mkdtemp, 0o700). PID/port management with CDP-verified shutdown. CDP auto-detect from managed browser.
- Token cache: `~/.openweb/tokens/<site>/` stores cookies + localStorage + sessionStorage after successful authenticated requests. JWT-aware TTL (extracts exp from JWT tokens in cookies/storage). Cache-first execution — cache hit skips browser entirely. 401/403 invalidates cache → browser fallback. Supports localStorage_jwt auth reconstruction from cache.
- CLI output: auto-spill (response > max-response → temp file + JSON pointer on stdout), `--json` for sites/show, `--example` for operation params, `--output file`.
- Security hardening (2 codex review rounds): shell injection fix (execFile+argv), profile copy perms, PID verification, spill file exclusive create, temp-profile cleanup validation, NaN metadata handling.

**Why:**
- Make openweb usable by both agents and humans without manual Chrome management
- Permission system provides safety gate for mutations (agent-first: structured errors instead of stdin prompts)
- Token cache eliminates browser dependency for repeated authenticated requests

**Key files:** `src/commands/browser.ts`, `src/runtime/token-cache.ts`, `src/lib/permissions.ts`, `src/runtime/executor.ts`, `src/types/extensions.ts`, `src/commands/exec.ts`, `src/runtime/navigator.ts`, `.claude/skills/openweb/SKILL.md`
**Verification:** 338 tests pass (23 new), `pnpm build` clean, 2 codex review rounds addressed
**Commit:** `00ae4a7..e5ff1d7` (9 commits)
**Next:** M15 (Intent-driven discovery / agent-powered compile)
**Blockers:** None

---

## M12: Lifecycle Management + Internal Registry — DONE (2026-03-17)

**Goal:** Make 50+ sites operatable — drift detection, re-verify, registry, rollback. Scale from 35 to 51 sites.

**Actual Result:**

- Theme 1: Drift Detection
  - `computeResponseFingerprint()` — recursive shape hash (depth 3, 3 array samples, field counts)
  - `openweb verify <site>` — verify single site, compare fingerprints, exit 1 on non-PASS
  - `openweb verify --all` — sequential batch verify with 500ms rate limiting
  - `openweb verify --all --report` — JSON drift report output
  - `openweb verify --all --report markdown` — markdown drift report
  - Per-operation status: PASS / DRIFT / FAIL
  - Site-level status: PASS / DRIFT / FAIL / auth_expired
  - Drift classification: schema_drift, auth_drift, endpoint_removed, error
  - Auto-quarantine on real FAIL (not on auth_expired)
  - Quarantine NOT cleared on auth_expired — only on actual PASS
  - Quarantine warning in `openweb sites` output (⚠️ marker)
  - Quarantine warning in `executeOperation()` stderr (soft block, not hard error)

- Theme 2: Internal Registry
  - Registry storage at `~/.openweb/registry/<site>/<version>/`
  - `openweb registry list` — list registered sites with versions
  - `openweb registry install <site>` — archive fixture to registry (local-only resolution)
  - `openweb registry rollback <site>` — revert to previous verified version
  - `openweb registry show <site>` — show version history
  - Auto-version bump on drift (minor bump, idempotent)
  - Max 5 versions retained per site (pruning)
  - `current` file (not symlink) for Windows compatibility
  - Site resolution updated: registry → ~/.openweb/sites → ./sites → ./src/fixtures

- Theme 3: Scale to 51 Sites (35 → 51)
  - 16 new L1 public API fixtures: Advice Slip, Affirmations, Chuck Norris, CocktailDB, Color API, Country.is, Dictionary API, Random Fox, Kanye Rest, Official Joke, Public Holidays, Sunrise Sunset, Universities, Useless Facts, World Time, Zippopotam
  - All fixtures include openapi.yaml + manifest.json + tests/*.test.json
  - All 16 new sites added to integration test config (sites.config.ts)

- Security (2 codex review rounds)
  - Path traversal: site names validated against `/^[a-z0-9][a-z0-9_-]*$/` in `resolveSiteRoot()`
  - Registry path traversal: `safeRegistryPath()` with symlink resolution via `realpathSync()`
  - Registry install self-copy prevented: `skipRegistry` option on `resolveSiteRoot()`
  - Registry permissions: dirs 0o700, files 0o600
  - Mixed auth rollup: ANY auth_drift → auth_expired (not PASS)
  - Verify exit code: non-zero on drift/failure (CI-friendly)

- Code Quality
  - Shared `loadManifest()` utility extracted to `lib/manifest.ts`
  - Circular dependency avoided (registry path check inlined in openapi.ts)
  - `archiveWithBump()` does not mutate source fixtures

**Stats:** 51 sites | 315 unit tests | 51 integration test entries | 4 new modules (fingerprint, verify, registry, manifest) | 2 codex review rounds (2 CRITICAL + 6 HIGH + 4 MEDIUM + 1 LOW fixed)

---

## M11: Agent Discovery Pipeline — DONE (2026-03-17)

**Goal:** Agent-driven API discovery pipeline. From URL → captured traffic → compiled fixture → verified tests. Expand from 25 to 35 sites.

**Actual Result:**

- Theme 1: Passive Discovery Engine
  - Parameterized filter.ts: target URL-based domain matching replaces hardcoded open-meteo host
  - Analytics/tracking host blocklist (35 domains: google-analytics, facebook, sentry, etc.)
  - Infrastructure path blocklist (27 patterns: manifest.json, _next/, telemetry, tracking, etc.)
  - Heuristic annotation: path-based operationId generation (get/list/create/update/delete prefixes)
  - Plural detection, singular resource detection (/me, /self, /current), search detection
  - Curated KNOWN map preserved as override layer

- Theme 2: Active Exploration
  - navigator.ts: safe CDP navigation helpers (goto, click, type, waitForNetworkIdle)
  - explorer.ts: page exploration strategy (find nav elements, search inputs, click + record)
  - Separate capture dir for exploration + HAR merge (fixes data overwrite bug)

- Theme 3: E2E Pipeline + Verification
  - `openweb discover <url>` CLI command — full pipeline from URL to fixture
  - Interactive capture: start capture BEFORE navigation to catch page-load API calls
  - recorder.ts: supports both HAR formats (log.entries and top-level entries)
  - recorder.ts: loadCaptureData reads bundle directory format (state_snapshots/, dom_extractions/)
  - Pipeline tested on GitHub (8 operations discovered, localStorage_jwt auth detected)
  - Pipeline tested on 15 candidate sites (13 produced fixtures, 140 total operations)
  - Key learning: passive capture discovers mostly infrastructure/telemetry, not user-facing APIs

- Theme 4: Site Expansion (25 → 35)
  - 10 new L1 public API fixtures: Agify, Bored API, Cat Facts, Exchange Rate, Genderize, HTTPBin, Nationalize, Open Library, PokeAPI, Random User
  - All 10 verified against live APIs (17 operations total)
  - Integration test configs added for all 35 sites
  - SKILL.md updated (25 → 35 sites)

- Code Review Fixes
  - AnalyzedOperation.method widened from 'get' literal to string (supports mutations)
  - Exploration capture uses separate dir + merge (prevents passive data overwrite)
  - Browser disconnected after capture (prevents leaked Playwright connections)
  - Static import for createCaptureSession (was unnecessary dynamic import)
- Codex Review Round 1 (1 CRITICAL + 3 HIGH + 1 MEDIUM)
  - CRITICAL: Wrong-tab credential capture — opens dedicated page, navigates to target, attaches capture
  - HIGH: Capture readiness — CaptureSession.ready promise replaces 1500ms sleep
  - HIGH: Active exploration unsafe — --explore defaults false, destructive link denylist
  - HIGH: Public-suffix — 80+ known multi-part TLDs (co.uk, com.au, etc.)
  - MEDIUM: Noise-path patterns narrowed, false-positive tests added
- Codex Review Round 2 (2 HIGH + 3 MEDIUM)
  - HIGH: Exploration capture passes targetPage + awaits ready
  - HIGH: Session page isolation — isolateToTargetPage skips unrelated tabs
  - MEDIUM: discoverCommand default explore=false matches CLI
  - MEDIUM: Hosting platform isolation (github.io, netlify.app, etc.)
  - MEDIUM: Escaped dot in .well-known regex

**Exit Criteria:**
- ✅ `openweb discover <url>` works end-to-end (passive capture + active exploration + compile)
- ✅ 35 total sites (25 original + 10 new L1)
- ✅ All new fixtures verified against live APIs
- ✅ 293/293 tests pass, zero regression
- ✅ Infrastructure noise filter blocks telemetry/tracking/config paths
- ✅ 2 codex review rounds resolved (0 critical, 0 high remaining)

**Verification:** 293/293 unit tests pass; 10 new fixtures verified; build clean; 8 commits + 2 review fix commits

---

## M10: Compiler L2 + Semi-auto Pipeline — DONE (2026-03-17)

**Goal:** Make compiler produce usable L2 specs, expand to ~25 sites, validate semi-auto pipeline.

**Actual Result:**
- Theme 1: Compiler L2 Emit
  - Fixed signing emission bug (classify detected sapisidhash but generator never emitted it)
  - Added extraction detection (ssr_next_data, script_json) to classify.ts with ExtractionSignal type
  - Generator emits skeleton extraction operations with placeholder paths
  - Build.signals array derived from classify results (status-match, auth_detected, extraction_detected, etc.)
  - Parity test validates generated spec passes AJV x-openweb validation
  - Wired classify() into compile pipeline (loadCaptureData → classify → generatePackage)
  - Extraction-only compilation supported (zero HTTP ops + extraction signals)
- Theme 2: Site Expansion (15 → 25)
  - 10 new L1 fixtures: StackOverflow, CoinGecko, Wikipedia, npm, DuckDuckGo, JSONPlaceholder, Dog CEO, GitHub Public, REST Countries, IP API
  - Extended GitHub fixture with GraphQL POST /graphql (risk_tier: medium)
  - Fixed buildQueryUrl() body param rejection bug (enabled POST mutations)
  - All new fixtures verified against live APIs
  - Integration test configs updated for all 25 sites
- Theme 3: Semi-auto Pipeline Validation
  - Round-trip test: Open-Meteo capture → compile → compare = 4/4 operations match
  - scripts/roundtrip-test.ts for repeatable validation
- Codex Review (2 rounds, all resolved)
  - R1 (3 HIGH + 3 MEDIUM + 1 LOW): cookie_session overlap check, link_header pagination type coercion, extraction-only compile, extraction_detected on normal ops, getResponseSchema 2xx, GitHub GraphQL risk_tier, ipapi flaky flag
  - R2 (3 HIGH + 1 MEDIUM): tracking cookie deny-list, loadRecordedSamples non-throwing, extraction ops sourceUrl fallback, getResponseSchema dynamic 2xx iteration

**Exit Criteria:**
- ✅ Compiler emits signing, extraction detection, build signals
- ✅ 25 total sites (15 original + 10 new L1 + GitHub GraphQL extension)
- ✅ Round-trip pipeline validated on Open-Meteo
- ✅ 271/271 tests pass, zero regression
- ✅ 2 codex review rounds resolved (0 critical, 0 high remaining)

**Verification:** 271/271 unit tests pass; all new L1 fixtures verified against live APIs; 8 commits + 2 review fix commits

---

## 2026-03-17: M9 Codex review fixes — redirect hardening, load-time validation, schema cleanup

**What changed:**
- Redirect handling: 301/302 now rewrite POST→GET (matching native fetch); only 307/308 preserve method. Applied to both `fetchWithRedirects` and `fetchWithValidatedRedirects`.
- Cross-origin header stripping added to direct-node redirect path (`fetchWithValidatedRedirects`).
- `api_response` CSRF resolver routed through `fetchWithRedirects` (SSRF + CR-01 hardened).
- Load-time x-openweb validation: `loadOpenApi()` now runs AJV against the spec before returning, catching unsupported auth types and unknown fields early.
- `fallback` auth removed from JSON schema (kept as TS type only per D-6); `ExchangeCookieStep` schema fixed to allow `as` field.
- `request_encoding` removed from types/schema (no runtime consumer yet).
- Integration runner: pagination deps shape fixed; page verification uses parsed origin comparison.

**Why:**
- Codex review rounds 1+2 identified security gaps (SSRF bypass, header leaks) and schema/runtime drift

**Key files:** `src/runtime/redirect.ts`, `src/runtime/executor.ts`, `src/runtime/primitives/api-response.ts`, `src/lib/openapi.ts`, `src/types/primitive-schemas.ts`, `src/types/extensions.ts`
**Verification:** `pnpm build` + 260/260 tests pass; integration 9 pass, 6 skip, 1 fail (HN stale tab)
**Commit:** 3af9a50, 89ecfa2
**Next:** M9 expansion — add ~5 new sites using registry pattern
**Blockers:** None

## 2026-03-17: M9 Scale-Ready Refactor — transport model, registry, session-executor slim

**What changed:**
- Phase A: `ExecutionMode` → `Transport = 'node' | 'page'` (D-1). `direct_http` eliminated — just `node` without auth config. `XOpenWebOperation` restructured with `build` metadata block (D-15) and `request_encoding` (D-7). Primitives pruned 27 → 17 (D-5): removed 10 unimplemented types, added `fallback` auth type-only (D-6). `ExchangeStep` tightened to discriminated union (D-4). Manifest normalized: `site_url`/`compiled_at` (D-11). All 15 fixtures migrated.
- Phase B: Resolver registry (`Map<string, ResolverFn>`) replaces 3 switch statements (D-3). Session-executor extracted from 666 → 225 lines: new `request-builder.ts`, `redirect.ts` (CR-01 cross-origin header stripping), `operation-context.ts`, `csrf-scope.ts`, `response-parser.ts`. Resolve functions moved to `primitives/index.ts`. Dead code removed: `token-cache.ts`, `AdapterCapability`, `CodeAdapter.provides` (D-12). Error factory methods added (AP-8).
- Phase C: Integration test framework with real Chrome CDP. `tests/integration/runner.ts` + `sites.config.ts` with 15 site configs. Auth drift → SKIP. `pnpm test:integration` (local-only). Initial: 8 pass, 7 skip, 0 fail.
- Phase D: All docs synced — SKILL.md, architecture.md, runtime.md, primitives.md, meta-spec.md, adding-sites.md.

**Why:**
- Architecture review (M8) identified session-executor as monolithic bottleneck for scaling to 50+ sites
- Registry pattern enables adding new primitives without touching core dispatch
- Type pruning keeps schema honest — only what runtime implements is declared

**Key files:** `src/runtime/session-executor.ts` (666→225 lines), `src/runtime/primitives/registry.ts`, `src/runtime/primitives/index.ts`, `src/runtime/request-builder.ts`, `src/runtime/redirect.ts`, `src/runtime/operation-context.ts`, `src/lib/csrf-scope.ts`, `src/lib/response-parser.ts`, `src/types/primitives.ts` (27→17 types), `src/types/extensions.ts` (Transport+BuildMeta), `tests/integration/`
**Verification:** `pnpm build` ✓, 258/258 unit tests ✓, 8/15 integration tests pass (7 skip — no open tab)
**Commit:** 1dbb7e7..HEAD (5 commits)
**Next:** M9 Phase 2 — expand to ~20 sites using registry pattern; validate extensibility
**Blockers:** None

## 2026-03-16: M7 Close-out — 15 sites, 246 tests, meta-spec hardened

**What changed:**
- Phase 1 — Meta-spec maturity (3 contract fixes from TB-01/TB-02 codex review):
  - `const` requestBody fields: `validateParams()` enforces `schema.const`, callers cannot override fixed fields (e.g., GraphQL query strings)
  - Pagination `items_path`: cursor pagination supports explicit dot-path for deeply nested items (e.g., `data.actor.entitySearch.results.entities`)
  - `exchange_chain` cookie extraction: `extract_from: 'cookie'` reads browser cookies without HTTP request; `method` field supports GET steps
- Phase 2 — Targeted expansion (13→15 sites):
  - Reddit: added `getMe` via exchange_chain auth (cookie CSRF → bearer JWT → oauth.reddit.com)
  - ChatGPT: new fixture, exchange_chain with GET session endpoint, Cloudflare User-Agent binding
  - X (Twitter): new fixture, browser_fetch mode (TLS fingerprint protection), CSRF scope on all HTTP methods, static bearer as const header
  - GitHub: added test files for existing fixture
- Runtime enhancements:
  - CSRF scope: both session_http and browser_fetch support `scope` array for per-method CSRF resolution (not just mutations)
  - session_http always sends browser cookies even when auth doesn't provide cookieString
  - `findPageForOrigin()` strips `oauth.` subdomain for page matching

**Why:**
- M7 achieved meta-spec contract hardening (TB-01/TB-02 resolved) and added 2 new sites with novel patterns
- exchange_chain is now E2E verified with Reddit (cookie extraction + multi-step token exchange)
- Site expansion limited to sites with verified login state in shared Chrome profile

**Key files:** `src/lib/openapi.ts`, `src/runtime/paginator.ts`, `src/runtime/primitives/exchange-chain.ts`, `src/runtime/session-executor.ts`, `src/runtime/browser-fetch-executor.ts`, `src/sites/{chatgpt,x,reddit}-fixture/`
**Verification:** 246/246 tests pass, `pnpm build` clean, 15 sites CDP-verified
**Commits:** 5 commits (Phase 1 + Reddit + ChatGPT + X + docs)
**Next:** M8 — further expansion (Nuxt SSR, non-Google signing, more breadth sites)
**Blockers:** None

---

## 2026-03-16: M6 Close-out — 13 sites, 238 tests, 6 review rounds

**What changed:**
- Closed M6 milestone: 9→13 verified sites covering 4 new archetypes (ssr_next_data, html_selector, sessionStorage_msal, graphql_cursor)
- Phase 1: 8 core hardening fixes on 9 existing sites (page matching, failureClass, requestBody, adapter errors, truncation)
- Phase 2A: Walmart, Hacker News, Microsoft Word — extraction runtime + MSAL auth
- Phase 2B: New Relic — GraphQL cursor pagination with nested `request_param` support
- exchange_chain discovery gate: FAIL → deferred (no stable target in profile)
- 6 code review rounds (3 Claude, 3 Codex), all findings resolved or documented
- Doc sync across architecture, runtime, primitives, meta-spec, adding-sites, roadmap
- Codex review fixes: prototype-safe `setValueAtPath`, tightened response schema with required fields
- Created M7 scope: meta-spec maturity + targeted expansion to ~20 sites

**Why:**
- M6 achieved its core goals: hardened runtime, proved 4 new pattern archetypes, established discovery gate discipline
- Site count (13 vs aspirational 20) was limited by exchange_chain deferral and archetypes needing new primitives (Nuxt, non-Google signing) — these carry to M7

**Key files:** all `src/runtime/`, `src/sites/newrelic/`, `doc/todo/v2_m6/`, `doc/todo/roadmap.md`
**Verification:** 238/238 tests pass, `pnpm build` clean, 13 sites CDP-verified
**Commits:** `fecc59c`..`5b7b193` (8 commits across Phase 1 + Phase 2A + Phase 2B + reviews + docs)
**Next:** M7 — Meta-spec maturity (const body fields, items_path, exchange_chain cookie extraction) + expansion to ~20 sites
**Blockers:** None

---

## 2026-03-16: M6 Phase 2 Tranche B — New Relic GraphQL cursor fixture + exchange_chain discovery

**What changed:**
- Added `newrelic` as site #13: first GraphQL POST fixture with `cookie_session` auth, cursor pagination via nested `data.actor.entitySearch.results.nextCursor` response path
- Extended cursor pagination runtime to support **dotted `request_param`** paths — `setValueAtPath()` in `value-path.ts` + paginator update to write cursor into nested objects (e.g., `variables.cursor` for GraphQL)
- Ran exchange_chain discovery gate against Reddit and all logged-in sites in the Chrome profile; **result: FAIL / defer** — no site meets all gate criteria (Reddit needs cookie-to-body extraction not supported by the primitive, endpoint is undocumented, logged-out returns 200/400 not 401/403)

**Why:**
- Tranche B needed a GraphQL cursor target to prove the pagination primitive works beyond flat REST APIs
- The nested `request_param` gap was a real blocker: without it, GraphQL cursor injection into `variables.cursor` required site-specific code
- exchange_chain discovery prevents shipping a flaky fixture based on unstable live behavior

**Key files:** `src/runtime/value-path.ts`, `src/runtime/paginator.ts`, `src/sites/newrelic/`, `doc/todo/v2_m6/exchange-chain-discovery-gate.md`
**Verification:** `pnpm test` passed (236/236), `pnpm build` passed, real Chrome CDP verified (cold-start ✓, repeated ✓, 401 unauth ✓)
**Commit:** (this session)
**Next:** Code review, then M6 Phase 2 Tranche C or close-out depending on exchange_chain defer decision
**Blockers:** exchange_chain fixture deferred — no stable target in current profile

---

## 2026-03-16: M6 Phase 2 Tranche A review fixes + Tranche B target decisions

**What changed:**
- Closed the Tranche A review gaps: `direct_http` now reuses the full path/query/header/body binding pipeline with defaults, both HTTP executors share the same redirect budget and explicit missing-`Location` error, `exchange_chain` supports `inject.query`, and `page_global_data` formally accepts `page_url`
- Fixed stale fixture and benchmark metadata: the Reddit manifest now matches the current `cookie_session` fixture, benchmark 10 includes `--max-response 2048`, and duplicated candidate-page filtering moved into shared `src/runtime/page-candidates.ts`
- Locked the next Tranche B batch in the implementation plan: `newrelic` is the GraphQL cursor target, while `exchange_chain` stays behind a discovery gate until a stable live flow is captured

**Why:**
- The Tranche A follow-up review found real contract drift between execution paths plus stale metadata left over from earlier fixture changes
- Tranche B needed a concrete "build next" target; otherwise the milestone would stall on target churn and ambiguous `exchange_chain` candidates

**Key files:** `src/runtime/executor.ts`, `src/runtime/session-executor.ts`, `src/runtime/primitives/exchange-chain.ts`, `src/runtime/page-candidates.ts`, `src/types/primitives.ts`, `src/sites/reddit/manifest.json`, `doc/todo/v2_m6/implement-plan.md`
**Verification:** `pnpm test` passed (226/226), `pnpm build` passed
**Commit:** `1847175`
**Next:** Implement `newrelic` for the GraphQL cursor tranche; separately run `exchange_chain` target discovery before committing to an E2E site
**Blockers:** None

---

## 2026-03-16: M6 Phase 2 Tranche A — extraction sites, MSAL auth, and agent-surface sync

**What changed:**
- Completed the first Phase 2 tranche with three new fixtures: `walmart` (`ssr_next_data`), `hackernews` (`html_selector`), and `microsoft-word` (`sessionStorage_msal`)
- Finished the missing runtime pieces behind that tranche: extraction dispatch now also supports `page_global_data`, extraction path matching requires the configured `page_url`, nested dot-path helpers are used by extraction and cursor pagination, and navigator response summaries now render array item shapes
- Synced the local `openweb` skill and docs to the 12-site surface, including new benchmark task definitions for DOM extraction, Next.js SSR extraction, and MSAL-backed auth

**Why:**
- Phase 2 needed to add genuinely new patterns rather than more copies of the existing 9 sites
- The in-progress tranche already covered SSR extraction, DOM extraction, and MSAL auth, but it still had a runtime hole (`page_global_data` was declared but not executable) and an extraction matching bug that could silently run against the wrong same-origin page

**Key files:** `src/runtime/extraction-executor.ts`, `src/runtime/paginator.ts`, `src/runtime/navigator.ts`, `src/runtime/primitives/page-expression.ts`, `src/runtime/primitives/page-global-data.ts`, `src/sites/walmart/`, `src/sites/hackernews/`, `src/sites/microsoft-word/`, `.claude/skills/openweb/SKILL.md`, `doc/main/runtime.md`, `tests/benchmark/`
**Verification:** `pnpm build` passed, `pnpm test` passed (214/214), real Chrome CDP smoke passed for Hacker News/Walmart/Microsoft Word, repeated live execution passed for Hacker News/Walmart/Microsoft Word
**Commit:** `93c9893`
**Next:** Phase 2 Tranche B — pick a stable GraphQL cursor target and re-confirm the `exchange_chain` target before implementing the next site batch
**Blockers:** None

---

## 2026-03-16: M6 Phase 1 review fixes — body validation, exchange redirects, and safe truncation

**What changed:**
- Tightened request-body handling: object body params are type-checked, `requestBody.required` keeps an empty JSON object present when needed, and the Reddit vote fixture now marks `id`/`dir` as required
- Fixed `exchange_chain` auth recovery so manual 3xx redirects surface as `needs_login` instead of `fatal`
- Changed `--max-response` to emit a valid JSON string preview on stdout instead of raw byte fragments, and required a minimum of 2 bytes for that preview contract
- Added regression tests for body schema validation, required request bodies, exchange redirects, and truncation output

**Why:**
- The Phase 1 review found three contract breaks that still leaked bad inputs to HTTP, misclassified expired-session redirects, or produced unparsable stdout in the agent-safe truncation path

**Key files:** `src/lib/openapi.ts`, `src/runtime/session-executor.ts`, `src/runtime/primitives/exchange-chain.ts`, `src/commands/exec.ts`, `src/cli.ts`, `src/sites/reddit/openapi.yaml`, `src/lib/openapi.test.ts`, `src/runtime/primitives/primitives.test.ts`, `src/runtime/session-executor.test.ts`, `.claude/skills/openweb/SKILL.md`
**Verification:** `pnpm test` passed (191/191), `pnpm build` passed
**Commit:** `9319297`
**Next:** M6 Phase 2 — pattern-driven expansion (Next.js SSR, DOM-only extraction, GraphQL cursor, MSAL/sessionStorage, exchange_chain E2E)
**Blockers:** None

---

## 2026-03-16: M6 Phase 1 — Core hardening on the existing 9 sites

**What changed:**
- Hardened page matching across `session_http`, `browser_fetch`, and adapter paths: worker-like pages are filtered out, unrelated-tab fallback is gone, and `needs_page` now points to a concrete URL to open
- Added request-body visibility and runtime binding: `requestBody` is modeled in OpenAPI parsing, `renderOperation()` shows body fields, body defaults are applied, and YouTube now documents `videoId` while auto-filling a minimal `context.client`
- Fixed failure classification: HTTP `401/403` now surface as `needs_login`, primitive `429/5xx` failures are retriable, webpack-cache-empty is retriable, and adapter-backed sites now throw structured `OpenWebError`s instead of plain `Error`
- Added adapter init auto-retry with reload, navigator adapter-mode rendering, CLI `--max-response`, and fixture/schema corrections (`feed_items`, YouTube body defaults)
- Synced benchmark docs and the local `openweb` skill to the new agent contract

**Why:**
- M5 dogfood exposed false-positive page selection, hidden body params, and ambiguous adapter/runtime failures that prevented reliable agent recovery
- The goal of Phase 1 is to make the existing 9 verified sites mechanically reliable before adding more patterns in Phase 2

**Key files:** `src/runtime/session-executor.ts`, `src/runtime/browser-fetch-executor.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/navigator.ts`, `src/lib/openapi.ts`, `src/lib/errors.ts`, `src/commands/exec.ts`, `src/cli.ts`, `src/sites/instagram/openapi.yaml`, `src/sites/youtube/openapi.yaml`, `.claude/skills/openweb/SKILL.md`, `tests/benchmark/`
**Verification:** `pnpm test` passed (183/183), `pnpm build` passed, real Chrome CDP smoke passed for Open-Meteo/Instagram/GitHub/YouTube/Discord/Telegram, benchmark error cases passed (`needs_browser`, `fatal`)
**Commit:** `fecc59c`
**Next:** M6 Phase 2 — pattern-driven expansion (Next.js SSR, DOM-only extraction, GraphQL cursor, MSAL/sessionStorage, exchange_chain E2E)
**Blockers:** None

---

## 2026-03-16: M5 Codex review + doc sync

**What changed:**
- Codex code review: 0 critical, 3 high, 3 medium, 3 low, 1 nice-to-have (doc/todo/v2_m5/code-review-m5.md)
- Fixed ME-3: SKILL.md `pnpm dev` → `pnpm --silent dev` (stdout contamination)
- Fixed LO-1: CLI usage errors now `OpenWebError` with `failureClass: "fatal"`
- Doc sync: architecture.md (agent skill layer + diagram), runtime.md (failureClass table), development.md (benchmark suite), adding-sites.md (benchmark checklist)
- Expanded pitfalls to 10 total from background agent reports

**Why:**
- Codex review caught real agent-contract gaps: `needs_page` unreachable, requestBody hidden, adapter errors unstructured
- 3 high findings deferred to M6 (need core runtime changes), 2 fixes applied immediately

**Key files:** `.claude/skills/openweb/SKILL.md`, `src/cli.ts`, `doc/main/architecture.md`, `doc/main/runtime.md`, `doc/dev/development.md`
**Verification:** 168/168 tests pass
**Commit:** `5de5b13..25e6b54`
**Next:** M6 — Manual Scaling + Core Hardening (pitfall fixes, 10→25 sites)
**Blockers:** None

---

## 2026-03-16: M5 — Agent Skill Dogfood + Operational Surface

**What changed:**
- Phase 1: Added `FailureClass` type (`needs_browser|needs_login|needs_page|retriable|fatal`) to `OpenWebErrorPayload` — 82 throw sites classified across 22 source files
- Phase 1: Extended `renderSite()` with readiness metadata: mode, requires_browser, requires_login, risk summary
- Phase 1: Extended `renderOperation()` to show path/header params (not just query), resolved mode, risk_tier
- Phase 2: Created 7 benchmark task definitions in `tests/benchmark/` covering all 4 execution modes
- Phase 3: Created `.claude/skills/openweb/SKILL.md` — agent skill for Claude Code with 4-step workflow, error handling guide, site table
- Phase 4: Dogfood — ran all 7 benchmarks against real Chrome CDP (6/7 pass)
- Phase 4: Documented 6 pitfalls about agent ↔ runtime interface

**Benchmark results (6/7 pass):**
- B1 open-meteo (direct_http): PASS
- B2 Instagram (session_http, cookie + CSRF): PASS
- B3 GitHub (session_http, meta_tag + pagination): PASS
- B4 YouTube (session_http, page_global + sapisidhash): FAIL — findPageForOrigin matched service worker instead of real page
- B5 Discord (browser_fetch, webpack_module_walk): PASS
- B6 Telegram (L3 adapter): PASS — after page reload (backgrounded tab lost webpack state)
- B7 Error classification: PASS — needs_browser + fatal correctly surfaced

**Pitfalls (doc/todo/v2_m5/pitfalls.md):**
1. Service worker pages match in findPageForOrigin — misleading error
2. Backgrounded tabs lose webpack/global state — need reload hint
3. renderOperation didn't show path params — FIXED in this milestone
4. Large responses (~156KB) overwhelm agent context — need --jq or truncation
5. No pre-execution readiness check — need `openweb <site> check`
6. page_global failure misclassified as needs_login when real issue is wrong page type

**Key files:**
- `src/lib/errors.ts` — FailureClass type + failureClass field
- `src/runtime/navigator.ts` — readiness metadata + full param display
- `.claude/skills/openweb/SKILL.md` — agent skill package
- `tests/benchmark/` — 7 benchmark task definitions
- `doc/todo/v2_m5/pitfalls.md` — 6 pitfalls for M6 scope

**Verification:** 168/168 tests pass, 10 sites available, readiness metadata displayed, failureClass in all error output, 6/7 benchmarks pass
**Commit:** `94916d8..57b7c73` (4 commits)
**Next:** M6 — Manual Scaling + Core Hardening (pitfall fixes, 10→25 sites)
**Blockers:** None

---

## 2026-03-16: Post-M4 planning — roadmap, meta-schema review, design docs

**What changed:**
- Separated `doc/todo/roadmap.md` from `doc/todo/note.md` — M5-M8 milestones defined
- M5: Agent Skill MVP (9 sites, pure packaging)
- M6: Manual Scaling + Core Hardening (10→25 sites, primitive registry, freshness, extraction handlers)
- M7: Semi-Auto Discovery (25→50 sites, compiler L2 classify, AsyncAPI, self-healing)
- M8: Full Automation + Distribution (50→100+, self-evolution, package registry)
- New design docs:
  - `doc/todo/meta-schema-review/` — auth/csrf/signing 分类体系 review, mode 轴分析
  - `doc/todo/primitive-customization/` — registry + per-site resolver 设计
  - `doc/todo/intelligent-discovery/` — agent-driven API exploration workflow
- Removed site-specific `webpackChunkdiscord_app` + `webpackChunk_N_E` from dom-capture KNOWN_GLOBALS (redundant with wildcard scan)

**Why:**
- M0-M4 complete — need clear roadmap for M5+ that covers all v2 design doc commitments
- Meta-schema review identified: page_global duplication, 3-switch code smell, missing freshness dimension, extraction as wrong category
- Primitive customization needed before scaling to 100+ sites (company-specific primitives in core don't scale)

**Key files:** `doc/todo/roadmap.md`, `doc/todo/note.md`, `doc/todo/meta-schema-review/review.md`, `doc/todo/primitive-customization/design.md`, `doc/todo/intelligent-discovery/design.md`, `src/capture/dom-capture.ts`
**Verification:** 167/167 tests pass, Discord getMe verified via CDP after KNOWN_GLOBALS cleanup
**Commit:** `375def2`
**Next:** M5 — Agent skill MVP
**Blockers:** None

---

## 2026-03-16: Documentation overhaul — doc/main + doc/dev rewrite

**What changed:**
- Rewrote `doc/main/` from 2 files to 9 files, modeled after Android Agent doc quality
- New navigation hub: `doc/main/README.md` (documentation map, reading order, key concepts)
- New docs: `runtime.md` (execution pipeline), `primitives.md` (L2 resolvers), `adapters.md` (L3 framework), `meta-spec.md` (type system), `compiler.md` (pipeline), `security.md` (SSRF, errors, redirects)
- Rewrote `doc/main/architecture.md` and `doc/main/browser-capture.md` with deeper content
- Rewrote `doc/dev/development.md` with complete dev workflow
- New: `doc/dev/adding-sites.md` — step-by-step guide for creating new site fixtures
- Removed outdated `doc/dev/guide.md` and `doc/dev/m1-plan.md`

**Why:**
- M0-M4 complete — documentation hadn't kept up with implementation
- Previous docs were sparse (2 main files, 1 dev file) for a system with 9 verified sites and 167 tests
- Reference quality: Android Agent project's doc/main structure

**Key files:** `doc/main/*.md` (9 files), `doc/dev/*.md` (2 files)
**Verification:** All file/code references verified against current codebase
**Commit:** `a34cc32`
**Next:** M5 — Agent skill packaging
**Blockers:** None

---

## 2026-03-16: M4 Codex Review Round 2 — 4 fixes

**What changed:**
- HI-01: Replaced broken `redirect:'manual'` (opaqueredirect status 0) with `redirect:'follow'` — browser handles redirects natively, initial URL SSRF-validated
- HI-02: Added `scripts/build-adapters.js` — compiles .ts adapters to .js via esbuild as post-build step
- HI-03: Extracted shared `validateParams()` in openapi.ts — unknown-param rejection, required checks, type validation, defaults — used by adapter and non-adapter paths
- ME-01: Adapter loader distinguishes "file not found" from "wrong shape" (missing default export)

**Why:**
- Round 2 found `redirect:'manual'` returns opaqueredirect in browser context (status 0, no headers) — per-hop loop was dead code
- Built-mode adapter loading still failed because build only emitted dist/cli.js, not adapter .js files
- Adapter param validation was still partial (no unknown rejection, no type checks)

**Key files:** `src/runtime/browser-fetch-executor.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/executor.ts`, `src/lib/openapi.ts`, `scripts/build-adapters.js`
**Verification:** 167/167 tests pass, `pnpm build` compiles 2 adapters, built-mode adapter import verified
**Commit:** `f62f1fd..8ee80a0` (2 commits)
**Next:** M5 — Agent skill packaging
**Blockers:** None

---

## 2026-03-16: M4 Codex Review Round 1 — 4 fixes

**What changed:**
- CR-01: browser_fetch SSRF redirect bypass — `redirect:'manual'` + per-hop validation
- HI-01: adapter loader surfaces real import errors (not "adapter not found" for syntax errors)
- HI-02: adapter execution path validates required params + applies schema defaults
- ME-03: in-page fetch network/CORS errors normalized to `OpenWebError`

**Why:**
- Codex review identified that browser_fetch only validated the initial URL, not redirect targets
- `.ts` adapters fail under built runtime (`node dist/cli.js`); blanket catch hid the real error
- Adapter operations bypassed OpenAPI parameter validation entirely

**Key files:** `src/runtime/browser-fetch-executor.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/executor.ts`
**Verification:** 167/167 tests pass, TypeScript build clean
**Commit:** `767d18d..f62f1fd` (2 commits)
**Next:** M5 — Agent skill packaging
**Blockers:** None

---

## 2026-03-16: M4 — L3 + browser_fetch (Discord, WhatsApp, Telegram)

**What changed:**
- Phase 0: `browser_fetch` executor — `page.evaluate(fetch(...))` with credentials:'include'
- Phase 1: Discord — `webpack_module_walk` L2 auth primitive + browser_fetch fixture (3 ops)
- Phase 2: L3 adapter framework — CodeAdapter loading via dynamic import + init/auth/execute lifecycle
- Phase 3: WhatsApp — L3 adapter via Meta `require()` module system (getChats, getMessages, getContacts)
- Phase 4: Telegram — L3 adapter via dynamic webpack `getGlobal()` state discovery (getDialogs, getMe, getMessages)
- Code review: SSRF validation in browser_fetch, path traversal guard in adapter loader, chunk_global format check
- Pitfall feedback: 8 pitfalls written back to 3 design docs (layer3-code-adapters, runtime-executor, layer2-primitives)

**Why:**
- M4 proves the three-layer architecture works end-to-end (L1 + L2 + L3 all running)
- `browser_fetch` needed for sites with TLS fingerprinting or browser-only auth (webpack module cache)
- L3 adapters handle sites with no HTTP API (WhatsApp Signal Protocol, Telegram MTProto)
- Key discovery: WhatsApp uses Meta's proprietary `__d/__w/require`, not standard webpack
- Key discovery: Telegram-t module IDs are mangled per deploy — adapter must search dynamically

**Key files:**
- `src/runtime/browser-fetch-executor.ts` — browser_fetch mode
- `src/runtime/adapter-executor.ts` — L3 adapter framework
- `src/runtime/primitives/webpack-module-walk.ts` — webpack auth primitive (10th L2 handler)
- `src/sites/discord/` — webpack_module_walk + browser_fetch (getMe, getGuilds, getChannelMessages)
- `src/sites/whatsapp/` — L3 adapter + Meta require() (getChats, getMessages, getContacts)
- `src/sites/telegram/` — L3 adapter + teact getGlobal() (getDialogs, getMe, getMessages)
- `src/types/adapter.ts` — CodeAdapter interface (Page-typed)

**Verification:** 167/167 tests pass, TypeScript strict build clean, all 3 sites verified with real Chrome CDP:
- Discord: `getMe` returns user object ✅, `getGuilds` returns 3 guilds ✅
- WhatsApp: `getChats` returns chat list ✅, `getContacts` returns 2574 contacts ✅
- Telegram: `getMe` returns user ✅, `getDialogs` returns 63 dialogs ✅

**Commit:** `73d244b..2b53bfd` (8 commits)
**Next:** M5 — Agent skill packaging + self-healing
**Blockers:** None

---

## 2026-03-16: M3 — L2 Breadth (4 Diverse Websites)

**What changed:**
- Phase 0 (M2 debt): request body construction for POST/PUT/PATCH, pagination executor (cursor + link_header), token cache with TTL
- Phase 1: Bluesky — `localStorage_jwt` auth primitive + cursor pagination fixture
- Phase 2: GitHub — `meta_tag` CSRF, `script_json` extraction, `link_header` pagination fixture
- Phase 3: YouTube — `page_global` auth, `sapisidhash` SHA-1 signing primitive + fixture
- Phase 4: Reddit — `exchange_chain` auth, `api_response` CSRF primitives (fixture uses `cookie_session` via `.json` endpoints)
- Phase 5: Filled all 10 M2 test checklist gaps (CR-15 redirects, CR-16 SSRF, CR-17 $ref, CR-18 non-JSON, CR-20 partial cookies)
- Bug fixes: CSS selector injection in meta_tag (CSS.escape), redirect off-by-one, page selection by origin for page.evaluate
- Classify detectors: added `localStorage_jwt`, `meta_tag`, `sapisidhash`, `exchange_chain` detection
- Design doc pitfall feedback: 14 pitfalls documented across 4 design docs

**Why:**
- M3 proves the L2 primitive model generalizes across diverse auth/CSRF/signing/pagination patterns
- 9 out of 27 primitive types now have runtime handlers — covering the most common web auth patterns
- Page selection bug (context.pages()[0]) was a critical E2E failure that only surfaced with multiple Chrome tabs
- Reddit's exchange_chain endpoint required undocumented params; simpler cookie_session via .json URLs works

**Key files:**
- `src/runtime/primitives/` — 9 handler files (localstorage-jwt, page-global, sapisidhash, meta-tag, api-response, exchange-chain, script-json + existing cookie-session, cookie-to-header)
- `src/runtime/paginator.ts` — pagination executor (cursor + link_header)
- `src/runtime/token-cache.ts` — TTL-based auth token cache
- `src/runtime/session-executor.ts` — signing pipeline, body construction, page selection
- `src/compiler/analyzer/classify.ts` — 6 detectors (cookie_session, cookie_to_header, localStorage_jwt, meta_tag, sapisidhash, exchange_chain)
- `src/sites/{bluesky,github,youtube,reddit}-fixture/` — 4 new site fixtures

**Verification:** 145/145 tests pass, TypeScript strict build clean, all 4 sites verified with real Chrome CDP:
- GitHub: `getRepo` anthropics/claude-code ✅, `listIssues` ✅
- Bluesky: `getProfile` bsky.app ✅, `getTimeline` ✅, `searchActors` ✅
- YouTube: `getVideoInfo` (Never Gonna Give You Up) ✅
- Reddit: `getSubreddit` r/programming ✅

**Commit:** `1c9858b..5776d5c` (12 commits)
**Next:** M4 — L3 + browser_fetch mode (Discord, WhatsApp/Telegram)
**Blockers:** None

---

## 2026-03-15: M2 Hardening — Final polish (NI-01, NI-02, test checklist)

**What changed:**
- NI-01: `resolveMode()` now validates server-level mode (was only validating operation-level)
- NI-02: session_http redirect loop exhaustion now throws "Too many redirects" instead of "HTTP 302"
- Created M3 test coverage checklist from deferred CR-15/16/17/18/20

**Why:**
- Round 2 review found 2 low-severity gaps introduced by round 1 fixes — closed the loop
- Test checklist ensures deferred items aren't forgotten in M3

**Key files:** `src/runtime/session-executor.ts`, `doc/todo/v2_m3/m3-test-checklist.md`
**Verification:** 84/84 tests pass
**Commit:** `7a29d5a`
**Next:** M3 — L2 breadth (5 diverse websites)
**Blockers:** None

---

## 2026-03-15: M2 Hardening — Code Review Fixes (9 findings)

**What changed:**
- CR-01: Strip Cookie/Authorization/CSRF headers on cross-origin redirects (security)
- CR-05: `browser_fetch` mode throws "not yet implemented" instead of silent fallthrough
- CR-07: 303 See Other redirect switches method to GET per RFC 7231
- CR-08: Unreplaced path template variables `{param}` throw INVALID_PARAMS
- CR-09: Safe JSON parse in direct_http path (consistent with session_http)
- CR-10: Validate ExecutionMode values from spec (reject typos like "sesion_http")
- CR-12: `--cdp-endpoint` without value shows usage error
- CR-13: Guard `$ref` traversal against `__proto__`/`constructor`/`prototype`
- spec_version aligned from "0.1.0" to "2.0" to match design docs

**Why:**
- Parallel code review + architecture review by two Claude agents (multmux) found 20 code issues + full gap matrix
- Fixed all findings except those better suited for M3 (request body, generator `in` field, operation-level server lookup, SSRF TOCTOU)

**Key files:** `src/runtime/session-executor.ts`, `src/runtime/executor.ts`, `src/cli.ts`, `src/compiler/generator.ts`
**Verification:** 84/84 tests pass, TypeScript strict clean on all modified files
**Commit:** `0d92195`
**Next:** M3 — L2 breadth (5 diverse websites)
**Blockers:** None

---

## 2026-03-15: M2 Fix — Cookie scoping + Referer + real Instagram verification

**What changed:**
- Fixed `context.cookies()` to scope by server URL — without URL arg, Playwright returns cookies from ALL domains in the Chrome profile, which created a massive Cookie header that Instagram rejected with 400
- Added `Referer: {server_origin}/` to all session_http requests — Instagram requires this header
- Made exec command JSON params optional (default `{}`), added `--cdp-endpoint` flag
- Verified against real Instagram API: `getTimeline` and `getUserProfile` return real data

**Why:**
- Initial 400 errors were misattributed to TLS fingerprinting. Bisecting headers proved: curl (LibreSSL), Node.js (OpenSSL), and Chrome (BoringSSL) all succeed — the issue was HTTP-level, not TLS
- `context.cookies()` scoping is a critical pitfall for any session_http implementation using a real user Chrome profile

**Key files:** `src/runtime/primitives/cookie-session.ts`, `src/runtime/primitives/cookie-to-header.ts`, `src/runtime/session-executor.ts`, `src/commands/exec.ts`, `src/cli.ts`
**Verification:** `openweb exec instagram getTimeline` → 200, real feed JSON. `getUserProfile` → 200, real user data. 84/84 tests pass.
**Commit:** `b6733ca`
**Next:** M3 — L2 breadth (5 diverse websites)
**Blockers:** None

---

## 2026-03-15: M2 — First L2 Website End-to-End (Instagram)

**What changed:**
- Implemented `session_http` execution mode with CDP browser connection
- Added L2 primitive resolvers: `cookie_session` (extract all cookies), `cookie_to_header` (cookie value → CSRF header)
- Extended `executeOperation()` to dispatch `session_http` vs `direct_http` by mode detection
- Added path parameter substitution (`{user_id}`), header parameter handling (`X-IG-App-ID` with defaults), `$ref` component resolution
- Implemented Compiler Classify step: detects `cookie_session` + `cookie_to_header` patterns from capture data (HAR entries + state snapshots)
- Extended generator to emit server-level `x-openweb` (mode + auth + csrf) when ClassifyResult is provided
- Added `deriveRiskTier()`: GET=safe, POST/PUT/PATCH=medium, DELETE=high
- Code review fixes: safe JSON parsing, redirect following with SSRF validation, guard against unresolvable `$ref`, empty serverUrl error

**Why:**
- M2 proves the L2 primitive model works end-to-end on a real website (Instagram)
- First website requiring authentication (cookie_session) and CSRF protection (cookie_to_header)
- Validates the full pipeline: capture → classify → emit → execute

**Key files:**
- `src/runtime/primitives/` — BrowserHandle, ResolvedInjections types + cookie-session + cookie-to-header resolvers
- `src/runtime/session-executor.ts` — session_http execution: CDP browser, L2 primitive resolution, path/header/query params
- `src/runtime/executor.ts` — mode dispatch (direct_http vs session_http)
- `src/compiler/analyzer/classify.ts` — Classify step (cookie_session + cookie_to_header detection)
- `src/compiler/generator.ts` — x-openweb emission with ClassifyResult

**Verification:** 84/84 tests pass (27 new), TypeScript strict clean on all new files
**Commit:** `a8fce3b`
**Next:** M3 — L2 breadth (5 diverse websites: Bluesky, YouTube, GitHub, Sentry, Reddit)
**Blockers:** None

---

## 2026-03-15: M1 Hardening — Codex Review Round 3

**What changed:**
- Instagram fixture: added `X-IG-App-ID` as reusable OpenAPI header parameter via `$ref`
- Schema: added `minimum` constraints on `tool_version` (>=1) and stats counts (>=0)
- Schema: added `minItems: 1` on `exchange_chain.steps`, `minProperties: 1` on `html_selector.selectors`
- Validator: hardened operation-level op guard from `if (!op)` to `typeof op !== 'object'`

**Why:**
- Codex round 3 found Instagram fixture was missing documented `X-IG-App-ID` header
- Schema accepted semantically impossible values (negative counts, empty chains)
- Last remaining falsy guard in operation traversal

**Key files:** `src/sites/instagram/openapi.yaml`, `src/types/schema.ts`, `src/types/primitive-schemas.ts`, `src/types/validator.ts`
**Verification:** 57/57 tests pass, lint clean
**Commit:** see below
**Next:** M2 — First L2 website end-to-end (Instagram)
**Blockers:** None

---

## 2026-03-15: M1 Hardening — Codex Review Round 2

**What changed:**
- Fixed top-level shape guard: `validateXOpenWebSpec()` now rejects `null`, `undefined`, primitives, and arrays instead of crashing/passing silently
- Added safe container guards: `servers` checked as array, `paths` checked as object before traversal
- Added operation-level falsy regression test (round 1 only tested server-level)
- Tightened `AdapterRef.params` type to exclude arrays (`{ readonly [key: string]: unknown }` instead of `Readonly<Record<string, unknown>>`)
- Acknowledged s1 (manifest site/site_url coexistence) — both accepted by schema for v1→v2 migration

**Why:**
- Codex round 2 found the validator crashes on `null` and passes on non-object inputs — boundary hardening for untrusted parser output

**Key files:** `src/types/validator.ts`, `src/types/validator.test.ts`, `src/types/extensions.ts`
**Verification:** 57/57 tests pass, lint clean
**Commit:** see below
**Next:** M2 — First L2 website end-to-end (Instagram)
**Blockers:** None

---

## 2026-03-15: M1 Hardening — Codex Review Round 1

**What changed:**
- Fixed falsy x-openweb guard: `if (!ext)` → `if (ext == null)` so `false`/`0`/`''` are properly rejected
- Added 4 edge case tests: falsy values, missing required auth fields, signing validation, csrf with scope
- Deferred: operation-level `servers[]` validation + `trace` method (rare in practice)
- Deferred: `info.x-openweb` validation (metadata, not execution primitive)

**Why:**
- Codex review probed for false negatives and found the falsy guard silently accepted invalid specs

**Key files:** `src/types/validator.ts`, `src/types/validator.test.ts`
**Verification:** 55/55 tests pass, lint clean
**Commit:** `94fce98`
**Next:** Codex round 2 review, then M2
**Blockers:** None

---

## 2026-03-15: M1 — Meta-spec Formalization

**What changed:**
- Created `src/types/` module with all 27 L2 primitive types as readonly discriminated unions
- JSON Schema definitions (AJV) for x-openweb server/operation extensions and manifest.json
- `validateXOpenWebSpec()` validates all x-openweb extensions in an OpenAPI spec
- `validateManifest()` validates manifest.json against schema
- `CodeAdapter` interface + `AdapterCapability` types for L3
- Instagram fixture (`src/sites/instagram/`) as L2 validation sample (cookie_session + cookie_to_header CSRF)
- Code reviewed: fixed csrfWithScope allOf→oneOf composition, manifest type/schema drift, file split for 400-line limit

**Why:**
- M1 formalizes the v2 design docs into executable TypeScript types + JSON Schema
- Single source of truth: JSON Schema validates at runtime, TypeScript types enforce at compile time
- Enables M2 (runtime execution of L2 primitives) by providing type-safe x-openweb definitions

**Key files:**
- `src/types/primitives.ts` — 27 L2 primitive discriminated unions (auth/csrf/signing/pagination/extraction)
- `src/types/primitive-schemas.ts` — JSON Schema for all primitives
- `src/types/extensions.ts` — XOpenWebServer, XOpenWebOperation
- `src/types/schema.ts` — composite schemas (server/operation/manifest)
- `src/types/validator.ts` — AJV-based validation
- `src/types/validator.test.ts` — 13 tests
- `src/sites/instagram/` — L2 fixture

**Verification:** 51/51 tests pass, lint clean, tsc strict clean (0 errors in src/types/)
**Commit:** `4ac0e7b..c3cf4ee`
**Next:** M2 — First L2 website end-to-end (Instagram: cookie_session + cookie_to_header)
**Blockers:** None

---

## 2026-03-15: M0 Hardening — Codex Code Reviews (3 rounds)

**What changed:**
- Round 1 (d5ce87a): stale bundle cleanup, in-flight data drain, snapshot ordering, cancellable connect, broadened HAR filter (SSE + wildcard +json), requestfailed cleanup, deferred() for TS strict
- Round 2 (996682d): safe bundle cleanup (artifact-only rm), draining flag for in-flight snapshots, drain-before-detach ordering, URL at event time, AbortSignal races connect + sleep
- Round 3 (ca1ba52): pendingCount includes pre-response requests, skip snapshot if page navigated away (rapid redirect correctness)

**Why:**
- Three Codex review rounds identified and fixed all critical/high reliability issues
- Capture output is now safe (no user data loss), deterministic (stop timing, reruns), and correct (rapid redirects skip stale snapshots)

**Key files:** `src/capture/session.ts`, `src/capture/har-capture.ts`, `src/capture/connection.ts`, `src/capture/bundle.ts`
**Verification:** 38/38 tests pass, lint clean, build clean
**Commit:** `d5ce87a..ca1ba52`
**Next:** M1 — Formalize meta-spec (TypeScript types + JSON Schema for x-openweb)
**Blockers:** None

---

## 2026-03-15: M0 — Browser Capture via CDP

**What changed:**
- Installed Playwright chromium browsers (all 34 tests now pass, was 24/25)
- Implemented capture module (`src/capture/`) with 4 data sources:
  - HTTP traffic (HAR 1.2) with analytics/tracking domain filtering (~30 blocked domains)
  - WebSocket frames (JSONL) via CDP `Network.webSocket*` events
  - Browser state snapshots (localStorage, sessionStorage, cookies) on init + navigation
  - DOM & globals extraction (meta tags, hidden inputs, 20+ framework globals detection)
- Added `openweb capture start/stop --cdp-endpoint <url>` CLI command
- Capture outputs bundle directory: `traffic.har`, `websocket_frames.jsonl`, `state_snapshots/`, `dom_extractions/`, `metadata.json`
- Code reviewed: fixed critical issues (new-tab HAR entries lost, navigation snapshot race condition), all lint errors resolved

**Why:**
- M0 is the foundation for the compiler pipeline — all subsequent phases (clustering, pattern detection, spec emission) consume the capture bundle
- CDP connection model allows OpenWeb to passively observe alongside the agent's Playwright CLI session without owning the browser

**Key files:**
- `src/capture/*.ts` — 8 modules (types, connection, har-capture, ws-capture, state-capture, dom-capture, bundle, session)
- `src/commands/capture.ts` — CLI command handler
- `src/cli.ts` — capture command registration
- `src/capture/*.test.ts` — 9 unit tests (HAR filtering + bundle writing)

**Verification:** Tested against real Chrome (--remote-debugging-port=9222) capturing JSONPlaceholder — 3 API requests, 4 state snapshots, 4 DOM extractions captured correctly. Build + lint + 34/34 tests pass.

**Commit:** `860fc97`

**Next:** M1 — Formalize meta-spec (TypeScript types + JSON Schema for x-openweb)

**Blockers:** None

---

## 2026-03-15: v2 Three-Layer Architecture — Full Design Sprint

**What changed:**
- Wrote all 10 v2 design documents from scratch (layer2-interaction-primitives, pattern-library, compiler-pipeline, browser-integration, layer3-code-adapters, runtime-executor, skill-package-format, gap-coverage-matrix, security-taxonomy, self-evolution)
- Classified all 103 OpenTabs plugins into L1/L2/L3 layers
- Defined 27 L2 primitive types across 5 categories (auth, csrf, signing, pagination, extraction)
- Created Chinese summaries of all docs (doc/todo/v2/cn/)
- Reorganized doc structure: doc/final → doc/todo/v2, docs/todo → doc/todo, outdated content → doc/archive
- Drafted v2 roadmap (M0-M5) in doc/note.md
- Key design decisions:
  - Phase 3 "Probe & Pattern Match" merged into single "Classify" step (primitives determine min mode, probe verifies)
  - AsyncAPI stays pure standard (no x-openweb), WS auth uses shared token from openapi.yaml
  - sapisidhash reclassified as session_http (SHA-1 computable in Node.js)
- Created doc/main/architecture.md and doc/dev/guide.md (SOTA memory)

**Why:**
- v1 HAR-only approach had 12 fundamental design gaps (discovered from OpenTabs analysis)
- Three-layer architecture (L1 structural + L2 primitives + L3 code) resolves all 12 gaps
- L1+L2 covers 93% of sites, only 7% need L3 code adapters
- Design validated against 103 real OpenTabs plugins, not hypothetical sites

**Key files:**
- `doc/todo/v2/*.md` — 10 design docs (all COMPLETE)
- `doc/todo/v2/cn/*.md` — Chinese summaries
- `doc/note.md` — artifacts definition + M0-M5 roadmap
- `doc/main/architecture.md` — architecture overview (SOTA)
- `doc/dev/guide.md` — dev guide (SOTA)

**Verification:** Cross-doc consistency check passed (terminology, types, cross-references all aligned)

**Commits:** `890e374..25e9f9d` (22 commits)

**Next:** M0 — Playwright browser capture integration

**Blockers:** None

## 2026-04-01: Pipeline gap fixes — 19 items across 5 clusters (double-design aligned)

**What changed:**
- **Runtime (5 fixes):** autoNavigate uses `load` (not `networkidle`), findPageForOrigin suffix-matches subdomains, IPv4-only CDP connection, site slug subdomain strip, page cleanup prevents tab leaks
- **Verify (4 fixes):** isAuthenticated skip for no-auth sites, pending fingerprint acceptance, cold-start warm-up retries, malformed example → FAIL (not skip)
- **Auth/CSRF (3 fixes):** standard header denylist (Accept, Content-Type, User-Agent), API-only auth filtering, bot-detection transport recommendation in analysis
- **Compiler (4 fixes):** reserved path segment protection, structured query params, GraphQL `/gql` path + batched array support, constant header detection (`constant-headers.ts`)
- **Compile pipeline (3 fixes):** PII scrub phone-key gating, 0-API early exit, telemetry blocked paths expansion
- **Doc-only (7 items):** capture template CDP warning, GQL APQ guidance, nullable adapter guidance, chinese redirect, adapter probing checklist, ephemeral queryIds, bot-detection CDP tab closure

**Why:**
- Double-design triage identified 43 problems from batch1+batch2 rediscovery. Phase 2 classified: 19 fix-now, 8 defer, 3 won't-fix, 7 doc-only. All 19 fixes + 7 doc items implemented in one commit.

**Key files:** `src/compiler/analyzer/constant-headers.ts` (new), `src/compiler/analyzer/auth-candidates.ts`, `src/compiler/analyzer/graphql-cluster.ts`, `src/compiler/analyzer/csrf-detect.ts`, `src/lifecycle/verify.ts`, `src/runtime/adapter-executor.ts`, `src/runtime/session-executor.ts`, `src/lib/config/blocked-paths.json`
**Verification:** 779/779 tests pass (+56 new tests for gap fixes)
**Commits:** `077ff8d` (triage), `70f27a1` (plan), `af8679b` (implementation)

## 2026-04-01: Batch 2 rediscovery — 18 sites

**What changed:**
- **Fully passing (7):** bluesky (8/9), substack (5/5), espn (6/6), apple-podcasts (5/5), xueqiu (7/7 — node transport for most, page for timeline), pinterest (4/4), instagram (3/3)
- **Partial (7):** twitch (6/8), expedia (2/4), homedepot (2/3), jd (2/4 — DOM extraction), fidelity (3/13 — ssrfValidator gap), reuters (2/4), redfin (1/3), goodrx (1/3)
- **Failed (3):** boss (0/7 — bot detection), instacart (0/3 — PerimeterX), whatsapp (0/3 — Metro module system)
- Knowledge updates: social archetype (Instagram, Bluesky, Pinterest patterns), chinese-web archetype (Xueqiu node transport, international redirect), bot-detection (CDP tab closure)

**Why:**
- Second wave of site rediscovery covering 18 sites across commerce, social, finance, travel, and news archetypes. Exposed new patterns (AT Protocol XRPC, Resource API, DOM extraction) and framework gaps (ssrfValidator propagation, CDP tab closure).

**Key files:** `src/sites/{bluesky,substack,espn,apple-podcasts,xueqiu,pinterest,instagram,...}/openapi.yaml`
**Verification:** 7 sites fully passing, 8 partial, 3 failed (blocked on bot detection or proprietary protocols)
**Commits:** `ec283b0..554f317` (8 commits)

## 2026-04-01: Batch 1 rediscovery — 11 sites + framework fixes

**What changed:**
- **Fully passing (7):** x (15 ops), amazon (5/5), linkedin (8/10), youtube-music (9/9), booking (5/5), indeed (8/8), chatgpt (5/5)
- **Partial (3):** bloomberg (3/10), medium (13 ops but 0 examples), telegram (adapter fails — MTProto state mismatch)
- **Framework fixes from chatgpt discovery:** ssrfValidator propagation to auth/csrf/signing resolvers, exchange_chain token cache bypass, autoNavigate owned page cleanup (tab leak fix)
- **Pipeline gap fixes from batch1:** extraction executor path parameter substitution, verify non-Error throw formatting, page-polyfill tsx `__name` injection fix, default User-Agent for node transport, knowledge doc updates

**Why:**
- First wave of site rediscovery covering 11 sites. ChatGPT discovery exposed three framework-level bugs (ssrfValidator, token cache, tab leaks) that would have broken every session_http site.

**Key files:** `src/sites/{x,amazon,linkedin,youtube-music,booking,indeed,chatgpt,...}/openapi.yaml`, `src/runtime/http-executor.ts`, `src/runtime/session-executor.ts`, `src/lifecycle/verify.ts`
**Verification:** 7 sites fully passing, 3 partial
**Commits:** `0be669d`, `5d94419`, `a1f7ab0`, `d7b7563`, `379ba30`, `ef2389b`

## 2026-04-01: Batch 0 polish — 18 sites complete, 15 sites dropped

**What changed:**
- Schema enrichment, examples, DOC.md for 18 batch0 sites
- 5 transport regressions fixed (schema nullable, weibo $ref inline)
- 12 dropped sites deleted from `src/sites/` (tiktok, coinbase, open-meteo, yelp, zillow, pokeapi, coingecko, httpbin, jsonplaceholder, stackoverflow, npm, microsoft-word)
- 3 additional sites dropped (bitbucket, digital, finance — had no src/sites/ directory)
- 15 dropped sites excluded from `dist/` build
- Test fixtures updated after dropping coinbase/open-meteo/jsonplaceholder
- Pruned examples for operations removed from robinhood, weibo, zhihu
- 5 batch0 sites marked blocked on browser verify (need live browser for page transport)
- Browser lifecycle investigation (CDP tab reopen)
- Multi-worker browser tab sharing design

**Why:**
- Batch0 was the initial quality sweep across all existing sites. Polish pass brought 13 of 18 sites to fully passing verify, with 5 blocked on browser-only transport. Dropped 15 sites that were test fixtures, public APIs with official SDKs, or sites with no viable path to automation.

**Key files:** `scripts/build-sites.js`, `src/sites/` (12 deleted directories), `doc/todo/browser/`
**Verification:** 13/18 fully passing, 5 blocked on browser verify
**Commits:** `62900b7`, `c08a007`, `702922c`, `4d0a3d1`, `3479226`, `c9b7ad4`, `1ac8df5`, `e19f54d`
