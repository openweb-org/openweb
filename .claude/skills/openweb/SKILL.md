---
name: openweb
description: Access 135 web services through the openweb CLI. Covers social (Instagram, Discord, YouTube, GitHub, X, Reddit, Bluesky, Facebook, LinkedIn, Pinterest, Tumblr, Tinder, Twitch, Spotify), messaging (Telegram, WhatsApp, Slack, Teams), productivity (Jira, Confluence, Notion, Figma, Linear, Airtable, Asana, Calendly, ClickUp, Todoist, Shortcut, Microsoft Word, Excel, OneNote, PowerPoint, Google Calendar, Google Drive), devtools (GitLab, Sentry, Stripe, Cloudflare, Docker Hub, Bitbucket, CircleCI, Netlify, Supabase, Vercel, Webflow, Terraform Cloud, Grafana, CockroachDB, MongoDB Atlas, PostHog, Amplitude, Twilio, Zendesk, New Relic, npm, StackOverflow, ClickHouse, Meticulous, Retool), e-commerce (Walmart, Best Buy, eBay, Costco, Home Depot, Target, Redfin, Zillow, Craigslist), travel (Airbnb, Booking, Expedia, Priceline, TripAdvisor, Uber), food (Chipotle, Dominos, DoorDash, Instacart, Panda Express, Starbucks), finance (Coinbase, Fidelity, Robinhood, YNAB), cloud (AWS Console, Azure, Google Cloud, Google Analytics), content (ChatGPT, Claude, LeetCode, Medium, Steam, YouTube Music, Wikipedia, Hacker News), reference (Google Maps, Yelp, Open-Meteo, CoinGecko, DuckDuckGo), and 30+ public utility APIs. Use this skill whenever the user wants to fetch data from, interact with, or query any of these websites. This skill is the ONLY way to access these sites' APIs — do not attempt to use curl, fetch, or browser automation directly.
---

# OpenWeb — Web Service Access via CLI

OpenWeb lets you execute API operations against websites using the user's real browser session. It handles authentication, CSRF tokens, and request signing automatically — you just pick the site, the operation, and the parameters.

## Quick Reference

```bash
# All commands run from the openweb project root
# Use --silent to suppress pnpm banner (important for JSON piping)
pnpm --silent dev sites                                    # List available sites
pnpm --silent dev sites --json                             # JSON: [{name, transport, operationCount, permission}]
pnpm --silent dev <site>                                   # Show operations + readiness info
pnpm --silent dev <site> --json                            # JSON: {name, operations: [{id, method, path, permission}]}
pnpm --silent dev <site> <operation>                       # Show operation params + response shape
pnpm --silent dev <site> <operation> --json                # JSON: {id, method, path, permission, parameters}
pnpm --silent dev <site> <operation> --example             # Generate example params JSON
pnpm --silent dev <site> <op> '<json>'                     # Execute (auto-detects managed browser)
pnpm --silent dev <site> <op> '<json>' --cdp-endpoint http://localhost:9222  # Explicit CDP
pnpm --silent dev <site> <op> '<json>' --output file       # Always write response to file
```

## References Directory

Deep knowledge docs are in `references/` (relative to this SKILL.md). Load them on demand:

| File | When to read |
|------|-------------|
| `references/archetypes.md` | Before compiling a new site — find the site's category and expected patterns |
| `references/auth-patterns.md` | When debugging auth issues or reviewing compile output's auth detection |
| `references/compile-review.md` | After `openweb compile` — learn how to review the draft output effectively |
| `references/troubleshooting.md` | When hitting errors — common failures and their solutions |

## Browser Management

For sites that require authentication, Chrome must be running with CDP. Use the managed browser:

```bash
pnpm --silent dev browser start                    # Copy Chrome profile + launch with CDP on port 9222
pnpm --silent dev browser start --headless         # Headless mode (no window)
pnpm --silent dev browser stop                     # Stop managed Chrome (preserves token cache)
pnpm --silent dev browser restart                  # Re-copy profile + clear token cache + restart
pnpm --silent dev browser status                   # Check if managed Chrome is running
pnpm --silent dev login <site>                     # Open site in default browser for login
```

