# Wikipedia

## Overview
Wikipedia — free encyclopedia. Reference archetype. Three APIs: MediaWiki Action API for search/metadata, REST v1 for summaries/feeds, Core REST for article source and history.

## Workflows

### Research a topic
1. `searchArticles(srsearch)` → pick result → `pageid`, `title`
2. `getPageSummary(title)` → extract, description, thumbnail
3. `getPageSource(title)` → full wikitext (if needed)

### Explore article graph
1. `getPageSummary(title)` → confirm topic → `title`
2. `getPageLinks(titles)` → outgoing links from article
3. `getPageBacklinks(bltitle)` → pages that cite this article
4. `getPageCategories(titles)` → article categories

### Discover content by date
1. `getOnThisDay(type, MM, DD)` → historical events with related pages
2. `getFeaturedContent(YYYY, MM, DD)` → featured article, most-read, picture of the day

### Compare across languages
1. `searchArticles(srsearch)` → find article → `title`
2. `getPageLanguageLinks(titles)` → available translations with language codes and localized titles

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search by keyword | srsearch | title, pageid, snippet, wordcount | entry point, paginated (sroffset) |
| getPageSummary | page summary | title ← searchArticles | extract, description, thumbnail, content_urls | REST v1 |
| getPageSource | full wikitext | title ← searchArticles | source, revision timestamp, license | large response |
| getPageMediaList | page media files | title ← searchArticles | file title, type, srcset URLs, captions | REST v1 |
| getRandomArticle | random summary | — | same as getPageSummary | entry point |
| getPageRevisions | edit history | title ← searchArticles | revision id, timestamp, user, comment, delta | paginated (older_than) |
| getPageCategories | page categories | titles ← searchArticles | category titles | Action API, paginated (clcontinue) |
| getPageLinks | outgoing links | titles ← searchArticles | linked page titles | Action API, paginated (plcontinue) |
| getPageBacklinks | incoming links | bltitle ← searchArticles | pageid, title of linking pages | Action API, paginated (blcontinue) |
| getPageLanguageLinks | translations | titles ← searchArticles | lang code, localized title | Action API, paginated (llcontinue) |
| getPageInfo | page metadata | titles ← searchArticles | pageid, lastrevid, length, content model | Action API |
| getPageExtract | plain text intro | titles ← searchArticles | extract text (length-controlled) | Action API, exsentences param |
| getOnThisDay | events on date | type, MM, DD | event text, year, related pages | entry point |
| getFeaturedContent | daily highlights | YYYY, MM, DD | featured article, most-read, image | entry point |

## Quick Start

```bash
# Search for articles
openweb wikipedia exec searchArticles '{"srsearch":"quantum computing","srlimit":5}'

# Get page summary with thumbnail
openweb wikipedia exec getPageSummary '{"title":"Albert_Einstein"}'

# Get plain text extract (3 sentences)
openweb wikipedia exec getPageExtract '{"titles":"Albert_Einstein","exsentences":3}'

# Get page categories
openweb wikipedia exec getPageCategories '{"titles":"Python_(programming_language)","cllimit":10}'

# Get historical events for July 20
openweb wikipedia exec getOnThisDay '{"type":"events","MM":"07","DD":"20"}'

# Get today's featured content
openweb wikipedia exec getFeaturedContent '{"YYYY":"2026","MM":"03","DD":"31"}'

# Get pages linking to an article
openweb wikipedia exec getPageBacklinks '{"bltitle":"World_Wide_Web","bllimit":10}'

# Get article revision history
openweb wikipedia exec getPageRevisions '{"title":"Albert_Einstein","limit":5}'
```

---

## Site Internals

## API Architecture
- Three distinct APIs on `en.wikipedia.org`:
  - **MediaWiki Action API** (`/w/api.php`) — search, categories, links, backlinks, langlinks, info, extracts. Uses `action=query` with `list=` or `prop=` params. All ops use `formatversion=2` for cleaner array-based responses.
  - **REST v1** (`/api/rest_v1/`) — clean resource-oriented endpoints for summaries, media lists, on-this-day, featured content, random articles.
  - **Core REST** (`/w/rest.php/v1/`) — article source, revision history.
- Action API ops share `/w/api.php` path, disambiguated by const `list` or `prop` params.
- All title parameters use underscores for spaces (e.g. `Albert_Einstein`).
- Action API pagination uses continuation tokens (`sroffset`, `clcontinue`, `plcontinue`, etc.) returned in the `continue` object.

## Auth
- Transport: `page` with `cookie_session`.
- No auth required for any read operations — all APIs are public.
- Cookie session enables logged-in features if available.

## Transport
- `page` — browser-based fetch for all operations.
- All operations return JSON directly (no SSR extraction needed).

## Known Issues
- `getPageRelated` (`/api/rest_v1/page/related/{title}`) returns 403 — excluded from spec.
- Action API search snippets contain HTML markup (`<span class="searchmatch">`).
- `getPageSource` returns full wikitext which can be very large for long articles.
- `getRandomArticle` returns a different article each call — verify shows DRIFT on fingerprint comparison.
