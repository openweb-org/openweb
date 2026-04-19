# Pinterest

## Overview
Visual discovery and bookmarking platform. Social media archetype.

## Workflows

### Search and explore pins
1. `searchPins(query)` → results with pin `id`, images, titles, board/pinner info
2. `getPin(id)` → full pin detail with description, link, engagement stats

### Explore boards and users
1. `searchPins(query)` → results include `pinner.username` and `board` slug
2. `getBoard(username, slug)` → board detail with pin count, followers
3. `getUserProfile(username)` → user profile with follower/following counts, bio

### Quick search suggestions
1. `searchTypeahead(term)` → autocomplete suggestions for pins, boards, users

### Save and organize pins
1. `searchPins(query)` or `getHomeFeed()` → find a pin `id`
2. `getBoard(username, slug)` → get target `board_id`
3. `savePin(pin_id, board_id)` → save pin to board
4. `unsavePin(pin_id, board_id)` → remove pin from board

### Follow and unfollow boards
1. `getBoard(username, slug)` → get `board_id`
2. `followBoard(board_id)` → follow the board
3. `unfollowBoard(board_id)` → unfollow the board

### Browse home feed and notifications
1. `getHomeFeed()` → personalized recommended pins
2. `getNotifications()` → recent activity (repins, follows, comments)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPins | search pins by keyword | query, scope, page_size | id, images, grid_title, description, pinner, board, bookmark | entry point; paginated via `bookmark` |
| getPin | get pin details | id ← searchPins | title, description, link, images, pinner, board, repin/reaction/comment counts | |
| getBoard | get board details | username + slug (e.g. `WhoWhatWear/travel`) | name, description, pin_count, follower_count, owner, cover images | |
| getUserProfile | get user profile | username | full_name, about, follower/following/pin/board counts, image | |
| searchTypeahead | typeahead suggestions | term | label, type, id, images | |
| savePin | save pin to board | pin_id, board_id | id, board, pinner | write; reverse: unsavePin |
| unsavePin | remove saved pin from board | pin_id, board_id | status | write; reverse: savePin |
| followBoard | follow a board | board_id | id, name, url | write; reverse: unfollowBoard |
| unfollowBoard | unfollow a board | board_id | status | write; reverse: followBoard |
| getHomeFeed | personalized home feed | page_size | id, images, grid_title, pinner, board, bookmark | paginated via `bookmark` |
| getNotifications | notification feed | page_size | id, type, message, timestamp, actors, target, bookmark | paginated via `bookmark` |

## Quick Start

```bash
# Search for cat pins
openweb pinterest exec searchPins '{"source_url":"/search/pins/?q=cats","data":"{\"options\":{\"query\":\"cats\",\"scope\":\"pins\",\"page_size\":25},\"context\":{}}"}'

# Get pin details
openweb pinterest exec getPin '{"source_url":"/pin/12345/","data":"{\"options\":{\"id\":\"12345\",\"field_set_key\":\"detailed\"},\"context\":{}}"}'

# Get board details
openweb pinterest exec getBoard '{"source_url":"/WhoWhatWear/travel/","data":"{\"options\":{\"slug\":\"WhoWhatWear/travel\",\"field_set_key\":\"detailed\"},\"context\":{}}"}'

# Get user profile
openweb pinterest exec getUserProfile '{"source_url":"/pinterest/","data":"{\"options\":{\"username\":\"pinterest\",\"field_set_key\":\"profile\"},\"context\":{}}"}'

# Save a pin to a board
openweb pinterest exec savePin '{"pin_id":"1149473504911636509","board_id":"1076aborede6421"}'

# Unsave a pin from a board
openweb pinterest exec unsavePin '{"pin_id":"1149473504911636509","board_id":"1076aborede6421"}'

# Follow a board
openweb pinterest exec followBoard '{"board_id":"549autonomy4212"}'

# Unfollow a board
openweb pinterest exec unfollowBoard '{"board_id":"549autonomy4212"}'

# Get home feed
openweb pinterest exec getHomeFeed '{"source_url":"/","data":"{\"options\":{\"field_set_key\":\"hifi\",\"in_nux\":false,\"prependPartner\":false,\"page_size\":25},\"context\":{}}"}'

# Get notifications
openweb pinterest exec getNotifications '{"source_url":"/notifications/","data":"{\"options\":{\"field_set_key\":\"default\",\"page_size\":25},\"context\":{}}"}'
```

---

## Site Internals

## API Architecture
Pinterest uses a resource API pattern: `GET /resource/{ResourceName}/get/?source_url=...&data=...`

All read operations use GET with a `data` query parameter containing a JSON-encoded options object. The `data` JSON has the structure `{"options":{...},"context":{}}`.

