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
4. `savePin(pin_id ← searchPins, board_id ← getBoard)` → response includes the **saved-pin record** `id` (NOT the same as `pin_id`) and the chosen `board.id`

### Remove a saved pin (verified, requires cross-op chain)
1. `savePin(...)` → `resource_response.data.id` (saved-pin record id), `resource_response.data.board.id`
2. `unsavePin(id ← savePin response, board_id ← savePin response)` — `PinResource/delete/` requires the **saved-pin record id**, not the original `pin_id`. In `example.json` use `${prev.savePin.resource_response.data.id}` and `${prev.savePin.resource_response.data.board.id}` so verify chains the IDs.

### Follow and unfollow boards (verified)
1. `searchPins(query)` → result includes `pinner.username` and `board` slug
2. `getBoard(username, slug)` → `board_id`
3. `followBoard(board_id)` → wraps `POST /v3/boards/{board_id}/follow/` inside `/resource/ApiResource/update/`
4. `unfollowBoard(board_id)` → wraps the same v3 URL inside `/resource/ApiResource/delete/`

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
| savePin | save pin to board | pin_id ← searchPins/getHomeFeed, board_id ← getBoard | resource_response.data.id (saved-pin record), resource_response.data.board.id | write; reverse: unsavePin |
| unsavePin | remove saved pin from board | id ← savePin (saved-pin record), board_id ← savePin | status | write; reverse: savePin. Use `${prev.savePin.resource_response.data.{id,board.id}}` |
| followBoard | follow a board | board_id ← getBoard (URL `/v3/boards/{board_id}/follow/`) | id, name, url, followed_by_me | write; routed via `/resource/ApiResource/update/`; reverse: unfollowBoard |
| unfollowBoard | unfollow a board | board_id ← getBoard (URL `/v3/boards/{board_id}/follow/`) | status | write; routed via `/resource/ApiResource/delete/`; reverse: followBoard |
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

# Unsave a pin (uses PinResource/delete — id is the saved-pin record id from savePin response, NOT the original pin_id)
openweb pinterest exec unsavePin '{"source_url":"/","data":"{\"options\":{\"id\":\"SAVED_PIN_ID\",\"board_id\":\"BOARD_ID\"},\"context\":{}}"}'

# Follow a board (modern endpoint: /resource/ApiResource/update/ wrapping /v3/boards/{board_id}/follow/)
openweb pinterest exec followBoard '{"source_url":"/marthastewart/baking-and-dessert-recipes-and-ideas/","data":"{\"options\":{\"url\":\"/v3/boards/BOARD_ID/follow/\"},\"context\":{}}"}'

# Unfollow a board (same wrapped URL via /resource/ApiResource/delete/)
openweb pinterest exec unfollowBoard '{"source_url":"/marthastewart/baking-and-dessert-recipes-and-ideas/","data":"{\"options\":{\"url\":\"/v3/boards/BOARD_ID/follow/\"},\"context\":{}}"}'

# Get home feed
openweb pinterest exec getHomeFeed '{"source_url":"/","data":"{\"options\":{\"field_set_key\":\"hifi\",\"in_nux\":false,\"prependPartner\":false,\"page_size\":25},\"context\":{}}"}'

# Get notifications
openweb pinterest exec getNotifications '{"source_url":"/notifications/","data":"{\"options\":{\"field_set_key\":\"default\",\"page_size\":25},\"context\":{}}"}'
```

## Known Limitations
- **`unsavePin` requires the saved-pin record id from `savePin`** — `PinResource/delete/` takes the id returned in `savePin`'s `resource_response.data.id` (NOT the original `pin_id`). When chaining manually, save the response from `savePin` and pass its `id` + `board.id` to `unsavePin`. In `example.json`, use `${prev.savePin.resource_response.data.id}` and `${prev.savePin.resource_response.data.board.id}` (verify cross-op templating).
- **Board follow lives behind the "More actions" menu** — Pinterest deprecated `/resource/BoardFollowingResource/`. The modern follow/unfollow click is wrapped: `POST /resource/ApiResource/{update,delete}/` with body `data={"options":{"url":"/v3/boards/{board_id}/follow/"},"context":{}}`. The board's UI Follow button moved into the 3-dot menu — easy to miss when capturing HAR.
- **Write ops use form-encoded bodies** — `POST /resource/{ResourceName}/{create,update,delete}/` with form-encoded `source_url` + `data` fields (where `data` is a JSON-string of `{"options":{...},"context":{}}`). Mirror this for any new write op unless HAR proves otherwise.
- **`source_url` should match the page where the action would naturally happen** — Pinterest sometimes rejects writes when `source_url` is just `/`. Use the board/pin URL the action targets (e.g. `/<username>/<board-slug>/`).
