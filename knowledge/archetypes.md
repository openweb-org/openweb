# E-commerce Archetypes

## Next.js SSR (e.g., Walmart)
- Data in `<script id="__NEXT_DATA__">` JSON blob
- Use `ssr_next_data` extraction with `node` transport (no browser needed)
- Path parameter drills into the JSON structure

## JSON API + Bot Detection (e.g., Best Buy)
- Separate JSON API endpoints (suggest, priceBlocks, etc.)
- `page` transport required (Akamai/PerimeterX bot detection)
- No extraction needed — APIs return JSON directly

## Traditional SSR / No JSON APIs (e.g., Amazon)
- Data rendered directly in HTML DOM — no `__NEXT_DATA__`, no public JSON search/product APIs
- Amazon uses `data-a-state` attributes for embedded JSON fragments, but the main data (search results, product details, reviews) is only in the HTML
- Use `page_global_data` extraction with JavaScript that queries DOM selectors
- `page` transport required (heavy bot detection)
- Amazon has `data.amazon.com/api/marketplaces/{id}/products/{asin}` for individual product data, but this doesn't cover search or reviews
- Extraction requires the browser to already be on the correct page URL — the runtime finds a page by origin match, it does NOT navigate