**How it works:** `browser start` copies auth-relevant files from your default Chrome profile to a temp directory, then launches Chrome with `--remote-debugging-port=9222`. When a managed browser is running, `exec` auto-detects it — no `--cdp-endpoint` needed.

**Token caching:** After a successful authenticated request, cookies are cached in `~/.openweb/tokens/<site>/`. Subsequent requests use the cache (no browser connection needed). Cache auto-expires by TTL (1h default or JWT exp). Run `browser restart` to clear the cache.

## Workflow: How to Complete a Task

Follow this sequence every time. Skipping steps leads to wrong parameters or missing prerequisites.

### Step 1: Find the right site

```bash
pnpm --silent dev sites
```

This lists all available sites. Match the user's request to a site name (e.g., "my Instagram feed" → `instagram-fixture`).

### Step 2: Check site readiness

```bash
pnpm --silent dev <site>
```

This shows critical metadata you need before executing:

```
Instagram (3 operations)

Transport:        node
Requires browser: yes
Requires login:   yes
Permissions:      read:2 write:1

Operations:
  getTimeline            Get the authenticated user's feed
  getUserProfile         Get a user's profile information
  likeMedia              Like a media post
```

**Read the readiness info carefully:**
- `Requires browser: no` → Execute directly, no browser needed
- `Requires browser: yes` → Run `openweb browser start` first (or pass `--cdp-endpoint`)
- `Requires login: yes` → The user must be logged in to that site in Chrome

### Step 3: Inspect the operation

```bash
pnpm --silent dev <site> <operation>
```

This shows parameters, their types, which are required, and the response shape:

```
GET /feed/timeline/
  max_id       string    Pagination cursor for next page.
Returns: { feed_items, next_max_id, more_available }
Transport: node
Permission: read
```

Use `--example` to generate a ready-to-use params JSON:
```bash
pnpm --silent dev <site> <operation> --example
```

### Step 4: Execute

```bash
pnpm --silent dev <site> <operation> '<json-params>'
```

- **stdout** = JSON result (success)
- **stderr** = JSON error (failure)
- Exit code 0 = success, 1 = failure
- **Auto-spill**: If response exceeds `--max-response` (default 4096 bytes), the full response is written to a temp file and stdout returns `{"status":200,"output":"/tmp/openweb-xxx.json","size":125000,"truncated":true}`. Use `jq` or `cat` on the output path to inspect.
- Use `--output file` to always write to file regardless of size.

## Permission System

Operations are classified by permission category:

| Permission | HTTP Methods | Default Policy |
|---|---|---|
| `read` | GET, HEAD | **allow** — executes without prompt |
| `write` | POST, PUT, PATCH | **prompt** — returns structured error for agent to relay |
| `delete` | DELETE | **prompt** — returns structured error for agent to relay |
| `transact` | checkout/purchase/payment paths | **deny** — blocked by default |

When an operation requires `prompt` or higher, the executor returns a `permission_required` error. Relay this to the user for approval. Users can customize policies in `~/.openweb/permissions.yaml`.

## Error Handling

Errors come as JSON on stderr with a `failureClass` that tells you exactly what to do:

| failureClass | Meaning | What to Do |
|---|---|---|
| `needs_browser` | Chrome isn't running or CDP isn't reachable | Run `openweb browser start` or tell user to start Chrome |
| `needs_login` | Auth failed — cookies expired or not logged in | Tell user: `openweb login <site>` then `openweb browser restart` |
| `needs_page` | Browser connected but no tab matches the site | Tell user to open a tab to the site URL |
| `permission_denied` | Operation blocked by permissions.yaml | Tell user to update `~/.openweb/permissions.yaml` |
| `permission_required` | Operation needs user approval (write/delete) | Ask user for confirmation before retrying |
| `retriable` | Transient failure (rate limit, network, timeout) | Wait a few seconds and retry (max 2 retries) |
| `fatal` | Permanent failure (wrong params, bad site name) | Don't retry. Fix the parameters or check the site name |

