# Apple Podcasts Pipeline Gaps

## Doc gaps

### Problem
The `discover.md` and `capture-guide.md` don't mention that `connectOverCDP` in Playwright
resolves `localhost` to IPv6 `::1` on some systems, causing `ECONNREFUSED` when Chrome only
listens on IPv4 `127.0.0.1`.

**Root cause:** `getManagedCdpEndpoint()` returns `http://localhost:9222` (src/commands/browser.ts:421).
Playwright's `chromium.connectOverCDP()` resolves `localhost` to `::1` on macOS with IPv6 enabled.

**Suggested fix:** Use `http://127.0.0.1:${port}` instead of `http://localhost:${port}` in
`getManagedCdpEndpoint()` (src/commands/browser.ts:421). This affects ALL sites, not just this one.

### Problem
The `discover.md` capture-guide doesn't warn that `browser.close()` via `connectOverCDP` kills
the Chrome process. Scripts should use `browser.disconnect()` (but this method doesn't exist on
Playwright's CDP browser type — must use `process.exit()` instead).

**Root cause:** Playwright's `connectOverCDP().close()` sends a `Browser.close` CDP command that
terminates Chrome. There's no `disconnect()` method.

**Suggested fix:** Add a warning to capture-guide.md: "When connecting to the managed browser
via CDP for scripted capture, do NOT call `browser.close()` — it kills Chrome. Use
`process.exit(0)` to exit cleanly."

## Code gaps

### Problem
`findPageForOrigin` (src/runtime/session-executor.ts:37) cannot match
`amp-api.podcasts.apple.com` to a `podcasts.apple.com` page. The hostname stripping only handles
`api.`, `www.`, and `oauth.` prefixes — not compound prefixes like `amp-api.`.

**Root cause:** Regex `^(www|api|oauth)\.` doesn't match `amp-api.` (src/runtime/session-executor.ts:47).

**Suggested fix:** After the prefix strip, add a fallback that checks if any page's hostname
is a suffix of the API hostname (e.g., `podcasts.apple.com` is a suffix of
`amp-api.podcasts.apple.com`). This would help all sites with non-standard API subdomains.

### Problem
The capture CLI (`capture start`) exits with code 13 when run via `nohup` or background processes.
The `Detected unsettled top-level await` warning suggests the process lifecycle isn't designed
for non-interactive use.

**Root cause:** The capture command blocks on a signal handler (Ctrl+C) via top-level await
in the CLI entry point (src/cli.ts:157). Background execution tears down the process before
the await settles.

**Suggested fix:** The two-phase capture approach (start → script → stop) works but is fragile.
Consider a `capture start --daemon` mode that writes a PID file and backgrounds itself properly.

## Missing automation

### Problem
No automated mechanism to discover the correct `page.evaluate()` expression for `page_global`
auth tokens. Had to manually try various expressions (`window.MusicKit?.getInstance()?.developerToken`)
to find the right one.

**Suggested fix:** During capture, when a `Bearer` token is detected in request headers, probe
common page globals (MusicKit, Ember config, NEXT_DATA, etc.) to see which one matches the
captured token value. Record the expression in `analysis.json`.

### Problem
When the API domain differs from the page domain (e.g., `amp-api.podcasts.apple.com` vs
`podcasts.apple.com`), the compile pipeline detects `cookie_session` auth (from browser cookies)
instead of recognizing it's a bearer token from `page_global`. Manual adapter was required.

**Suggested fix:** When all API requests share the same `Authorization: Bearer` header and no
matching cookie produces that value, classify the auth as `bearer_token` or `page_global` instead
of `cookie_session`. Cross-reference the bearer value against page globals during capture.
