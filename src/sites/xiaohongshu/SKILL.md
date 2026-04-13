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
