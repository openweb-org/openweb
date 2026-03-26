# Hacker News

## Overview
Hacker News — tech news aggregator by Y Combinator. Pure server-rendered HTML, no JSON API.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTopStories | browse top stories | GET /news | html_selector, title/score/author/age |
| getNewestStories | browse newest stories | GET /newest | html_selector, same fields |
| getBestStories | browse highest-voted stories | GET /best | html_selector, same fields |
| getAskStories | browse Ask HN posts | GET /ask | html_selector, same fields |
| getShowStories | browse Show HN posts | GET /show | html_selector, same fields |
| getJobPostings | browse job postings | GET /jobs | html_selector, title/age only (no score/author) |
| getFrontPageStories | browse time-based front page | GET /front | html_selector, same as top stories |
| getStoryDetail | view story + comments | adapter /item?id=X | navigates to item page, extracts metadata + full comment tree |
| getStoryComments | get comment thread | adapter /item?id=X | navigates to item page, returns comments with nesting level |
| getUserProfile | view user profile | adapter /user?id=X | navigates to user page, extracts username/karma/created/about |

## API Architecture
- No JSON API used by the web frontend — all data is in server-rendered HTML
- Single server: `news.ycombinator.com`
- Feed pages share identical DOM structure (`.athing` rows with `.titleline`, `.score`, `.hnuser`, `.age`)
- Item detail pages have story header + `.comtr` comment rows with indent via `.ind img[width]`
- User pages use plain `<table>` with label/value rows (no CSS classes for fields)

## Auth
- None required for all read operations
- Upvote requires login (not implemented — write ops deferred)

## Transport
- `node` — server-level transport declaration
- Feed operations: `html_selector` extraction on pre-loaded browser tabs
- Detail/profile operations: adapter navigates to target page via `page.goto()`

## Extraction
- **Feed pages (7 ops):** `html_selector` with CSS selectors — `.titleline > a`, `.score`, `.hnuser`, `.age a`
- **Story detail/comments (2 ops):** adapter with `page.evaluate()` — extracts story header + comment tree with nesting
- **User profile (1 op):** adapter with `page.evaluate()` — parses `table table tr` label/value rows

## Known Issues
- Feed html_selector operations require the specific page to be open in a browser tab (page_url matching)
- Adapter operations (detail, comments, profile) navigate automatically given an ID parameter
- Last story on some feed pages may have null score/author (ad or announcement row)
- HN has no bot detection — DOM extraction is reliable
