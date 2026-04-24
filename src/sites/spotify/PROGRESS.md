# Spotify — Progress

## 2026-04-24 — Userflow QA: response trimming and getPlaylist metadata fix

**Context:** Blind userflow QA across 3 personas (Runner, Podcast listener, Artist explorer). All 8 read ops returned 200 but getPlaylist was missing all metadata and responses contained 55–115KB of GraphQL bloat.
**Changes:**
- **getPlaylist metadata fix:** `fetchPlaylistContents` hash only returns `{content}`. Added `fetchPlaylistMetadata` hash (`a65e1219...`) — two sequential calls, merge metadata (name, description, followers, owner, images) with full track content.
- **searchMusic schema:** Added `playlists` and `podcasts` response fields (returned by API but undocumented).
- **Response trimming:** `trimResponse()` strips `__typename`, `extractedColors`, `playability`, `relinkingInformation`, `associationsV3`, `saved`, `relatedContent`, `goods`, `visuals`, and other GraphQL/UI-only fields. Applied to all pathfinder and spclient returns. Size reductions: searchMusic 95→37KB, getArtist 93→54KB, getTrack 55→~2KB, getPlaylist 22KB(no metadata)→11KB(with metadata).
- **getTrack artist trimming:** Stripped embedded artist `discography` from `firstArtist`/`otherArtists` (25KB per artist of redundant data — use getArtist for full profiles).
- **Schema fixes:** Playlist image `width`/`height` now allow null (generated covers). Removed `relatedContent` from getArtist schema (stripped in response trimming).
**Verification:** All 7 read ops PASS. No schema warnings.
**Key files:** `src/sites/spotify/adapters/spotify-pathfinder.ts`, `src/sites/spotify/openapi.yaml`

## 2026-04-20 — Playlist writes via spclient (api.spotify.com 429 retracted)

**Context:** Stage 5e — `addToPlaylist`, `removeFromPlaylist`, and `createPlaylist` were failing with 429 against `api.spotify.com/v1/playlists/...`. Prior handoffs called this a per-account quota; user confirmed they could perform the same actions in default Chrome, ruling that out.
**Changes:** (commit `bd89921`)
- Added `spclientFetch()` helper in `adapters/spotify-pathfinder.ts` mirroring the WebPlayer's `app-platform: WebPlayer` header set against `spclient.wg.spotify.com`.
- `createPlaylist` now hits `POST spclient.wg.spotify.com/playlist/v2/playlist` with an `UPDATE_LIST_ATTRIBUTES` op (the SPA's actual New Playlist call). Returns `{id, uri, name, description, public}` shape.
- `addToPlaylist` / `removeFromPlaylist` now hit `POST .../playlist/v2/playlist/{id}/changes` with `deltas[].ops[].kind = ADD | REM` and `info.source.client = WEBPLAYER`. Returns `{snapshot_id}` (mapped from response `revision`).
- Added page-settle (`waitForLoadState('domcontentloaded')` + 500ms) after `extractToken` to prevent execution-context loss across the search-page navigation that the token interceptor triggers.
- Fixture rotation: `addToPlaylist`/`removeFromPlaylist` switched from public DiscoverWeekly id `37i9dQZF1DXcBWIGoYBM5M` to user-owned `0hIjqrSiVWJX35wl8ob27O` since spclient mutations require ownership.
**Verification:** Playlist write ops PASS via `pnpm dev verify spotify --browser --write --ops <op>`.
**Key discovery:** WebPlayer-issued Bearer tokens are *valid* against both `api.spotify.com` and `spclient.wg.spotify.com`, but `api.spotify.com` 429s them on first hit while `spclient` accepts them indefinitely. The "rate limit" is really a gateway-classification difference — Spotify treats spclient as the WebPlayer's own write surface and api.spotify.com as a third-party-developer surface.
**Pitfalls:** First attempt sent the spclient request without `app-platform: WebPlayer`; got 401. The WebPlayer header is required for the gateway to treat the token as in-scope.

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
