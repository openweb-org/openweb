# Commerce, Travel & Food

> Archetypes are heuristic starting points, not limiting checklists.

## Classification

Transaction-oriented sites where users browse, compare, and purchase goods or services.

- **E-commerce** — product search, detail, cart, checkout: Walmart, Best Buy, eBay
- **Travel** — flights, hotels, listings, bookings: Airbnb, Booking.com, Expedia, Google Flights
- **Food Delivery** — restaurants, menus, orders: DoorDash, Instacart, Starbucks

## Expected Operations

### E-commerce
- Search products (read)
- Product detail (read, by ID)
- Add to cart (write)
- View cart (read)
- Checkout (transact — deny by default)

### Travel
- Search listings (read, paginated)
- Listing detail (read, by ID)
- Price / availability (read)
- Book / reserve (transact — deny by default)

### Food Delivery
- Search restaurants (read, paginated)
- Restaurant menu (read, by ID)
- Add to cart (write)
- Place order (transact — deny by default)

## Typical Profile

| Aspect | E-commerce | Travel | Food Delivery |
|--------|-----------|--------|---------------|
| Auth | cookie_session + CSRF | cookie_session | cookie_session |
| Transport | node (SSR) or page | node or page | node or page |
| Extraction | ssr_next_data, html_selector | varies (SSR, API, adapter) | API or SSR |
| Bot detection | heavy (PerimeterX, Akamai, DataDome) | moderate to heavy | moderate |
| GraphQL | rare | rare | common (persisted queries) |

**Notable patterns:**
- Amazon: Akamai Bot Manager blocks all node HTTP — adapter transport with DOM extraction required. No JSON-LD on product pages. Deals API (`/d2b/api/v1/products/search`) is the only public JSON API.
- Booking.com: LD+JSON Hotel schema on detail pages, data-testid DOM structure, flights on separate subdomain (flights.booking.com), no auth needed for public search
- Walmart: ssr_next_data extraction, PerimeterX blocks CDP browser
- Best Buy: Akamai blocks all direct HTTP — three internal APIs via same-origin fetch only
- Google Flights: adapter-only, protobuf-encoded search params, internal RPC calls
- Instacart: GraphQL persisted queries

> For extraction techniques see [extraction-patterns.md](../extraction-patterns.md). For bot detection see [bot-detection-patterns.md](../bot-detection-patterns.md).

## Curation Expectations

### E-commerce
- [ ] Search returns structured product data (title, price, image — not HTML)
- [ ] Price fields use consistent format (check flat vs nested pricing)
- [ ] SSR extraction path verified (e.g., `__NEXT_DATA__` actually contains product data)
- [ ] Cart/checkout ops gated: `write` for add-to-cart, `transact` for checkout
- [ ] Bot detection documented in DOC.md Known Issues

### Travel
- [ ] Search params map to user intent (location, dates, guests)
- [ ] Price/availability data is real-time (not cached/stale)
- [ ] Booking ops gated with `transact` permission
- [ ] Multi-step flows documented (search → select → book)

### Food Delivery
- [ ] Restaurant search is location-aware (lat/lng or zip)
- [ ] Menu items include prices and availability
- [ ] Order placement gated with `transact` permission
- [ ] GraphQL persisted query hashes recorded if applicable
