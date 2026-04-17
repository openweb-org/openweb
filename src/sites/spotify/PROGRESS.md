# Spotify — Progress

## 2026-04-17 — Adapter Refactor

**Context:** Phase 5C normalization — migrate `spotify-pathfinder` from the legacy `CodeAdapter` interface to the leaner `CustomRunner` shape, and unify per-op dispatch.
**Changes:**
- `src/sites/spotify/adapters/spotify-pathfinder.ts`: 356 → 300 lines.
- Replaced `CodeAdapter` (with `init` / `isAuthenticated` / `execute`) with `CustomRunner.run(ctx)`.
- Dropped `init()` (returned `url.includes('open.spotify.com')` — redundant with PagePlan) and `isAuthenticated()` (same trivial URL check; Spotify works anonymously).
- Added `WRITE_OPERATIONS` handler table parallel to existing `GRAPHQL_OPERATIONS`; `run()` body is now table lookup + dispatch instead of an imperative switch.
- Extracted `isNeedsLogin(err)` helper to dedupe the 401/403 token-refresh retry pattern across handlers.
- Per-op semantics preserved byte-for-byte: URLs, headers, request bodies, token-refresh retry, module-scope token cache.
**Verification:** 8/8 ops PASS via runtime exec.
**Key files:** `src/sites/spotify/adapters/spotify-pathfinder.ts`

## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- openapi.yaml: added `required` arrays to all response objects across 8 operations, `description` on every property, `example` on all parameters, `verified: true` + `signals: [adapter-verified]` in all build sections
- DOC.md: fixed heading levels (Site Internals subsections now `###`)
- All 8 example files: added `replay_safety: safe_read`

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm build && pnpm --silent dev verify spotify`

## 2026-04-05

### Verify fix
- **Root cause:** Token extraction timed out — adapter monkey-patched `window.fetch` and clicked a search input (`data-testid="search-input"`) to trigger a pathfinder request, but the selector was stale and no request fired within 10s.
- **Fix:** Replaced monkey-patch approach with Playwright `page.waitForRequest()` + navigation to `/search`. This intercepts at the network level and reliably catches the first pathfinder request.
- **Bug 2:** Retry logic referenced `err.detail.code` (nonexistent property) — fixed to `err.payload.failureClass === 'needs_login'`.
- **Added:** Example fixtures for all 4 operations (searchMusic, getArtist, getArtistDiscography, getAlbumTracks).
- **Result:** `openweb verify spotify --browser` → all 4 PASS.
