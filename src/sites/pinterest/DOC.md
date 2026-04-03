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

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPins | search pins by keyword | query, scope, page_size | id, images, grid_title, description, pinner, board, bookmark | entry point; paginated via `bookmark` |
| getPin | get pin details | id ← searchPins | title, description, link, images, pinner, board, repin/reaction/comment counts | |
| getBoard | get board details | username + slug (e.g. `WhoWhatWear/travel`) | name, description, pin_count, follower_count, owner, cover images | |
| getUserProfile | get user profile | username | full_name, about, follower/following/pin/board counts, image | |
| searchTypeahead | typeahead suggestions | term | label, type, id, images | |

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
```

---

## Site Internals

## API Architecture
Pinterest uses a resource API pattern: `GET /resource/{ResourceName}/get/?source_url=...&data=...`

All read operations use GET with a `data` query parameter containing a JSON-encoded options object. The `data` JSON has the structure `{"options":{...},"context":{}}`.

Key resources:
- `BaseSearchResource` — pin/board/user search
- `PinResource` — pin details
- `BoardResource` — board details
- `UserResource` — user profile
- `AdvancedTypeaheadResource` — search suggestions

## Auth
- **Type:** cookie_session (browser session cookies)
- **CSRF:** cookie_to_header — `csrftoken` cookie → `x-csrftoken` header (POST only)
- Cookies are extracted from the browser automatically

## Transport
- **page** — Pinterest has aggressive bot detection that blocks direct Node.js HTTP requests (403 on all endpoints). Requests must include Pinterest-specific headers: `x-requested-with: XMLHttpRequest`, `x-pinterest-appstate: active`, `x-pinterest-pws-handler`, `x-pinterest-source-url`. These are configured as const/default header parameters in the spec.

## Known Issues
- **Bot detection:** All direct HTTP requests return 403. Even `page.evaluate(fetch)` returns 403 without the correct Pinterest-specific headers. The spec includes these as const header parameters.
- **data parameter:** The `data` query parameter is a JSON-encoded string, requiring double-escaping when passed via CLI.
- **searchPins DRIFT:** Search results are heterogeneous (promoted vs organic pins have different field sets), causing the response shape hash to vary between runs. Verify may report DRIFT for searchPins even when data is correct.
- **x-app-version:** Pinterest's JavaScript includes an `x-app-version` header (commit hash) that changes per deployment. Currently not required for API access, but if requests start failing, this header may need to be added.
