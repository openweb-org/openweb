# Xiaohongshu (小红书)

## Overview
Chinese social media / lifestyle platform — Instagram + Pinterest hybrid. Archetype: Social Media.

## Workflows

### Search and read notes
1. `searchNotes(keyword)` → pick note → `noteId`, `xsecToken`
2. `getNoteDetail(noteId, xsecToken)` → full content, stats, top comments
3. `getNoteComments(noteId, xsecToken)` → dedicated comment listing with pagination

### Explore trending content
1. `getHotSearch()` → trending keywords with popularity scores
2. `searchNotes(keyword)` → notes for a trending topic
3. `getNoteDetail(noteId, xsecToken)` → full note detail

### Browse explore feed
1. `getExploreFeed()` → trending/recommended notes → `noteId`, `xsecToken`
2. `getNoteDetail(noteId, xsecToken)` → full note detail
3. `getRelatedNotes(noteId, xsecToken)` → similar/recommended notes

### Research a user
1. `searchNotes(keyword)` → find user from results → `userId`
2. `getUserProfile(userId)` → bio, follower counts, location tags
3. `getUserNotes(userId)` → all posted notes
4. `getUserCollections(userId)` → bookmarked notes (if public)
5. `getUserLiked(userId)` → liked notes (if public)

### Interact with content (requires login)
1. `searchNotes(keyword)` → find note → `noteId`, `xsecToken`
2. `likeNote(noteId, xsecToken)` → like it (idempotent)
3. `bookmarkNote(noteId, xsecToken)` → bookmark it (idempotent)
4. `commentNote(noteId, content, xsecToken)` → post a comment
5. `followUser(userId)` → follow the author (idempotent)

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchNotes | search posts by keyword | keyword | noteId, xsecToken, displayTitle, user, likedCount | entry point |
| getNoteDetail | get full note + comments | noteId ← searchNotes, xsecToken ← searchNotes | title, desc, interactInfo, tagList, comments | includes top 20 comments |
| getNoteComments | get comments for a note | noteId ← searchNotes, xsecToken ← searchNotes | comments, hasMore, cursor | paginated, dedicated comment fetch |
| getUserProfile | get user profile | userId ← searchNotes/getNoteDetail | nickname, desc, gender, interactions, tags | CAPTCHA risk under rapid access |
| getUserNotes | user's posted notes | userId ← searchNotes/getNoteDetail | notes (noteId, displayTitle, likedCount) | first page from SSR |
| getUserCollections | user's bookmarked notes | userId ← searchNotes/getNoteDetail | notes (noteId, displayTitle, likedCount) | empty if private |
| getUserLiked | user's liked notes | userId ← searchNotes/getNoteDetail | notes (noteId, displayTitle, likedCount) | empty if private |
| getExploreFeed | trending/recommended feed | — | noteId, xsecToken, displayTitle, likedCount | entry point, ~70 notes |
| getHotSearch | trending search terms | — | keyword, score, rank | entry point |
| getRelatedNotes | related notes for a note | noteId ← searchNotes, xsecToken ← searchNotes | notes (noteId, displayTitle, likedCount) | from recommend API or SSR |
| likeNote | like a note | noteId ← searchNotes, xsecToken ← searchNotes | liked, action | SAFE: idempotent, requires login |
| bookmarkNote | bookmark a note | noteId ← searchNotes, xsecToken ← searchNotes | bookmarked, action | SAFE: idempotent, requires login |
| followUser | follow a user | userId ← searchNotes/getNoteDetail | followed, action | SAFE: idempotent, requires login |
| commentNote | comment on a note | noteId ← searchNotes, content, xsecToken ← searchNotes | commentId, action | CAUTION: creates content, requires login |

## Quick Start

```bash
# Search for coffee-related notes
openweb xiaohongshu exec searchNotes '{"keyword": "咖啡"}'

# Get full note detail with comments
openweb xiaohongshu exec getNoteDetail '{"noteId": "6912d7eb000000000402a319"}'

# Get comments for a note
openweb xiaohongshu exec getNoteComments '{"noteId": "6912d7eb000000000402a319"}'

# Get trending search terms
openweb xiaohongshu exec getHotSearch '{}'

# Browse explore feed
openweb xiaohongshu exec getExploreFeed '{}'

# Get user profile
openweb xiaohongshu exec getUserProfile '{"userId": "661358f70000000003030d89"}'

# Get user's posted notes
openweb xiaohongshu exec getUserNotes '{"userId": "661358f70000000003030d89"}'

# Get user's bookmarked notes
openweb xiaohongshu exec getUserCollections '{"userId": "661358f70000000003030d89"}'

# Get related notes for a note
openweb xiaohongshu exec getRelatedNotes '{"noteId": "6912d7eb000000000402a319"}'

# Like a note (requires login)
openweb xiaohongshu exec likeNote '{"noteId": "6912d7eb000000000402a319"}'
```

---

## Site Internals

## API Architecture
- Vue 3 SSR app — data baked into `window.__INITIAL_STATE__` on page load
- Internal REST APIs at `edith.xiaohongshu.com/api/sns/web/v1/*` and `/v2/*`
- Direct API calls fail (500) — all endpoints require anti-bot signature headers (`X-s`, `X-t`, `X-s-common`) from obfuscated JS
- Comments loaded async via `/api/sns/web/v2/comment/page` — intercepted from page's own JS
- Related notes loaded via `/api/sns/web/v1/note/recommend` — intercepted or from SSR state
- Write ops (like, bookmark, follow, comment) work by clicking DOM buttons / filling inputs — page JS handles signed API calls

## Auth
- Cookie session (`web_session` cookie)
- Search, note detail, explore feed, hot search, comments, related notes work without login
- User profile, collections, liked may require session or trigger CAPTCHA more aggressively
- Like, bookmark, follow, and comment require login
- Anti-bot: custom obfuscated JS signing (not standard PerimeterX/DataDome/Akamai)

## Transport
- `page` (L3 adapter) — all data extracted from page navigation + SSR state + API interception + button clicks
- Cannot downgrade to `node` — API signing is mandatory and deeply obfuscated

## Known Issues
- **searchNotes DRIFT**: `displayTitle` is absent in some search results (~10% of notes). Schema marks it nullable. Verify reports DRIFT due to fingerprint mismatch from this inconsistency.
- **User profile ops may require login**: getUserProfile, getUserNotes, getUserCollections, getUserLiked navigate to user profile pages which may redirect to login. Also subject to CAPTCHA (`verifyType=124`) under rapid access. Rate-limit based — resolve by logging in at xiaohongshu.com in the browser, or waiting.
- **Vue reactive wrappers**: State values may be plain objects or Vue refs depending on hydration timing. Adapter handles both via `?._rawValue ?? val` pattern.
- **xsecToken**: Note detail URLs require a `xsec_token` parameter for reliable access. Token comes from search results or explore feed.
- **Collections/liked privacy**: getUserCollections and getUserLiked return empty arrays if the user has set these to private.
- **Related notes availability**: getRelatedNotes may return empty if the recommend API doesn't fire or SSR state doesn't include related data.
- **Comment selector fragility**: commentNote relies on DOM selectors for the comment input and submit button, which may change with site updates.
- **Write ops require login**: likeNote, bookmarkNote, followUser, commentNote all need an active `web_session` cookie. Without login, clicks fail silently or redirect.
