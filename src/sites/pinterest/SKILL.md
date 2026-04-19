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

### Save a pin to a board (verified)
1. `searchPins(query)` or `getHomeFeed()` → find pin → `id` (= `pin_id`)
2. `searchPins(query)` → result includes `pinner.username` and `board` slug
3. `getBoard(username, slug)` → target board → `board_id`
4. `savePin(pin_id ← searchPins, board_id ← getBoard)` → response includes the **saved-pin record** `id` (NOT the same as `pin_id`)

### Remove a saved pin (BLOCKED — see Known Limitations)
1. `savePin(...)` → response `id` (saved-pin record id)
2. `unsavePin(id ← savePin response, board_id)` — `PinResource/delete/` requires the saved-pin record id from `savePin` response. Verify has no `${prev}` cross-op templating, so this op cannot be exercised end-to-end without manual chaining.

### Follow and unfollow boards (BLOCKED — see Known Limitations)
1. `searchPins(query)` → result includes `pinner.username` and `board` slug
2. `getBoard(username, slug)` → `board_id`
3. `followBoard(board_id)` — Pinterest deprecated `BoardFollowResource`. Modern flow is GraphQL persisted-query.
4. `unfollowBoard(board_id)` — same blocker.

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
| savePin | save pin to board | pin_id ← searchPins/getHomeFeed, board_id ← getBoard | id, board, pinner | write; reverse: unsavePin |
| unsavePin | remove saved pin from board | pin_id ← searchPins/getHomeFeed, board_id ← getBoard | status | write; reverse: savePin |
| followBoard | follow a board | board_id ← getBoard | id, name, url | write; reverse: unfollowBoard |
| unfollowBoard | unfollow a board | board_id ← getBoard | status | write; reverse: followBoard |
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
openweb pinterest exec savePin '{"source_url":"/","data":"{\"options\":{\"pin_id\":\"PIN_ID\",\"board_id\":\"BOARD_ID\",\"section_id\":null},\"context\":{}}"}'

# Unsave a pin (uses PinResource/delete — id is the saved-pin id from savePin response, NOT the original pin_id)
openweb pinterest exec unsavePin '{"source_url":"/","data":"{\"options\":{\"id\":\"SAVED_PIN_ID\",\"board_id\":\"BOARD_ID\"},\"context\":{}}"}'

# Follow a board (BLOCKED 2026-04-18: Pinterest deprecated BoardFollowResource; modern follow flow appears to be GraphQL-only and requires reverse-engineering a persisted query hash)
openweb pinterest exec followBoard '{"source_url":"/","data":"{\"options\":{\"board_id\":\"BOARD_ID\"},\"context\":{}}"}'

# Unfollow a board (BLOCKED — same reason as followBoard)
openweb pinterest exec unfollowBoard '{"source_url":"/","data":"{\"options\":{\"board_id\":\"BOARD_ID\"},\"context\":{}}"}'

# Get home feed
openweb pinterest exec getHomeFeed '{"source_url":"/","data":"{\"options\":{\"field_set_key\":\"hifi\",\"in_nux\":false,\"prependPartner\":false,\"page_size\":25},\"context\":{}}"}'

# Get notifications
openweb pinterest exec getNotifications '{"source_url":"/notifications/","data":"{\"options\":{\"field_set_key\":\"default\",\"page_size\":25},\"context\":{}}"}'
```

## Known Limitations
- **`unsavePin` requires server-generated id from `savePin` response** — `PinResource/delete/` takes the saved-pin record id (not the original `pin_id`). Verify has no `${prev.<opId>.<json-path>}` templating, so the chain cannot run end-to-end. Workaround: stash a known-stable saved-pin id in fixtures; long-term: see `doc/todo/write-verify/handoff.md` §4.1 for the architectural fix.
- **`followBoard` / `unfollowBoard` BLOCKED (2026-04-18)** — Pinterest deprecated `BoardFollowResource`. The modern follow flow is a **GraphQL persisted-query** (Apollo) and requires reverse-engineering a fresh `doc_id` hash from a live capture before it can be repointed.
- **Write ops use form-encoded bodies** — `POST /resource/{ResourceName}/{create,delete}/` with form-encoded `source_url` + `data` fields (where `data` is a JSON-string of `{"options":{...},"context":{}}`). Mirror this for any new write op unless HAR proves otherwise.
