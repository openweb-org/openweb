# Site Archetypes

Patterns for different site categories and what to expect during discovery.

## Search Engines

**Expected operations**: search results, autocomplete/suggest, image/video search
**Common patterns**:
- Autocomplete is typically a clean JSON API accessible via `node` transport (`/complete/search`, `/ac/`, `/suggest`)
- Search results are SSR HTML — no JSON APIs. Require `page_global_data` extraction with DOM selectors
- Image search shares the same path as web search (differentiated by query params like `udm=2` or `tbm=isch`)
- DOM class names are obfuscated and may change with UI updates — use data attributes (`data-hveid`, `data-lpage`) when available as they tend to be more stable

**Google-specific**: not blocked for headless browsers (unlike Google Maps). Autocomplete `client=chrome` returns clean JSON; `client=gws-wiz` returns anti-XSSI prefixed JSON (`)]}'`).

## E-commerce

**Expected operations**: search products, product detail, pricing/availability
**Common patterns**:
- Next.js sites (Walmart, etc.) → `ssr_next_data` extraction via `node` transport
- Non-Next.js sites (Best Buy, etc.) → internal JSON APIs accessible via `page` (browser_fetch) transport
- Bot detection varies: Akamai (Best Buy), custom (Walmart allows node SSR)

## Social Media

**Expected operations**: feed/timeline, post detail, user profile, search
**Common patterns**:
- Require `cookie_session` auth
- CSRF tokens common (`cookie_to_header`)
- Pagination via cursor-based tokens

## Developer Tools

**Expected operations**: list items, get item, search
**Common patterns**:
- REST APIs with standard auth (token, OAuth)
- GitHub-style `link_header` pagination
- Path parameters for resource IDs

## Public APIs (no auth)

**Expected operations**: varies by domain
**Common patterns**:
- Direct `node` transport — no browser needed
- Simple JSON responses
- Rate limiting may apply but rarely blocks discovery

## Real Estate

**Expected operations**: search homes by location/filters, property detail, price estimate/valuation
**Common patterns**:
- Content is SSR-rendered — search results and property details baked into initial HTML, not fetched via separate API calls
- JSON-LD structured data (`application/ld+json`) is the richest extraction source — contains `SingleFamilyResidence` + `Product` pairs on search pages, `RealEstateListing` on detail pages
- Internal APIs (e.g., Redfin's `/stingray/api/*`) are minor supporting endpoints (feature flags, utilities, rentals) — not the main data source
- Automated valuation/estimate data is DOM-only (not in JSON-LD) — requires `page_global_data` extraction from the estimate section
- `page` transport required — all data comes from rendered pages
- Compiler's auto-filter removes all real estate API samples as "noise" because the real data is SSR — manual fixture creation required

**Redfin-specific**: Not blocked for headless browsers. Massive `window.g_*` globals are enum/constant mappings, not data. JSON-LD uses schema.org types. Estimate section has `data-rf-test-id="avm-section-expandable-preview"`.

## Food Delivery / Marketplace

**Expected operations**: search restaurants/stores, get store menu/detail, order history/tracking
**Common patterns**:
- GraphQL APIs — all traffic is POST with JSON body, compiler auto-skips POST mutations → requires L3 adapter
- Cookie session auth (`cookie_session`), user must log in via managed browser
- GraphQL gateway pattern: `/graphql/<operationName>?operation=<operationName>` with body `{ operationName, variables, query }`
- Search returns mixed results (stores + grocery items) — schema must allow nullable fields
- Responses can be very large (100KB+ for order history, 200KB+ for store menus)

**DoorDash-specific**: Auth cookies are `dd_session_id` and `ddweb_token`. Simplified GraphQL queries work — no persisted query hashes required.
