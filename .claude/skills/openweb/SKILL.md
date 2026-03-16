---
name: openweb
description: Access web services (Instagram, Discord, YouTube, GitHub, Telegram, WhatsApp, Reddit, Bluesky, Open-Meteo) through the openweb CLI. Use this skill whenever the user wants to fetch data from, interact with, or query any of these websites — whether they say "check my Instagram", "get Discord messages", "fetch weather data", "list GitHub issues", or anything involving reading/writing data from these web services. Also use this when the user wants to explore what openweb can do, check site availability, or troubleshoot connection issues. This skill is the ONLY way to access these sites' APIs — do not attempt to use curl, fetch, or browser automation directly.
---

# OpenWeb — Web Service Access via CLI

OpenWeb lets you execute API operations against websites using the user's real browser session. It handles authentication, CSRF tokens, and request signing automatically — you just pick the site, the operation, and the parameters.

## Quick Reference

```bash
# All commands run from the openweb project root
pnpm dev sites                                    # List available sites
pnpm dev <site>                                   # Show operations + readiness info
pnpm dev <site> <operation>                       # Show operation params + response shape
pnpm dev <site> exec <op> '<json>' --cdp-endpoint http://localhost:9222  # Execute
```

## Workflow: How to Complete a Task

Follow this sequence every time. Skipping steps leads to wrong parameters or missing prerequisites.

### Step 1: Find the right site

```bash
pnpm dev sites
```

This lists all available sites. Match the user's request to a site name (e.g., "my Instagram feed" → `instagram-fixture`).

### Step 2: Check site readiness

```bash
pnpm dev <site>
```

This shows critical metadata you need before executing:

```
Instagram (3 operations)

Mode:             session_http
Requires browser: yes
Requires login:   yes
Risk summary:     safe:2 medium:1

Operations:
  getTimeline            Get the authenticated user's feed
  getUserProfile         Get a user's profile information
  likeMedia              Like a media post
```

**Read the readiness info carefully:**
- `Requires browser: no` → You can execute directly, no `--cdp-endpoint` needed
- `Requires browser: yes` → Chrome must be running with CDP. Add `--cdp-endpoint http://localhost:9222`
- `Requires login: yes` → The user must be logged in to that site in Chrome

### Step 3: Inspect the operation

```bash
pnpm dev <site> <operation>
```

This shows parameters, their types, which are required, and the response shape:

```
GET /feed/timeline/
  max_id       string    Pagination cursor for next page.
Returns: { items, next_max_id, more_available }
Mode: session_http
Risk: safe
```

Use this to build your JSON params object. Only include parameters you need — defaults are applied automatically.

### Step 4: Execute

```bash
pnpm dev <site> exec <operation> '<json-params>' --cdp-endpoint http://localhost:9222
```

- **stdout** = JSON result (success)
- **stderr** = JSON error (failure)
- Exit code 0 = success, 1 = failure

Omit `--cdp-endpoint` for `direct_http` sites (Requires browser: no).

## Error Handling

Errors come as JSON on stderr with a `failureClass` that tells you exactly what to do:

| failureClass | Meaning | What to Do |
|---|---|---|
| `needs_browser` | Chrome isn't running or CDP isn't reachable | Tell the user to start Chrome with `--remote-debugging-port=9222` |
| `needs_login` | Auth failed — cookies expired or not logged in | Tell the user to log in to the site in Chrome |
| `needs_page` | Browser is connected but no tab matches the site | Tell the user to open a tab and navigate to the site |
| `retriable` | Transient failure (rate limit, network, timeout) | Wait a few seconds and retry (max 2 retries) |
| `fatal` | Permanent failure (wrong params, bad site name) | Don't retry. Fix the parameters or check the site name |

**Error response example:**
```json
{
  "error": "execution_failed",
  "code": "EXECUTION_FAILED",
  "message": "No browser context available.",
  "action": "Open Chrome with --remote-debugging-port=9222.",
  "retriable": true,
  "failureClass": "needs_browser"
}
```

