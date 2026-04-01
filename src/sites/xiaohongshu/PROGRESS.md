# Xiaohongshu Fixture Progress

## 2026-03-31: Expand to 14 operations with full curation

**What changed:**
- Added 7 new operations: getHotSearch, getNoteComments, getUserCollections, getUserLiked, getRelatedNotes, followUser, commentNote
- getHotSearch: trending search terms from search page SSR state
- getNoteComments: standalone comment fetching via API interception (dedicated version of what was bundled in getNoteDetail)
- getUserCollections: user's bookmarked/collected notes from profile page SSR state
- getUserLiked: user's liked notes from profile page SSR state
- getRelatedNotes: related/recommended notes from note detail page (API interception + SSR fallback)
- followUser: click follow button on profile page (write op, idempotent)
- commentNote: type and submit comment on note detail page (write op)
- Added 5 new example files (10 total, covering all read ops)
- Full DOC.md rewrite per site-doc.md template: workflows, data flow annotations, quick start commands
- Enriched response schemas — all operations have detailed property types, no bare type:object

**Why:**
- Full curation pass to bring the site package to production quality with complete agent workflows

**Verification:** Pending — spec verify + doc verify + runtime verify

## 2026-03-26: Expand coverage from 3 to 7 operations

**What changed:**
- Added getUserNotes: extracts user's posted notes from SSR state `user.notes` (paginated array of pages, ~30 notes per page)
- Added getExploreFeed: extracts explore/discover feed from SSR state `feed.feeds` (~70 trending/recommended notes)
- Added likeNote: navigates to note detail, clicks like button via `.engage-bar-style .like-wrapper`, idempotent (skips if already liked)
- Added bookmarkNote: navigates to note detail, clicks collect button via `.engage-bar-style .collect-wrapper`, idempotent (skips if already bookmarked)
- All note list operations return consistent schema: `{noteId, xsecToken, type, displayTitle, user, likedCount, cover}`

**Why:**
- Expanding XHS coverage for agent workflows: browse explore feed, view user's posts, interact with notes

**Verification:**
- API-level: searchNotes PASS, getNoteDetail PASS, getExploreFeed PASS, getUserProfile CAPTCHA, getUserNotes CAPTCHA
- Content-level: explore feed returns ~74 notes with titles/authors/covers, user notes returns 30+ notes per page across 5 pages
- Like/bookmark manually tested via CDP: like triggers POST to `/note/like`, collect triggers POST to `/note/collect`, both toggle correctly

**Known issues:**
- getUserNotes and getUserProfile share the same CAPTCHA rate limit (both navigate to profile page)
- Like/bookmark require active login session (`web_session` cookie)

## 2026-03-23: Initial discovery and fixture creation

**What changed:**
- Discovered XHS API architecture: Vue 3 SSR with `__INITIAL_STATE__`, all REST APIs gated by anti-bot signatures
- Built L3 adapter with 3 operations: searchNotes, getNoteDetail (with comment interception), getUserProfile
- searchNotes: extracts from Vue SSR state, returns 40+ notes with title/author/likes/cover
- getNoteDetail: extracts note from SSR + intercepts comment API response (10+ comments per page)
- getUserProfile: extracts from SSR state — nickname, bio, follower counts, tags

**Why:**
- Expanding openweb coverage to Chinese social media platforms
- XHS is one of the largest Chinese lifestyle/social platforms

**Verification:**
- API-level: searchNotes PASS, getNoteDetail PASS, getUserProfile FAIL (CAPTCHA rate limit)
- Content-level: search returns 40 notes matching keyword, note detail returns full content with 6 tags and 10 comments with like counts, user profile returns complete profile when not rate-limited

**Known issues:**
- getUserProfile triggers CAPTCHA under rapid navigation. Works when browser session is fresh.
