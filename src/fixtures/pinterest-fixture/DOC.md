# Pinterest

## Overview
Visual discovery and bookmarking platform. Search pins/images by keyword, browse boards, view user profiles, get pin details, discover related content, and read comments via Pinterest's Resource API.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchPins | search pins/images by keyword | Resource API | BaseSearchResource, scope=pins; paginated via bookmark |
| searchBoards | search boards by keyword | Resource API | BaseSearchResource, scope=boards; paginated via bookmark |
| getPinDetails | get full pin detail (image, source, pinner) | Resource API | PinResource, field_set_key=detailed |
| getBoardDetails | get board metadata (name, pin count, owner) | Resource API | BoardResource, by ID or slug |
| getBoardPins | get pins in a board | Resource API | BoardFeedResource; paginated via bookmark |
| getUserProfile | get user profile (bio, followers, pin count) | Resource API | UserResource, field_set_key=profile |
| getUserBoards | get boards for a user | Resource API | BoardsResource; sorted by last_pinned_to |
| getRelatedPins | get "more like this" recommendations | Resource API | RelatedModulesResource for a pin ID |
| getTypeahead | search autocomplete suggestions | Resource API | AdvancedTypeaheadResource |
| getPinComments | get comments on a pin | Resource API | UnifiedCommentsResource; paginated |

## API Architecture
- **Resource API**: All data served through `/resource/{ResourceName}/get/` GET endpoints
- **Query params**: `source_url` (context URL), `data` (JSON-encoded options object)
- **Pagination**: Bookmark-based — response includes a `bookmark` string for next page
- **No GraphQL**: Pinterest uses its own Resource API pattern (some GraphQL at `/_/graphql/` but Resource API covers all major operations)
- **Response shape**: `{ resource_response: { data: ... } }` wrapper

## Auth
- Most public data accessible without login (`requires_auth: false`)
- Logged-in users get personalized home feed and recommendations
- Auth tracked via `_auth`, `_pinterest_sess` cookies
- CSRF protection via `csrftoken` cookie → `X-CSRFToken` header (required for write operations, optional for reads)

## Transport
- `transport: page` — browser fetch for all operations
- Bot detection active (PerimeterX) — direct HTTP returns challenges
- Resource API requires `X-Requested-With: XMLHttpRequest` header
- Responses are JSON with `resource_response.data` wrapper

## Extraction
- **Adapter-based**: All operations use the `pinterest-api` adapter
- Resource API returns structured JSON — no DOM parsing needed
- Options object varies per resource (documented per operation)

## Known Issues
- **Bot detection**: Direct HTTP (curl/fetch outside browser) blocked by PerimeterX
- **Rate limiting**: Heavy API usage may trigger temporary blocks
- **Logged-out limitations**: Home feed returns generic trending content without login
- **Bookmark pagination**: No page numbers; must iterate sequentially via bookmarks
- **Write operations**: Save, create board, comment require auth + CSRF token (not implemented)
