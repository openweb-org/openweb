# Extraction Patterns

How to extract structured data from web responses. Each pattern describes a technique, when to use it, detection signals, and an example.

## ssr_next_data

Server-rendered Next.js pages embed JSON in a `<script id="__NEXT_DATA__">` tag.

- **When to use:** site is built with Next.js and the data you need is in the initial page load
- **Detection signals:** `<script id="__NEXT_DATA__" type="application/json">` in HTML, `/_next/` asset paths
- **Example:**
  ```js
  // HTML contains: <script id="__NEXT_DATA__">{"props":{"pageProps":{"products":[...]}}}</script>
  const data = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
  const products = data.props.pageProps.products;
  ```
- **Transport:** node (fetch HTML, parse) or page (query DOM)
- **Gotcha:** some Next.js sites use client-side fetching — `__NEXT_DATA__` exists but contains only a skeleton. Check that the data you need is actually in `pageProps`.

## __NUXT__

Nuxt.js equivalent. Data is embedded as a JS assignment on `window.__NUXT__`.

- **When to use:** Nuxt.js site with SSR data in the initial payload
- **Detection signals:** `window.__NUXT__=` or `window.__NUXT_DATA__=` in page source, `/_nuxt/` asset paths
- **Example:**
  ```js
  // In page context:
  const data = window.__NUXT__;
  const items = data.data[0].items; // structure varies per page
  ```
- **Transport:** page (need JS execution to access `window.__NUXT__`)
- **Gotcha:** Nuxt 3 uses `__NUXT_DATA__` with a different serialization (payload array). Parse according to Nuxt version.

## html_selector

Data lives in the DOM as rendered HTML — no JSON payload available.

- **When to use:** traditional server-rendered pages, or when the API is locked down but the HTML is open
- **Detection signals:** no XHR/fetch calls for the data; data is visible in the HTML but not in any JSON response
- **Example:**
  ```js
  // In page context:
  const items = [...document.querySelectorAll('.product-card')].map(el => ({
    title: el.querySelector('.title').textContent.trim(),
    price: el.querySelector('.price').textContent.trim(),
  }));
  ```
- **Transport:** page (need DOM access)
- **Gotcha:** fragile — CSS class names change. Prefer a JSON-based pattern when available.

## page_global

Data is assigned to a global variable by inline JavaScript.

- **When to use:** site injects data as `window.SOME_VAR = {...}` (not a framework convention)
- **Detection signals:** `window.` assignments in inline `<script>` tags with structured data
- **Example:**
  ```js
  // HTML contains: <script>window.__INITIAL_STATE__ = {"user":{...},"catalog":[...]}</script>
  const catalog = window.__INITIAL_STATE__.catalog;
  ```
- **Transport:** page (need JS context for window access)
- **Gotcha:** variable names are site-specific. Document the exact variable in DOC.md.

## script_json

Structured data in a `<script type="application/ld+json">` or similar non-executable script tag.

- **When to use:** site embeds JSON-LD, config, or data blobs in typed script tags
- **Detection signals:** `<script type="application/ld+json">`, `<script type="application/json" data-*>`
- **Example:**
  ```js
  const ldJson = JSON.parse(
    document.querySelector('script[type="application/ld+json"]').textContent
  );
  // ldJson is a Schema.org Product, Recipe, etc.
  ```
- **Transport:** node (parse HTML) or page (query DOM)
- **Gotcha:** multiple `ld+json` blocks per page — filter by `@type`.

## page.evaluate Adapter (L3)

Run arbitrary JavaScript in the browser page context. Used when no simpler pattern works.

- **When to use:** data requires interaction (clicking, scrolling), complex JS state, or the site's own API client
- **Detection signals:** data only appears after user interaction, or data is computed client-side from multiple sources
- **Example:**
  ```js
  // adapter/searchProducts.js
  export default async function searchProducts(page, params) {
    await page.goto(`https://example.com/search?q=${params.query}`);
    await page.waitForSelector('.results');
    return page.evaluate(() => {
      return [...document.querySelectorAll('.result')].map(el => ({
        title: el.querySelector('h2').textContent,
        url: el.querySelector('a').href,
      }));
    });
  }
  ```
- **Transport:** adapter (L3) — full page control
- **Gotcha:** slowest pattern. Use only when simpler extraction fails. Fragile to UI changes.

## Decision Flow

```
Is data in an API response (XHR/fetch)?
  └─ Yes → use the API directly (REST/GraphQL patterns) ← preferred
  └─ No → Is data in initial HTML?
       ├─ __NEXT_DATA__ present → ssr_next_data
       ├─ __NUXT__ present → __NUXT__
       ├─ <script type="application/ld+json"> → script_json
       ├─ window.VAR = {...} → page_global
       ├─ Data in DOM elements only → html_selector
       └─ Data requires interaction → page.evaluate adapter
```

## General Principles

1. **Prefer API over extraction** — if the site makes an API call, use the API endpoint directly
2. **Prefer JSON over DOM** — `ssr_next_data` > `html_selector` for stability
3. **Document the pattern in DOC.md** — the Extraction section should name the pattern and the specific selector/variable
4. **Test with `openweb verify`** — extraction patterns are fragile; verify catches drift early
