# Netflix

## Overview
Streaming video catalog — search movies/TV shows, view title details, browse genre categories, discover trending content. Read-only catalog access; requires authenticated Netflix session.

## Workflows

### Search and view title details
1. `searchTitles(query)` → title list with `id`
2. `getTitleDetail(titleId)` ← id from search → synopsis, cast, genres, seasons

### Browse categories and discover content
1. `getCategories` → genre rows from the browse page
2. `getTopPicks` → trending/popular titles with rank

### Explore a genre
1. `getCategories` → find genre row
2. `searchTitles(query)` → search within genre by keyword

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchTitles | search movies/TV shows | query | id, title, image | entry point; DOM extraction from search page |
| getTitleDetail | view title details | titleId ← searchTitles | title, synopsis, cast, genres, seasonCount, episodes | includes season/episode info for TV shows |
| getCategories | browse genre categories | — | categories (name, titleCount) | entry point; extracts visible genre rows |
| getTopPicks | trending/popular titles | — | section, items (rank, title, id) | entry point; first row from browse page |

## Quick Start

```bash
# Start browser with Netflix session
openweb browser start

# Search for titles
openweb netflix exec searchTitles '{"query": "stranger things"}'

# Get title details (use ID from search)
openweb netflix exec getTitleDetail '{"titleId": "80057281"}'

# Browse genre categories
openweb netflix exec getCategories '{}'

# Get trending/popular titles
openweb netflix exec getTopPicks '{}'
```

---

## Site Internals

## API Architecture
Netflix's web app is a React SPA. The internal Shakti/Falkor API (`/api/shakti/`)
uses per-request path-based routing with deployment-scoped build identifiers and
encrypted payloads. These APIs change across deployments and include request signing
that makes direct replay infeasible. All operations use DOM extraction from the
authenticated web app instead.

## Auth
- Auth type: `cookie_session` — Netflix session cookies (`NetflixId`, `SecureNetflixId`, `profilesGate`)
- All operations require an authenticated session — unauthenticated requests redirect to `/login`
- No CSRF token required for read operations
- Cookies are extracted from the browser automatically
- Session must have a profile selected (past the profile gate)

## Transport
- `page` transport required — Netflix uses heavy client-side rendering and custom bot detection
- All operations navigate to the appropriate page and extract data from the rendered DOM
- Requires `openweb browser start` before use
- Internal Shakti API uses per-deployment signing — not suitable for direct replay

## Known Issues
- **Auth required**: All operations need an active Netflix subscription and logged-in browser session
- **DOM selectors fragile**: Netflix's React UI changes frequently across A/B tests and deployments; selectors may need periodic updates
- **Profile gate**: Browser session must have passed the profile selection screen
- **DRM content**: Video streams are DRM-protected; this package accesses catalog metadata only
- **Rate limiting**: Netflix may throttle or block rapid automated navigation
- **Lazy loading**: Browse page loads content rows on scroll; `getCategories` captures only initially visible + one scroll worth of rows
- **Internal API signing**: The Shakti/Falkor API uses per-request signing tied to deployment builds, making direct API replay impractical; adapter uses DOM extraction instead
- **Search results**: Search page may show different layouts (grid vs rows) depending on A/B test group
