# Public Data APIs

> Archetypes are heuristic starting points, not limiting checklists.

Open APIs with no or minimal auth. Simplest to compile -- often single-endpoint services.

- **Weather / Data** — forecasts, geolocation, time: IP API, Exchange Rate, Sunrise Sunset, World Time
- **Prediction / Fun** — novelty single-endpoint services: Agify, Cat Facts, Chuck Norris, Advice Slip, Random Fox
- **Reference / Lookup** — structured databases with search: REST Countries, Open Library, DuckDuckGo, Dog CEO, Dictionary API
- **Crypto / Finance (public)** — market data, exchange rates: Exchange Rate
- **News** — articles, headlines, feeds: BBC, AP News, The Guardian, NewsAPI.org

## Expected Operations

**Weather / Data:** Current data (read, by location/params), forecast/historical (read, by range), lookup by coordinates or ID (read)

**Prediction / Fun:** Query/predict (read, single call), random result (read)

**Reference / Lookup:** Search/list (read, paginated or filtered), detail by ID or name (read), random entry (read, if supported)

**News:** Headlines/feed (read, paginated), article detail (read, by ID/URL), search articles (read)

## Typical Profile

| Aspect | All public APIs |
|--------|----------------|
| Auth | none (or API key as query/header param) |
| Transport | node |
| CSRF | none |
| Bot detection | none or light rate limiting |
| Extraction | direct JSON response |
| Pagination | offset, cursor, or none (single page) |

**Notable patterns:**
- Fun/prediction APIs: single operation, no pagination, no auth -- simplest possible site package
- Reference APIs: richer schemas with path parameters and varied response shapes
- News APIs: may use RSS or html_selector extraction if no JSON API

## Curation Checklist

- [ ] No auth configured (verify endpoints work without cookies/tokens)
- [ ] Response schema matches actual response (no drift from API updates)
- [ ] Rate limits documented if present
- [ ] Query parameters correctly typed (string vs number vs enum)
- [ ] Pagination tested if supported (cursor advances, offset increments)
- [ ] News: full article content available (not just headlines/summaries)
- [ ] News: HTML content cleaned if using html_selector extraction
