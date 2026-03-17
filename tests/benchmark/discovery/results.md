# Discovery Benchmark Results

Date: 2026-03-17
Success: 9/20 (45%)
Target: ≥70%
Status: **BASELINE** (below target — see analysis)

## Failure Analysis

Failures fall into structural categories that require different solutions:

- **SPA timeout** (5 sites: coingecko, wikipedia, open-meteo, openlib, duckduckgo): Heavy JS apps where API calls happen after initial DOM + framework hydration. Need longer timeouts or SPA-aware wait strategies.
- **Non-JSON APIs** (2 sites: hackernews, cocktaildb): Server returns HTML or non-application/json content type, filtered out by `filterSamples`.
- **Cross-domain APIs** (2 sites: npm, stackoverflow): API calls go to different domains (e.g., `api.stackexchange.com`) not matching the target URL's domain.
- **No page-load traffic** (2 sites: exchangerate, boredapi): Landing page is static docs; API calls only happen via explicit user interaction.

## Results

| Site | URL | Ops | Success | Duration | Error |
|------|-----|-----|---------|----------|-------|
| catfact | https://catfact.ninja | 1 | ✓ | 11s |  |
| pokeapi | https://pokeapi.co | 4 | ✓ | 31s |  |
| randomuser | https://randomuser.me | 1 | ✓ | 28s |  |
| httpbin | https://httpbin.org | 1 | ✓ | 11s |  |
| dogceo | https://dog.ceo | 1 | ✓ | 23s |  |
| agify | https://agify.io | 1 | ✓ | 58s |  |
| genderize | https://genderize.io | 1 | ✓ | 59s |  |
| nationalize | https://nationalize.io | 1 | ✓ | 59s |  |
| publicholiday | https://date.nager.at | 4 | ✓ | 37s |  |
| hackernews | https://news.ycombinator.com | 0 | ✗ | 15s | no operations discovered |
| coingecko | https://www.coingecko.com | 0 | ✗ | 90s | timeout |
| wikipedia | https://en.wikipedia.org | 0 | ✗ | 90s | timeout |
| npm | https://www.npmjs.com | 0 | ✗ | 30s | no operations discovered |
| stackoverflow | https://stackoverflow.com | 0 | ✗ | 31s | no operations discovered |
| open-meteo | https://open-meteo.com | 0 | ✗ | 90s | timeout |
| cocktaildb | https://www.thecocktaildb.com | 0 | ✗ | 41s | no operations discovered |
| openlib | https://openlibrary.org | 0 | ✗ | 90s | timeout |
| duckduckgo | https://duckduckgo.com | 0 | ✗ | 90s | timeout |
| exchangerate | https://open.er-api.com | 0 | ✗ | 66s | no operations discovered |
| boredapi | https://bored-api.appbrewery.com | 0 | ✗ | 16s | no operations discovered |