# Public Data APIs

> Archetypes are heuristic starting points, not limiting checklists.

## Classification

Open APIs with no or minimal auth. Simplest to compile — often single-endpoint services.

- **Weather / Data** — forecasts, geolocation, time: Open-Meteo, IP API, Exchange Rate, Sunrise Sunset, World Time
- **Prediction / Fun** — novelty single-endpoint services: Agify, Genderize, Cat Facts, Chuck Norris, Advice Slip, Kanye Rest, Official Joke, Useless Facts, Random Fox, Bored API, Affirmations
- **Reference / Lookup** — structured databases with search: PokeAPI, REST Countries, Open Library, DuckDuckGo, Dog CEO, CocktailDB, Color API, Dictionary API, Public Holidays, Universities, Zippopotam, Random User
- **Crypto / Finance (public)** — market data, exchange rates: CoinGecko, Exchange Rate
- **News** — articles, headlines, feeds: BBC, AP News, The Guardian, NewsAPI.org

## Expected Operations

### Weather / Data
- Current data (read, by location or params)
- Forecast / historical (read, by range)
- Lookup by coordinates or ID (read)

### Prediction / Fun
- Query / predict (read, single call)
- Random result (read)

### Reference / Lookup
- Search / list (read, paginated or filtered)
- Detail by ID or name (read)
- Random entry (read, if supported)

### Crypto / Finance (public)
- Price query (read, by asset + currency)
- Market data / rankings (read, paginated)
- Exchange rates (read)
- Historical data (read, by range)

### News
- Headlines / feed (read, paginated)
- Article detail (read, by ID or URL)
- Search articles (read)

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
- Fun/prediction APIs: single operation, no pagination, no auth — simplest possible site package
- Reference APIs: richer schemas with path parameters and varied response shapes
- News APIs: may use RSS or html_selector extraction if no JSON API
- CoinGecko: no auth for basic endpoints, rate-limited for heavy use

## Curation Expectations

### All public APIs
- [ ] No auth configured (verify endpoints work without cookies/tokens)
- [ ] Response schema matches actual response (no drift from API updates)
- [ ] Rate limits documented if present
- [ ] Query parameters correctly typed (string vs number vs enum)
- [ ] Pagination tested if supported (cursor advances, offset increments)

### News (additional)
- [ ] Full article content available (not just headlines/summaries)
- [ ] HTML content cleaned if using html_selector extraction
- [ ] RSS feeds parsed if no JSON API available