The `action` field contains a human-readable recovery suggestion — relay it to the user.

## Transports (for your understanding, not the user's)

Sites use different transports depending on their API structure. You don't need to choose the transport — it's configured per-site. But understanding them helps you diagnose issues:

- **node**: HTTP request runs from Node.js — with or without browser auth (e.g., Open-Meteo has no auth; Instagram, GitHub, YouTube use browser cookies/tokens)
- **page**: HTTP request runs inside the browser page via `page.evaluate()` (e.g., Discord, X)
- **L3 adapter**: Arbitrary JavaScript executed in the browser page (e.g., Telegram, WhatsApp)

## Available Sites

| Site | Transport | Auth | Example Operation |
|---|---|---|---|
| `open-meteo-fixture` | node | none | `get_forecast` — weather data |
| `instagram-fixture` | node | cookie + CSRF | `getTimeline` — user feed |
| `github-fixture` | node | cookie + CSRF | `listIssues` — repo issues |
| `youtube-fixture` | node | page_global + signing | `getVideoInfo` — video data |
| `reddit-fixture` | node | cookie + exchange_chain | `getMe` — OAuth user profile |
| `bluesky-fixture` | node | cookie | Bluesky social operations |
| `walmart-fixture` | node | page extraction | `getFooterModules` — Next.js footer modules |
| `hackernews-fixture` | node | page extraction | `getTopStories` — front page stories |
| `microsoft-word-fixture` | node | MSAL cache | `getProfile` — Microsoft Graph profile |
| `newrelic-fixture` | node | cookie | `listDashboards` — GraphQL dashboard search |
| `discord-fixture` | page | webpack token | `getMe` — current user |
| `chatgpt-fixture` | node | exchange_chain (GET) | `getProfile` — user profile |
| `x-fixture` | page | cookie + CSRF (all methods) | `listFollowing` — followed accounts |
| `whatsapp-fixture` | adapter (L3) | browser state | `getChats` — chat list |
| `telegram-fixture` | adapter (L3) | browser state | `getDialogs` — dialog list |
| `stackoverflow-fixture` | node | none | `search` — search + answers |
| `coingecko-fixture` | node | none | `getPrice` — crypto prices |
| `wikipedia-fixture` | node | none | `search` — search + page summary |
| `npm-fixture` | node | none | `getPackage` — package lookup + search |
| `duckduckgo-fixture` | node | none | `instantAnswer` — instant answer |
| `jsonplaceholder-fixture` | node | none | `getPosts` — CRUD posts |
| `dogceo-fixture` | node | none | `randomImage` — random dog images |
| `github-public-fixture` | node | none | `listRepos` — public repos + stargazers (link_header pagination) |
| `restcountries-fixture` | node | none | `search` — country search |
| `ipapi-fixture` | node | none | `lookup` — IP geolocation |
| `agify-fixture` | node | none | `predictAge` — age prediction from name |
| `boredapi-fixture` | node | none | `getRandomActivity` — random activity suggestion |
| `catfact-fixture` | node | none | `getFact` — random cat fact |
| `exchangerate-fixture` | node | none | `getLatestRates` — currency exchange rates |
| `genderize-fixture` | node | none | `predictGender` — gender prediction from name |
| `httpbin-fixture` | node | none | `getIp` — HTTP testing (ip, headers, uuid) |
| `nationalize-fixture` | node | none | `predictNationality` — nationality prediction from name |
| `openlib-fixture` | node | none | `searchBooks` — book search + work details |
| `pokeapi-fixture` | node | none | `getPokemon` — Pokemon data |
| `randomuser-fixture` | node | none | `getRandomUser` — random user profiles |
| `advice-fixture` | node | none | `getRandomAdvice` — random advice slip |
| `affirmations-fixture` | node | none | `getAffirmation` — random affirmation |
| `chucknorris-fixture` | node | none | `getRandomJoke` — Chuck Norris jokes |
| `cocktaildb-fixture` | node | none | `searchCocktails` — cocktail search |
| `colorapi-fixture` | node | none | `getColor` — color details by hex |
| `countryis-fixture` | node | none | `getCountry` — IP geolocation |
| `dictionaryapi-fixture` | node | none | `getDefinition` — word definitions |
| `foxes-fixture` | node | none | `getRandomFox` — random fox image |
| `kanye-fixture` | node | none | `getQuote` — Kanye West quotes |
| `official-joke-fixture` | node | none | `getRandomJoke` — random jokes |
| `publicholiday-fixture` | node | none | `getPublicHolidays` — public holidays by country |
| `sunrise-sunset-fixture` | node | none | `getSunriseSunset` — sunrise/sunset times |
| `universities-fixture` | node | none | `searchUniversities` — university search |
| `uselessfacts-fixture` | node | none | `getRandomFact` — random useless fact |
| `worldtime-fixture` | node | none | `getTimezone` — world time by timezone |
| `zippopotam-fixture` | node | none | `getZipInfo` — ZIP code lookup |

