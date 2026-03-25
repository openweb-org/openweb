# Pinterest Fixture — Progress

## 2026-03-24: Initial discovery — 10 operations

**What changed:**
- Created pinterest with 10 operations: searchPins, searchBoards, getPinDetails, getBoardDetails, getBoardPins, getUserProfile, getUserBoards, getRelatedPins, getTypeahead, getPinComments

**Why:**
- Pinterest is the leading visual discovery platform — image/pin search, board browsing, and trend discovery
- All 10 operations use the Resource API at `/resource/{Name}/get/` with page transport (bot detection via PerimeterX)
- Resource API returns structured JSON in `resource_response.data` wrapper — no DOM parsing needed

**Discovery process:**
1. Browsed homepage, searched pins ("minimalist interior design", "healthy recipes"), searched boards ("travel photography"), clicked pin details, browsed boards, viewed user profiles, explored ideas/today pages
2. Captured 512 API requests across 33 distinct resource endpoints via CDP network monitoring
3. Selected 10 resource endpoints covering core user intents: search (pins/boards), detail views (pin/board/user), pagination (board pins), discovery (related pins, typeahead), engagement (comments)
4. Built adapter with `page.evaluate(fetch(...))` pattern for resource API calls
5. Modeled response schemas from observed traffic patterns

**Verification:** Content-level verification pending — adapter created from observed API patterns. BaseSearchResource serves pin/board search with bookmark pagination. PinResource returns detailed pin data (image, source link, repin count). BoardResource/BoardFeedResource return board metadata and pin lists. UserResource returns profile data (follower count, boards, pins). RelatedModulesResource provides "more like this" recommendations.

**Knowledge updates:** Pinterest uses a custom Resource API pattern — all data served through `/resource/{ResourceName}/get/` with JSON-encoded options in `data` query parameter. Bookmark-based pagination (no page numbers). PerimeterX bot detection blocks direct HTTP. Response shape: `{ resource_response: { data: ... } }`. CSRF token from `csrftoken` cookie required for write operations, optional for reads.
