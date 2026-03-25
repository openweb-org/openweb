# Booking.com

## Overview
Hotel booking platform. Property search, details, reviews, room pricing, facilities, location info, and photos via browser DOM/LD+JSON extraction from booking.com.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProperties | search hotels in a destination | GET /searchresults.html?ss={query} | property cards: name, price, rating, distance |
| getPropertyDetail | property info by URL slug | GET /hotel/{country}/{slug}.html | LD+JSON Hotel: name, rating, reviewCount, address, description, image |
| getPropertyReviews | review summary and scores | internal (same page as detail) | overall score, 7 category subscores, featured review quotes |
| getPropertyRooms | room types and pricing | internal (same page as detail) | room names, beds, sizes, facilities, prices |
| getPropertyFacilities | amenities list | internal (same page as detail) | popular amenities + full facilities list |
| getPropertyLocation | location and nearby POIs | internal (same page as detail) | POIs with distances, location score, GPS coordinates |
| getPropertyPhotos | property images | internal (same page as detail) | gallery image URLs from bstatic.com CDN |
| getPropertyHouseRules | check-in/out and policies | internal (same page as detail) | check-in/out times, cancellation policy text |
| getPropertyFAQ | frequently asked questions | internal (same page as detail) | common questions about the property |
| searchAll | cross-category search | GET /searchresults.html?ss={query} | hotels, flights, car rentals |

## API Architecture
- **LD+JSON Hotel schema** on property detail pages: name, aggregateRating, description, address, image, priceRange
- **GraphQL at /dml/graphql** — used internally but not stable for direct access
- Search results use **data-testid** property cards with structured DOM
- Property details combine LD+JSON with DOM extraction for reviews, rooms, facilities, location
- Images hosted on **cf.bstatic.com** CDN

## Auth
- No auth needed for public browsing and search
- `requires_auth: false`

## Transport
- `transport: page` — browser-only access required
- Bot detection (likely PerimeterX) blocks direct HTTP requests
- Homepage redirects to login page in automated browsers — use direct URLs (/searchresults.html, /hotel/...)
- All operations use the `booking-web` adapter for DOM/LD+JSON extraction

## Extraction
- **LD+JSON**: Property detail (Hotel schema) — name, rating, address, description, image
- **DOM data-testid**: `property-card`, `title`, `price-and-discounted-price`, `review-score`, `review-subscore`, `property-most-popular-facilities-wrapper`, `poi-block-list`, `GalleryUnifiedDesktop-wrapper`, `HouseRules-wrapper`, `faq-accordion-left-card`
- **Room table**: `table.hprt-table` with `.hprt-roomtype-icon-link`, `.hprt-roomtype-bed`, `.hprt-roomtype-room-size`

## Known Issues
- **Homepage redirect** — navigating to booking.com homepage may redirect to login; use direct search URLs instead
- **Dynamic pricing** — prices change based on dates, currency, and user session
- **Listings are first page only** — no pagination via adapter
- **Review text partial** — featured reviews show excerpt; full text requires clicking "Read more"
- **Facilities section** — full facilities list may not load without scrolling to the section
- **Coordinates** — extracted from Google Maps static image URL; not always available
