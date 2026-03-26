# Hacker News

## Overview
Hacker News front page — tech news aggregator. DOM-based extraction.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| getTopStories | top stories from front page | GET /news | html_selector extraction, returns title/score/author |

## API Architecture
- No JSON API used — extracts directly from server-rendered HTML DOM
- Single server: `news.ycombinator.com`

## Auth
- None required

## Transport
- `node` — fetches HTML, parses with selectors

## Extraction
- `html_selector` — CSS selectors for `.titleline > a` (title), `.score`, `.hnuser`
- Returns array of story objects with nullable fields
