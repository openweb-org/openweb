# Craigslist — Transport Upgrade (DOM → Node Fetch + HTML Parse)

## Final Architecture

- **Transport**: `node` — zero browser dependency
- **Data extraction**: Regex HTML parsing of server-rendered static pages
- **3 operations**: searchListings, getListing, getCategories (all read-only)
- **Zero DOM**: no CSS selectors, no `page.evaluate`, no browser navigation
- **No auth required**: all pages are public

## Discovery Journey

### Phase 1: Probe — Node Fetch Viability

Tested all 3 page types with plain `fetch()` from Node.js (no browser):

**Search page** (`/search/{category}`):
- HTTP 200, 423KB HTML, no bot detection
- Contains `cl-static-search-result` elements (server-rendered, no-JS fallback) — ~330 items
- Contains JSON-LD (`ld_searchpage_results`) with structured data — ~320 items
- JSON-LD has name, price, geo coordinates, but **no URL or postId**
- Static HTML has title, URL, price, location — URL contains postId

**Listing detail page** (`/{category}/d/{slug}/{id}.html`):
- HTTP 200, ~19KB HTML, no bot detection
- All fields present in static HTML: `#titletextonly`, `.price`, `#postingbody`, `#map` with data-latitude/data-longitude, `.postinginfos` with `<time>` elements, `#thumbs` with image links, `.attrgroup` with attribute values

**Homepage/categories** (`/`):
- HTTP 200, ~62KB HTML, no bot detection
- 161 `/search/` links with `data-cat` attributes
- Section headings in `<h3 class="ban">` tags
- 139 unique categories across 8 sections

**Probe verdict: all pages serve complete static HTML to Node.js fetch. No JavaScript execution needed. No bot detection. No auth. This is the ideal case for node transport.**

### Phase 2: Architecture Decision

```
node直连 ← CHOSEN (最优)
  ↑
page DOM extraction ← 当前 (craigslist-dom.ts)
```

**Why node + regex (not a parsing library):**
- Craigslist HTML is simple, predictable, well-structured
- No HTML parsing library in project dependencies (only ajv, patchright, ws, yaml, yargs)
- Adding cheerio/linkedom for 3 simple pages would violate KISS
- Regex parsing handles all fields reliably: titles, prices, body text, coordinates, timestamps, attributes, images, categories

**Rejected approaches:**
1. **JSON-LD only for search** — has structured data (name, price, geo) but lacks URLs and postIds. Would need to combine with HTML anyway. Simpler to just parse static HTML which has everything.
2. **Keep browser (page transport)** — Craigslist serves the same HTML to Node as to browsers. Browser adds ~5s overhead per operation for zero benefit.

### Phase 3: Implementation

**New adapter**: `craigslist.ts` — 140 lines (vs craigslist-dom.ts's 253 lines)

| Operation | Before (DOM) | After (Node) |
|-----------|-------------|-------------|
| searchListings | Browser → waitForSelector → 4-strategy DOM cascade | fetch HTML → regex `cl-static-search-result` |
| getListing | Browser → navigateTo → page.evaluate → DOM queries | fetch HTML → regex for each field |
| getCategories | Browser → navigateTo → page.evaluate → DOM queries | fetch HTML → regex `data-cat` + h3 section detection |

**Key implementation details:**
- `fetchHtml()` helper: single User-Agent header, checks for captcha/blocked responses
- `unescape()`: handles `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;` entities
- Search uses `cl-static-search-result` elements (always present in server HTML, no JS needed)
- Listing body: strips QR code block, converts `<br>` to newlines, strips remaining HTML tags
- Categories: detects section headings via `<h3>` lookback from `data-cat` matches
- Images: extracts 600x450 full-size URLs from `#thumbs` section

### Pitfalls Encountered

1. **Regex `<li` matching `<link`**: Initial category regex `/<(?:h3|li)[^>]*>` matched `<link` tags. Fixed by matching `data-cat` directly and using lookback for h3 detection.
2. **`&nbsp;` in category names**: "local&nbsp;news" — added `&nbsp;` to entity decoder.
3. **Fake example data in spec**: Default example values (`slug: "test-listing"`, `id: "7891234567"`) don't exist on Craigslist. Updated to real listing data.
4. **JSON-LD incomplete for search**: Has rich structured data but missing URLs/postIds. Static HTML results are more complete.

## Key Patterns Discovered

- **Craigslist serves identical HTML to Node and browsers** — no JavaScript execution, no anti-bot, no fingerprinting
- **`cl-static-search-result`** is the no-JS fallback that's always in the HTML source (vs `cl-search-result` which requires JS)
- **JSON-LD** (`ld_searchpage_results`) provides machine-readable structured data with Schema.org types (Product, Apartment, House) but lacks navigation URLs
- **`data-cat` attribute** on all category links is the stable identifier (not class names or text)
- **`#thumbs` section** has full-size image URLs (600x450) as `href` attributes on `<a>` tags
- **Timestamps** in `.postinginfos` use `<time datetime="ISO">` — clean, structured, no parsing needed

## Verification

**Result: 3/3 PASS** (2026-04-11)

| Operation | Status | Response Quality |
|-----------|--------|-----------------|
| searchListings | PASS | 289 results with title, URL, price, location, postId |
| getListing | PASS | Title, price, body, address, lat/lng, timestamps, attributes, images |
| getCategories | PASS | 139 categories across 8 sections |