The `action` field contains a human-readable recovery suggestion — relay it to the user.

## Execution Modes (for your understanding, not the user's)

Sites use different modes depending on their API structure. You don't need to choose the mode — it's configured per-site. But understanding them helps you diagnose issues:

- **direct_http**: Public APIs, no browser needed (e.g., Open-Meteo weather)
- **session_http**: Uses browser cookies for auth, but the HTTP request runs from Node.js (e.g., Instagram, GitHub, YouTube)
- **browser_fetch**: The HTTP request runs inside the browser page via `fetch()` (e.g., Discord)
- **L3 adapter**: Arbitrary JavaScript executed in the browser page (e.g., Telegram, WhatsApp)

## Available Sites

| Site | Mode | Auth | Example Operation |
|---|---|---|---|
| `open-meteo-fixture` | direct_http | none | `get_forecast` — weather data |
| `instagram-fixture` | session_http | cookie + CSRF | `getTimeline` — user feed |
| `github-fixture` | session_http | cookie + CSRF | `listIssues` — repo issues |
| `youtube-fixture` | session_http | page_global + signing | `getVideoInfo` — video data |
| `reddit-fixture` | session_http | cookie | operations on subreddits |
| `bluesky-fixture` | session_http | cookie | Bluesky social operations |
| `discord-fixture` | browser_fetch | webpack token | `getMe` — current user |
| `whatsapp-fixture` | L3 adapter | browser state | `getChats` — chat list |
| `telegram-fixture` | L3 adapter | browser state | `getDialogs` — dialog list |

## Common Workflow Examples

### Example 1: Public API (no auth)

User: "What's the weather in Berlin?"

```bash
pnpm dev open-meteo-fixture                    # Check: Requires browser: no
pnpm dev open-meteo-fixture get_forecast       # Check params: latitude, longitude required
pnpm dev open-meteo-fixture exec get_forecast '{"latitude": 52.52, "longitude": 13.41, "hourly": ["temperature_2m"]}'
```

No `--cdp-endpoint` needed since it's direct_http.

### Example 2: Authenticated read (session_http)

User: "Show my Instagram feed"

```bash
pnpm dev instagram-fixture                     # Check: Requires browser: yes, Requires login: yes
pnpm dev instagram-fixture getTimeline         # Check params
pnpm dev instagram-fixture exec getTimeline '{}' --cdp-endpoint http://localhost:9222
```

### Example 3: Path parameters

User: "List 5 issues from facebook/react"

```bash
pnpm dev github-fixture listIssues             # Shows: owner (path), repo (path), per_page (query)
pnpm dev github-fixture exec listIssues '{"owner": "facebook", "repo": "react", "per_page": 5}' --cdp-endpoint http://localhost:9222
```

Path parameters (like `owner` and `repo`) go in the same JSON object as query parameters.

### Example 4: Browser fetch mode

User: "Get my Discord profile"

```bash
pnpm dev discord-fixture getMe                 # No params needed
pnpm dev discord-fixture exec getMe '{}' --cdp-endpoint http://localhost:9222
```

### Example 5: Error recovery

If you get `failureClass: "needs_browser"`:
```
The operation failed because Chrome isn't connected. Please ensure Chrome is running with:
  --remote-debugging-port=9222
Then try again.
```

If you get `failureClass: "needs_login"`:
```
Authentication failed. Please log in to [site] in Chrome, then try again.
```

## Important Notes

- Always check readiness metadata (Step 2) before executing — it prevents wasted retries
- The `--cdp-endpoint` flag is required for any site where `Requires browser: yes`
- JSON params must be a single-quoted string containing a JSON object: `'{"key": "value"}'`
- For `direct_http` sites, omit `--cdp-endpoint` entirely — it's not needed and not used
- Response data can be large (e.g., full feed responses) — summarize for the user rather than dumping raw JSON
- Operations with `Risk: medium` or higher involve mutations (likes, stars, posts) — confirm with the user before executing
- The CDP endpoint `http://localhost:9222` is the standard port — only change if the user specifies otherwise
