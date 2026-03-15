# Design Gap: DOM Parsing and SSR Cache Extraction

## Severity: HIGH

## Problem

Modern SSR frameworks (Next.js, Nuxt, Remix) embed structured data directly into
HTML as JSON in `<script>` tags. The data is already in the page — no API call is
made. Plugins extract this data via DOM parsing or regex, bypassing HTTP entirely.

Additionally, some sites use Apollo Client's in-memory cache (`__APOLLO_STATE__`)
which is populated from SSR and never refreshed via HTTP during the initial page load.

## Affected Sites

**SSR JSON in script tags:**
- Airbnb — `<script type="application/json" id="data-deferred-state-0">` with
  nested listing data
- Yelp — `window.yelp.react_root_props` extracted via regex from inline script
- TikTok — `__UNIVERSAL_DATA_FOR_REHYDRATION__` script tag with nested scope data
- Zillow — `__NEXT_DATA__` global (Next.js convention)
- Google Maps — `APP_INITIALIZATION_STATE` JSON in script tags
- Booking — SSR store with booking details and CSRF token

**Apollo Client cache:**
- Instacart — `__APOLLO_CLIENT__.cache.extract()` for user and location data
- Medium — `__APOLLO_STATE__` for viewer ID and session info

**HTML DOM parsing:**
- Hacker News — `querySelectorAll('tr.athing')` to parse story rows
- GitHub — `<script data-target="react-app.embeddedData">` for issue/PR data

## Why OpenWeb Can't Handle It

1. SSR data is embedded in the initial HTML response — HAR captures the HTML but
   the compiler doesn't parse it for structured data
2. The location and format of embedded data varies per framework and per site
3. DOM selectors (`querySelector`, regex patterns) are brittle and break when
   sites update their HTML structure
4. Apollo cache is an in-memory JavaScript object, not HTTP payload
5. OpenWeb's clustering stage expects distinct API requests — SSR data is just
   one big HTML response

## Potential Mitigations

- **SSR data extraction in recorder**: During Phase 1, after page load, run
  `page.evaluate()` to extract known SSR patterns (`__NEXT_DATA__`,
  `__NUXT__`, `__APOLLO_STATE__`, `window.__PRELOADED_STATE__`)
- **Framework detection**: Detect Next.js/Nuxt/Remix from HTML and automatically
  extract their standard data hydration patterns
- **HTML response analysis**: In Phase 2, parse HTML responses for `<script
  type="application/json">` tags and treat them as data endpoints
- **Accept fragility**: DOM parsing is inherently brittle; document this and
  recommend re-compilation when extraction breaks
