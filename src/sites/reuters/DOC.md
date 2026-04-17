# Reuters

## Overview
International news agency. News archetype — search articles, browse topic feeds, read full articles, and get top/breaking news via Arc Publishing (PageBuilder Fusion) API.

## Workflows

### Search news
1. `searchArticles(keyword)` → articles with title, description, canonical_url

### Browse a topic
1. `getTopicArticles(section_id)` → article list for `/world/`, `/business/`, `/technology/`, `/markets/`, `/science/`

### Read full article
1. `searchArticles(keyword)` or `getTopicArticles(section_id)` → find `canonical_url`
2. `getArticleDetail(article_url)` → full article with title, body text, authors, section, word count

### Top news
1. `getTopNews()` → top/breaking news stories from the Reuters homepage feed

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchArticles | search news by keyword | keyword | title, description, canonical_url, published_time | entry point; paginated (offset, size) |
| getTopicArticles | browse section feed | section_id (e.g., /world/) | title, description, canonical_url, published_time | entry point; paginated (offset, size) |
| getArticleDetail | read full article | article_url ← searchArticles | title, body, authors, section, published_time, word_count | extracts from Fusion SSR or DOM fallback |
| getTopNews | top/breaking news | (none) | title, description, canonical_url, published_time | homepage section feed; optional size param |

## Quick Start

```bash
# Search for articles about technology
openweb reuters exec searchArticles '{"keyword":"technology","size":5}'

# Browse world news
openweb reuters exec getTopicArticles '{"section_id":"/world/","size":5}'

# Read a specific article (use canonical_url from search/topic results)
openweb reuters exec getArticleDetail '{"article_url":"/technology/cybersecurity/example-article-2025-04-01/"}'

# Get top/breaking news
openweb reuters exec getTopNews '{"size":10}'
```

### Common Section IDs

| Section | section_id |
|---------|------------|
| World | /world/ |
| Business | /business/ |
| Technology | /technology/ |
| Markets | /markets/ |
| Science | /science/ |
| Sports | /sports/ |
| Sustainability | /sustainability/ |

---

## Site Internals

### API Architecture
Reuters uses Arc Publishing's PageBuilder Fusion API at `/pf/api/v3/content/fetch/{fetcherName}`. Each fetcher accepts a JSON-encoded `query` parameter containing the actual search/filter fields. The adapter constructs this JSON from user-friendly parameters.

Key fetchers:
- `articles-by-search-v2` — keyword search
- `articles-by-section-alias-or-id-v1` — section/topic feed (also used for top news with section `/`)

Article detail uses page navigation + Fusion SSR extraction (`window.Fusion.globalContent`) with DOM fallback, since individual article content is embedded in the page's SSR data rather than exposed via a standalone content fetcher.

### Auth
No user authentication required. The API requires browser session cookies (set by initial page load) to authorize requests — direct Node.js HTTP calls return 401. The adapter uses `page.evaluate(fetch)` from the browser context.

### Transport
`page` — required because Reuters returns 401 for direct Node.js requests. The adapter's `init()` navigates to reuters.com if the browser tab is on a blank or unrelated page (also recognizes DataDome captcha redirects as valid state). API calls run from within the browser tab via the injected `pageFetch` helper (browser-origin fetch through patchright Page) instead of inline `page.evaluate(fetch(...))`. `getArticleDetail` navigates the page to the article URL and extracts content from the Fusion SSR data. Adapter retained because the DataDome-gated PF API needs browser-origin fetch and `page_global_data` blocks `fetch(`.

### Known Issues
- **DataDome CAPTCHA**: Reuters uses DataDome bot detection which presents an interactive CAPTCHA for automated browsers. Headless Chrome cannot solve this. **Workaround**: set `{"browser":{"headless":false}}` in `$OPENWEB_HOME/config.json`, restart the browser (`openweb browser restart`), and solve the CAPTCHA in the visible Chrome window. Once solved, subsequent requests work until the browser restarts.
- **DataDome session lifetime**: DataDome cookies are tied to the browser fingerprint and session. If the managed browser restarts, you may need to solve the CAPTCHA again.
- **Tab stability**: The browser tab can crash after ~6-8 rapid API calls under DataDome pressure. Space out requests if making many sequential calls.
- **getArticleDetail page navigation**: This operation navigates the browser tab to the article URL, which is slightly slower than API-only operations (~2-3s for page load + extraction). The Fusion SSR data extraction is preferred; DOM fallback is used if Fusion globalContent is not available.
