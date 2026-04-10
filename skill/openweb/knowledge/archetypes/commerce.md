# Commerce, Travel & Food

> Archetypes are heuristic starting points, not limiting checklists.

Transaction-oriented sites where users browse, compare, and purchase goods or services.

- **E-commerce** — product search, detail, cart, checkout: Walmart, Best Buy, eBay
- **Travel** — flights, hotels, listings, bookings: Airbnb, Booking.com, Expedia, Google Flights
- **Food Delivery** — restaurants, menus, orders: DoorDash, Instacart, Starbucks
- **Job Boards** — job search, company reviews, salaries: Indeed, LinkedIn Jobs, Glassdoor, Boss Zhipin

## Expected Operations

**E-commerce:**
- Read: search products, product detail (by ID), product reviews (paginated), price comparison
- Write (reversible pairs):
  - addToCart / removeFromCart
  - updateCartQuantity (set to 0 = remove)
  - saveItem (wishlist) / unsaveItem
- Read: view cart
- Transact (deny by default): checkout, placeOrder

**Travel:**
- Read: search listings (paginated), listing detail (by ID), price/availability, reviews
- Write (reversible pairs):
  - saveProperty (wishlist) / unsaveProperty
- Transact (deny by default): book/reserve

**Food Delivery:**
- Read: search restaurants (paginated), restaurant menu (by ID), delivery estimate
- Write (reversible pairs):
  - addToCart / removeFromCart
- Transact (deny by default): placeOrder

**Job Boards:**
- Read: search jobs, job detail, company profile, salary data, reviews
- Write (reversible pairs):
  - saveJob / unsaveJob

## Typical Profile

| Aspect | E-commerce | Travel | Food Delivery |
|--------|-----------|--------|---------------|
| Auth | cookie_session + CSRF | cookie_session | cookie_session |
| Transport | node (SSR) or page | node or page | node or page |
| Extraction | ssr_next_data, html_selector | varies (SSR, API, adapter) | API or SSR |
| Bot detection | heavy (PerimeterX, Akamai, DataDome) | moderate to heavy | moderate |
| GraphQL | rare | rare | common (persisted queries) |

## Notable Patterns

- **Amazon:** Akamai Bot Manager blocks all node HTTP. Adapter transport with DOM extraction required. No JSON-LD on product pages. Deals API (`/d2b/api/v1/products/search`) is the only public JSON API.
- **Booking.com:** LD+JSON Hotel schema on detail pages, data-testid DOM structure, flights on separate subdomain (flights.booking.com), no auth needed for public search.
- **Walmart:** ssr_next_data extraction, PerimeterX blocks CDP browser.
- **Best Buy:** Akamai blocks all direct HTTP. Three internal APIs via same-origin fetch only.
- **Google Flights:** adapter-only, protobuf-encoded search params, internal RPC calls.
- **Instacart:** GraphQL persisted queries.

## Curation Checklist

**E-commerce:**
- [ ] Search returns structured product data (title, price, image -- not HTML)
- [ ] Price fields use consistent format (check flat vs nested pricing)
- [ ] SSR extraction path verified (e.g., `__NEXT_DATA__` actually contains product data)
- [ ] addToCart / removeFromCart pair both work
- [ ] Cart/checkout ops gated: `write` for cart, `transact` for checkout
- [ ] Bot detection documented in DOC.md Known Issues

**Travel:**
- [ ] Search params map to user intent (location, dates, guests)
- [ ] Price/availability data is real-time (not cached/stale)
- [ ] saveProperty / unsaveProperty pair both work (if supported)
- [ ] Booking ops gated with `transact` permission
- [ ] Multi-step flows documented (search -> select -> book)

**Food Delivery:**
- [ ] Restaurant search is location-aware (lat/lng or zip)
- [ ] Menu items include prices and availability
- [ ] addToCart / removeFromCart pair both work
- [ ] Order placement gated with `transact` permission
- [ ] GraphQL persisted query hashes recorded if applicable