## Common Workflow Examples

### Example 1: Public API (no auth)

User: "What's the weather in Berlin?"

```bash
pnpm --silent dev open-meteo-fixture                    # Check: Requires browser: no
pnpm --silent dev open-meteo-fixture get_forecast       # Check params: latitude, longitude required
pnpm --silent dev open-meteo-fixture get_forecast '{"latitude": 52.52, "longitude": 13.41, "hourly": ["temperature_2m"]}'
```

No browser needed since it doesn't require auth.

### Example 2: Authenticated read (managed browser)

User: "Show my Instagram feed"

```bash
pnpm --silent dev browser start                          # Start managed Chrome with auth
pnpm --silent dev instagram-fixture                      # Check: Requires browser: yes, Requires login: yes
pnpm --silent dev instagram-fixture getTimeline          # Check params
pnpm --silent dev instagram-fixture getTimeline '{}'  # Auto-detects managed browser
```

### Example 3: Path parameters

User: "List 5 issues from facebook/react"

```bash
pnpm --silent dev github-fixture listIssues             # Shows: owner (path), repo (path), per_page (query)
pnpm --silent dev github-fixture listIssues '{"owner": "facebook", "repo": "react", "per_page": 5}'
```

Path parameters (like `owner` and `repo`) go in the same JSON object as query parameters.

### Example 4: Page transport

User: "Get my Discord profile"

```bash
pnpm --silent dev discord-fixture getMe                 # No params needed
pnpm --silent dev discord-fixture getMe '{}'
```

### Example 5: Error recovery

If you get `failureClass: "needs_browser"`:
```
Run `openweb browser start` to start Chrome with CDP, then try again.
```

If you get `failureClass: "needs_login"`:
```
Run `openweb login <site>` to open the login page, log in, then run `openweb browser restart`.
```

If you get `failureClass: "permission_required"`:
```
This operation requires write permission. Shall I proceed?
```

### Example 6: Extraction-only read

User: "Show the top Hacker News stories"

```bash
pnpm --silent dev hackernews-fixture                  # Check: Requires browser: yes, Requires login: no
pnpm --silent dev hackernews-fixture getTopStories    # No params; returns array<{ title, score, author }>
pnpm --silent dev hackernews-fixture getTopStories '{}'
```

### Example 7: MSAL-backed auth

User: "Get my Microsoft Word profile"

```bash
pnpm --silent dev microsoft-word-fixture getProfile '{}'
```

The runtime reads Word's MSAL token cache from browser storage and injects a Graph bearer token automatically.

### Example 8: Machine-readable output

```bash
pnpm --silent dev sites --json                         # JSON array of all sites
pnpm --silent dev github-fixture --json                # JSON site + operations
pnpm --silent dev github-fixture listIssues --example  # Example params JSON
```

