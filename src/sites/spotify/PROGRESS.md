# Spotify — Progress

## 2026-04-05

### Verify fix
- **Root cause:** Token extraction timed out — adapter monkey-patched `window.fetch` and clicked a search input (`data-testid="search-input"`) to trigger a pathfinder request, but the selector was stale and no request fired within 10s.
- **Fix:** Replaced monkey-patch approach with Playwright `page.waitForRequest()` + navigation to `/search`. This intercepts at the network level and reliably catches the first pathfinder request.
- **Bug 2:** Retry logic referenced `err.detail.code` (nonexistent property) — fixed to `err.payload.failureClass === 'needs_login'`.
- **Added:** Example fixtures for all 4 operations (searchMusic, getArtist, getArtistDiscography, getAlbumTracks).
- **Result:** `openweb verify spotify --browser` → all 4 PASS.
