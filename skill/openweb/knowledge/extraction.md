# Extraction Patterns

How to extract structured data from web responses. Each pattern: technique, detection signals, transport, and gotchas.

## Decision Flow

```text
Is data in an API response (XHR/fetch)?
  +- Yes — you can call it directly       -> use the API (REST/GraphQL) <- preferred
  +- Yes — but it only fires on page load -> extraction.type: response_capture
  +- No  -> Is data in initial HTML?
       +- __NEXT_DATA__ present -> ssr_next_data
       +- __NUXT__ present -> page_global_data (expression: window.__NUXT__)
       +- <script type="application/ld+json"> -> script_json (+ type_filter; strip_comments if wrapped)
       +- window.VAR = {...} -> page_global_data
       +- Data in DOM elements only -> html_selector (trivial) or page_global_data (nested / per-field logic)
       +- Data requires interaction -> CustomRunner (last resort)
```

All browser-backed extraction inherits PagePlan (`entry_url` / `ready` / `warm` / `nav_timeout_ms`) from the server or operation — you no longer hand-roll `page.goto` / `waitForSelector` in an adapter.

## ssr_next_data

Server-rendered Next.js pages embed JSON in a `<script id="__NEXT_DATA__">` tag.

- **Detection:** `<script id="__NEXT_DATA__" type="application/json">` in HTML, `/_next/` asset paths
- **Transport:** node (fetch HTML, parse) or page (query DOM)
- **Example:** `JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps`
- **Gotcha:** Some Next.js sites use client-side fetching -- `__NEXT_DATA__` exists but contains only a skeleton. Verify the data you need is actually in `pageProps`.

## __NUXT__

Nuxt.js equivalent. Data embedded as JS assignment on `window.__NUXT__`.

- **Detection:** `window.__NUXT__=` or `window.__NUXT_DATA__=` in page source, `/_nuxt/` asset paths
- **Transport:** page (need JS execution to access `window.__NUXT__`)
- **Example:** `window.__NUXT__.data[0].items`
- **Gotcha:** Nuxt 3 uses `__NUXT_DATA__` with a different serialization (payload array). Parse according to Nuxt version.

## html_selector

Data lives in the DOM as rendered HTML -- no JSON payload available.

- **Detection:** No XHR/fetch calls for the data; data is visible in HTML but not in any JSON response
- **Transport:** page (need DOM access)
- **Example:** `[...document.querySelectorAll('.product-card')].map(el => ({ title: el.querySelector('.title').textContent.trim(), price: el.querySelector('.price').textContent.trim() }))`
- **Gotcha:** Fragile -- CSS class names change. Prefer JSON-based patterns when available.

## page_global

Data assigned to a global variable by inline JavaScript.

- **Detection:** `window.` assignments in inline `<script>` tags with structured data
- **Transport:** page (need JS context for window access)
- **Example:** `window.__INITIAL_STATE__.catalog`
- **Gotcha:** Variable names are site-specific. Document the exact variable in DOC.md.

## script_json

Structured data in `<script type="application/ld+json">` or similar non-executable script tag.

- **Detection:** `<script type="application/ld+json">`, `<script type="application/json" data-*>`
- **Transport:** node (parse HTML) or page (query DOM)
- **Example:** `JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)`
- **Gotcha:** Multiple `ld+json` blocks per page -- use `type_filter: <Type>` on the primitive to pick the right block by `@type` (handles string or string[]). Use `multi: true` if you need all blocks. Use `strip_comments: true` for `<!-- -->`-wrapped inline JSON (Yelp-style). No adapter needed.

## response_capture

The data you need arrives in a network response fired during page load — triggered by client-side JS, not by a call you can make directly.

- **Detection:** DevTools shows the request/response, but the URL requires cookies/headers only the page can produce, or the payload is only well-formed in that flow
- **Transport:** page (inherits PagePlan; always fresh navigation — no page reuse)
- **Example:**
  ```yaml
  extraction:
    type: response_capture
    page_url: /flights/search
    match_url: "*/api/search/flights*"
    unwrap: data.results
  ```
- **Gotcha:** Only the first matching response is returned. Tighten `match_url` if two responses share a substring. Progressive / best-of-N / multi-response capture still belongs in a CustomRunner.

## CustomRunner (last resort)

Custom JS in the browser page context when no spec primitive fits — signing, module-system walks, binary protocols, dynamic query-id scraping.

- **When to use:** After spec primitives (`response_capture`, `script_json`, `page_global_data`, `html_selector`) have been ruled out
- **Transport:** CustomRunner with `run(ctx: PreparedContext)`; PagePlan + auth/CSRF/signing resolved by the runtime before `run`
- **Gotcha:** Slowest pattern and fragile. Never add `page.goto` / `page.on('response')` / `__NEXT_DATA__` parsing here — those have shared primitives now (see the `scripts/adapter-pattern-report.ts` guardrail).

## LD+JSON Structured Data

Hotel/travel and e-commerce sites often embed structured data using schema.org vocabularies.

- **When to use:** Detail pages for entities with schema.org types -- hotels, products, restaurants, events
- **Detection:** `<script type="application/ld+json">` with `@type` field matching a known schema.org type
- **Stability:** More stable than DOM extraction -- LD+JSON is maintained for SEO and changes less frequently than CSS classes or data-testid attributes
- **Action:** Parse all LD+JSON blocks, filter by `@type`, extract fields. Include a DOM fallback for resilience.
- **Examples:** e.g. hotel/travel sites often embed `@type: "Hotel"` or `@type: "ItemList"`, e-commerce sites embed `@type: "Product"`

## data-testid DOM Extraction

Many modern SPAs use `data-testid` attributes for test automation. More stable than CSS classes, less stable than LD+JSON.

- **When to use:** Search result lists, review sections, room/pricing tables, flight cards -- repeated UI components
- **Detection:** Elements with `data-testid="property-card"`, `data-testid="searchresults_card"`, etc.
- **Stability:** Semantic (test-oriented) rather than visual (style-oriented) selectors
- **Action:** Enumerate `data-testid` values to discover extraction targets
- **Examples:** e.g. travel sites (`data-testid="property-card"` for search results, `data-testid="review-score-component"` for reviews)

## General Principles

1. **Prefer API over extraction** -- if the site makes an API call, use the API endpoint directly
2. **Prefer JSON over DOM** -- `ssr_next_data` > `html_selector` for stability
3. **Parameterized extraction URLs** -- the extraction executor substitutes path parameters (e.g., `/dp/{asin}`) and navigates to the resolved URL before evaluating. For simple cases, inline extraction with `page_url` + path params works without an adapter. Use adapters only for complex multi-step navigation, dynamic waits, or DOM interaction beyond a single `page.evaluate()` expression.
4. **Document the pattern in DOC.md** -- name the pattern and the specific selector/variable
5. **Test with `openweb verify`** -- extraction patterns are fragile; verify catches drift early
6. **Auto-compile noise for SSR-heavy sites** -- sites with no JSON API generate mostly tracking/logging ops from auto-compile. Core operations need manual adapter curation. Use auto-compile to discover ancillary APIs (e.g., autocomplete) but plan for adapter-based extraction upfront.