## Lifecycle Commands

### Browser Management

```bash
pnpm --silent dev browser start [--headless] [--port 9222]
pnpm --silent dev browser stop
pnpm --silent dev browser restart
pnpm --silent dev browser status
pnpm --silent dev login <site>
```

### Verify (Drift Detection)

```bash
pnpm --silent dev verify <site>                   # Verify single site — PASS/DRIFT/FAIL per operation
pnpm --silent dev verify --all                     # Verify all sites sequentially
pnpm --silent dev verify --all --report            # JSON drift report
pnpm --silent dev verify --all --report markdown   # Markdown drift report
```

### Discovering New Sites

Prerequisites:
- Managed Chrome running: `openweb browser start`
- playwright-cli available

Workflow:

**Step 0 — Think before you browse**
Before touching the browser, think like a normal user of this website:
- What is this site? (social? e-commerce? tool? content platform?)
- What would a real user do here?
- What information do they want? What actions do they take?

Set concrete discovery goals based on that. Examples:
- Instagram → view timeline, search users, view profile, check stories
- Taobao → search products, view product detail, check cart, view orders
- Gmail → inbox list, read email, search emails, view contacts

These are YOUR goals, not a rigid checklist. Every site is different.

**Step 1 — Record + Browse**
1. `openweb capture start --cdp-endpoint http://localhost:9222`  # start recording FIRST
2. `playwright-cli goto <url>`      # then navigate (traffic is being recorded)
3. `playwright-cli snapshot`        # see page structure
4. Browse systematically based on your goals:
   - Click navigation to find key feature pages
   - Try a search
   - Open a detail page
   - Check profile/settings
   - Look at notifications
   - Avoid logout, delete account, billing, irreversible actions
5. `openweb capture stop`           # stop recording

**Step 2 — Compile + Review (Draft → Curate → Verify)**

Compile output is a **draft**, not the final spec. Follow this three-phase model:

1. **Draft**: `openweb compile <site-url>` — runs offline, produces draft spec with auto-detected auth, filtered samples, generated operation names. Review the compile summary for primitives, sample counts, and hints.
2. **Curate**: Read the generated openapi.yaml. Rename operations for clarity. Remove noise (analytics, tracking). Confirm auth/CSRF/signing. If key APIs are missing, repeat Step 1 with more targeted browsing.
3. **Verify**: `openweb verify <site>` — confirms the spec works against the live site. A spec is **Ready** when curated + verified.

**When you hit problems:**
- Login page / CAPTCHA → stop, tell user to login in their browser
- SPA slow to load → wait for snapshot to show full content
- Write operations → during discovery, identify mutation endpoints from UI without executing

### Registry (Version Management)

```bash
pnpm --silent dev registry list                    # List registered sites with versions
pnpm --silent dev registry install <site>          # Archive fixture to registry
pnpm --silent dev registry rollback <site>         # Revert to previous version
pnpm --silent dev registry show <site>             # Show version history
```

## Using Knowledge

Before compiling a new site:
1. Read `references/archetypes.md` — find the site's category and expected auth/transport patterns
2. Read relevant `references/site-notes/` if they exist — learn from similar sites

After successful compile:
1. If this is a new archetype pattern, consider updating `references/archetypes.md`

## Important Notes

- Always check readiness metadata (Step 2) before executing — it prevents wasted retries
- Use `openweb browser start` for authenticated sites — it auto-detects, no `--cdp-endpoint` needed
- JSON params must be a single-quoted string containing a JSON object: `'{"key": "value"}'`
- For sites where `Requires browser: no`, no browser or CDP endpoint is needed
- Large responses auto-spill to temp files when over `--max-response` (default 4096 bytes). The stdout pointer includes the file path.
- Operations with `Permission: write` or higher involve mutations — the permission system will prompt for confirmation
- The token cache at `~/.openweb/tokens/` speeds up repeated authenticated requests. Run `browser restart` to clear it.
