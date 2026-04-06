# Reuters

## Overview
International news agency. News archetype — articles, topic feeds, search, financial market data via Arc Publishing (PageBuilder Fusion) API.

## Workflows

### Search news
1. `searchArticles(keyword)` → articles with title, description, canonical_url

### Browse a topic
1. `getTopicArticles(section_id)` → article list for `/world/`, `/business/`, `/technology/`, `/markets/`, `/science/`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search news by keyword | keyword | title, description, canonical_url, published_time | paginated (offset, size); entry point |
| getTopicArticles | browse section feed | section_id (e.g., /world/) | title, description, canonical_url, published_time | paginated (offset, size); entry point |

## Quick Start

```bash
# Search for articles about technology
openweb reuters exec searchArticles '{"keyword":"technology","size":5}'

# Browse world news
openweb reuters exec getTopicArticles '{"section_id":"/world/","size":10}'
```

---

## Site Internals

## API Architecture
Reuters uses Arc Publishing's PageBuilder Fusion API at `/pf/api/v3/content/fetch/{fetcherName}`. Each fetcher accepts a JSON-encoded `query` parameter containing the actual search/filter fields. The adapter constructs this JSON from user-friendly parameters.

Key fetchers:
- `articles-by-search-v2` — keyword search
- `articles-by-section-alias-or-id-v1` — section/topic feed

## Auth
No user authentication required. The API requires browser session cookies (set by initial page load) to authorize requests — direct Node.js HTTP calls return 401. The adapter uses `page.evaluate(fetch)` from the browser context.

## Transport
`page` — required because Reuters returns 401 for direct Node.js requests. The adapter makes API calls from within the browser tab using `page.evaluate(fetch(..., {credentials: 'same-origin'}))`.

## Known Issues
- **DataDome CAPTCHA required**: Reuters uses DataDome bot detection which now presents an interactive CAPTCHA for automated browsers. Headless Chrome cannot solve this. **Workaround**: set `{"browser":{"headless":false}}` in `$OPENWEB_HOME/config.json`, restart the browser (`openweb browser restart`), and solve the CAPTCHA in the visible Chrome window. Once solved, subsequent requests work until the browser restarts.
- **DataDome session lifetime**: DataDome cookies are tied to the browser fingerprint and session. If the managed browser restarts, you may need to solve the CAPTCHA again.
- **Tab stability**: The browser tab can crash after ~6-8 rapid API calls under DataDome pressure. Space out requests if making many sequential calls.
- **getTopicArticles verify flaky**: Occasionally fails with "page closed" during verify — the browser tab crashes under DataDome pressure. The operation works when called individually.