Write operations use POST to `/resource/{ResourceName}/create/` or `/resource/{ResourceName}/delete/` with form-encoded `source_url` and `data` fields. The same `{"options":{...},"context":{}}` structure applies.

Key resources:
- `BaseSearchResource` — pin/board/user search
- `PinResource` — pin details + unsave (`/delete/`)
- `BoardResource` — board details
- `UserResource` — user profile
- `AdvancedTypeaheadResource` — search suggestions
- `RepinResource` — save (repin) a pin to a board (`/create/`)
- `ApiResource` — **generic v3 wrapper** (see "ApiResource wrapper pattern" below). Used for follow/unfollow board (deprecated `BoardFollowResource`), batched user/profile fetches, and most internal Pinterest client traffic.
- `UserHomefeedResource` — personalized home feed
- `NewsHubResource` — notification feed

### ApiResource wrapper pattern

Pinterest's modern web client routes most internal v3 REST calls through a
single generic resource: `POST /resource/ApiResource/{create,update,delete,get}/`.
The wrapper takes form-encoded `source_url` + `data`, where `data` is a JSON
string with the wrapped REST URL nested under `options.url`:

```
POST /resource/ApiResource/update/
source_url=/<board-page-path>/
data={"options":{"url":"/v3/boards/<BOARD_ID>/follow/"},"context":{}}
```

The verb in the wrapper path (`create`/`update`/`delete`) maps to the v3
endpoint's HTTP method on the server side. For board follow:
- `update/` = follow
- `delete/` = unfollow

When a deprecated `*Resource` returns `{"error":{"code":20,"message":"unsupported method create"}}`,
that resource has been retired and the action has been folded into ApiResource.
Capture a live click on the action to discover the wrapped v3 URL.

## Auth
- **Type:** cookie_session (browser session cookies)
- **CSRF:** cookie_to_header — `csrftoken` cookie → `x-csrftoken` header (POST/PUT/DELETE)
- Cookies are extracted from the browser automatically
- Write operations require an authenticated session with valid CSRF token

## Transport
- **page** — Pinterest has aggressive bot detection that blocks direct Node.js HTTP requests (403 on all endpoints). Requests must include Pinterest-specific headers: `x-requested-with: XMLHttpRequest`, `x-pinterest-appstate: active`, `x-pinterest-pws-handler`, `x-pinterest-source-url`. These are configured as const/default header parameters in the spec.

## Known Issues
- **Bot detection:** All direct HTTP requests return 403. Even `page.evaluate(fetch)` returns 403 without the correct Pinterest-specific headers. The spec includes these as const header parameters.
- **data parameter:** The `data` query parameter is a JSON-encoded string, requiring double-escaping when passed via CLI.
- **searchPins DRIFT:** Search results are heterogeneous (promoted vs organic pins have different field sets), causing the response shape hash to vary between runs. Verify may report DRIFT for searchPins even when data is correct.
- **x-app-version:** Pinterest's JavaScript includes an `x-app-version` header (commit hash) that changes per deployment. Currently not required for API access, but if requests start failing, this header may need to be added.
- **Write ops best-effort:** Write operations depend on valid session state and CSRF tokens. Pinterest may reject writes if the session is stale or bot detection triggers.
- **Write ops are form-encoded (2026-04-18 verify)**: `POST /resource/{ResourceName}/{create,update,delete}/` uses form-encoded body with two fields — `source_url` and `data` (JSON-string of `{"options":{...},"context":{}}`). Same envelope as read ops, just with `create`/`update`/`delete` verbs and POST + CSRF.
- **`unsavePin` requires the saved-pin record id (RESOLVED 2026-04-19)**: `PinResource/delete/` takes the id returned in `savePin`'s `resource_response.data.id`, not the original `pin_id`. The verify cross-op templating runtime now lets `example.json` reference `${prev.savePin.resource_response.data.id}` and `${prev.savePin.resource_response.data.board.id}`.
- **`followBoard` / `unfollowBoard` re-pointed (RESOLVED 2026-04-19)**: `BoardFollowingResource` returns `{"error":{"code":20,"message":"unsupported method create"}}`. The modern client wraps the v3 REST endpoint inside ApiResource: `POST /resource/ApiResource/{update,delete}/` with `data={"options":{"url":"/v3/boards/{id}/follow/"}}`. Discovered via live HAR — the Follow button is hidden inside the board's "More actions" 3-dot menu, not at the top of the board page.
- **Self-owned content can't be followed/saved**: Pinterest hides the Follow button on boards/users you own. When capturing or testing, pick a public account different from the logged-in user (e.g. `marthastewart`, `realsimple`).
