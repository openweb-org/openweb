# Google Search

## Overview
Search engine (archetype: search). Google.com — autocomplete suggestions, organic web/image/news/video/shopping results, local business pack, knowledge panel, People Also Ask, and related searches via page DOM extraction.

## Workflows

### Research a topic with context
1. `searchSuggestions(q)` → refine query with autocomplete completions
2. `searchWeb(q)` → organic results with title, link, snippet
3. `getPeopleAlsoAsk(q)` → related questions for deeper exploration
4. `getRelatedSearches(q)` → follow-up query ideas

### Compare products
1. `searchSuggestions(q)` → refine product search terms
2. `searchShopping(q)` → price, merchant, reviews for products
3. `searchWeb(q)` → review articles and comparison pages

### Get entity information
1. `searchWeb(q)` → organic results for entity name
2. `getKnowledgePanel(q)` → structured entity data (title, subtitle, facts)

### Find local businesses
1. `searchLocal(q)` → name, rating, reviews, type, address from map pack
2. `searchWeb(q)` → supplementary organic results and review links

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchSuggestions | autocomplete completions | q, client=chrome | completion strings | entry point, node transport |
| searchWeb | organic web results | q | title, link, displayUrl, snippet | entry point, page extraction |
| searchImages | image results | q | sourceUrl, alt, width, height | page, navigate with udm=2 |
| searchNews | news articles | q | title, link, source, snippet, publishedAt | page, navigate with tbm=nws |
| searchVideos | video results | q | title, link, source, snippet | page, navigate with tbm=vid |
| searchShopping | product listings | q | title, price, originalPrice, merchant, reviewCount | page, navigate with udm=28 |
| getKnowledgePanel | entity facts | q (entity name) | title, subtitle, description, facts[] | page, entity queries only |
| getPeopleAlsoAsk | related questions | q | questions[], count | page, from PAA box |
| getRelatedSearches | follow-up queries | q | searches[], count | page, from page bottom |
| searchLocal | local businesses | q (location query) | name, rating, reviews, type, address | page, map pack results |

## Quick Start

```bash
# Autocomplete suggestions (node transport, no browser needed)
openweb google-search exec searchSuggestions '{"q": "best laptop", "client": "chrome"}'

# Web search results (requires browser with google.com open)
openweb google-search exec searchWeb '{"q": "best laptop 2025"}'

# Image search
openweb google-search exec searchImages '{"q": "aurora borealis"}'

# News search
openweb google-search exec searchNews '{"q": "technology"}'

# Shopping results
openweb google-search exec searchShopping '{"q": "wireless headphones"}'

# Knowledge panel for an entity
openweb google-search exec getKnowledgePanel '{"q": "Albert Einstein"}'

# People Also Ask
openweb google-search exec getPeopleAlsoAsk '{"q": "what is python"}'

# Related searches
openweb google-search exec getRelatedSearches '{"q": "machine learning"}'

# Local businesses
openweb google-search exec searchLocal '{"q": "coffee shops near times square"}'
```

---

## Site Internals

## API Architecture
- **Hybrid** — searchSuggestions uses a public JSON endpoint (`/complete/search`); all other operations use page-level DOM extraction
- Suggestions endpoint returns JSONP-style array when `client=chrome`: `["prefix", ["suggestion1", ...]]`
- All other endpoints share the same `/search` base path with different query params for verticals (udm=2 for images, tbm=nws for news, etc.)
- Knowledge panel is inline on the regular `/search` page

## Auth
- Auth type: `cookie_session` — browser session cookies are available via page transport
- No login required for public search; logged-in sessions may get personalized results
- `requires_auth: false` — all operations work without authentication

## Transport
- **Default: page** — most operations extract data from the rendered DOM
- **searchSuggestions: node** (override) — direct HTTP fetch, returns clean JSON
- Page transport requires the managed browser with a Google search page open; each search vertical needs navigation to its specific URL

## Extraction
- **searchSuggestions**: direct JSON response — tuple array `[query, [suggestions...]]`
- **searchWeb**: adapter — `div.tF2Cxc, div.Ww4FFb` containers, h3 for title, `a[href]` for link, `.VwiC3b` for snippet
- **searchImages**: adapter — `[data-lpage]` containers, `img.naturalWidth/naturalHeight` for dimensions
- **searchNews**: adapter — `div.SoaBEf` containers, `.n0jPhd` for title, `span[data-ts]` for Unix timestamp → ISO 8601
- **searchVideos**: adapter — `.Ww4FFb` containers, same structure as web results
- **searchShopping**: adapter — `.pla-unit` containers, `.VbBaOe` for price, `.bXPcId div` for title
- **getKnowledgePanel**: adapter — `[data-attrid="title"]`, `.rVusze` rows for facts
- **getPeopleAlsoAsk**: adapter — `.related-question-pair` rows, `.dnXCYb` for question text
- **getRelatedSearches**: adapter — `#botstuff .AJLUJb a` links at page bottom
- **searchLocal**: adapter — `[jscontroller="AtSb"] .VkpGBb` cards, `.rllt__details` for name/rating/type/address

## Known Issues
- **DOM selector fragility** — Google frequently A/B tests result layouts. Selectors use minified Closure Compiler class names that can change between builds. Monitor verify fingerprints.
- **Expected DRIFT on search results** — different results on every call. Schema validation passes; fingerprint hash changes.
- **Thumbnail dimensions may be 0** — `naturalWidth`/`naturalHeight` report 0 if images haven't loaded when extraction runs.
- **Regional/personalization variance** — results vary by IP geo, language, and browser profile state.
- **News/video snippets may be empty** — some results omit snippet text in the DOM.
- **Knowledge panel not always present** — only entity queries produce a panel. Non-entity queries return null fields.
- **Local pack requires location query** — queries without location intent (e.g. "python tutorial") won't have a map pack.
- **Shopping URL redirect** — `tbm=shop` redirected to `udm=28` by Google.
- **Verify requires per-tab navigation** — automated verify can only test one page-transport operation at a time.
