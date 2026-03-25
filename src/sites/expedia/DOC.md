# Expedia

## Overview
Travel booking platform (OTA). Hotel search, property details, reviews, room pricing, photos, location info, FAQ, activities/tours, car rentals, and deals via browser DOM/LD+JSON extraction from expedia.com.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchHotels | search hotels by destination + dates | GET /Hotel-Search?destination={query} | lodging cards: name, price, rating, reviews |
| getHotelDetail | hotel info by URL slug | GET /{slug}.Hotel-Information | LD+JSON Hotel: name, starRating, rating, address, amenities, image |
| getHotelReviews | review summary and scores | internal (same page as detail) | overall score, review count, featured reviews |
| getHotelRooms | room types and pricing | internal (same page as detail) | room names, ratings, prices |
| getHotelPhotos | hotel images | internal (same page as detail) | gallery image URLs from trvl-media.com CDN |
| getHotelLocation | location and nearby POIs | internal (same page as detail) | address, POIs with distances |
| getHotelFAQ | frequently asked questions | internal (same page as detail) | from LD+JSON FAQPage or DOM |
| searchActivities | things to do/tours | GET /things-to-do/search?location={query} | activities: name, duration, rating, price |
| searchCarRentals | car rental search | GET /carsearch?locn={location} | car offers: name, passengers, price |
| getDeals | travel deals and discounts | GET /deals | deal cards: name, location, rating, price, originalPrice |

## API Architecture
- **LD+JSON ItemList** on hotel detail pages: contains Hotel objects with name, address, starRating, aggregateRating, amenityFeature
- **LD+JSON FAQPage** on hotel detail pages: mainEntity with Q&A pairs
- **No `__NEXT_DATA__`** — Expedia does not use Next.js SSR data props
- Hotel search uses **data-stid="lodging-card-responsive"** cards
- Car rentals use **data-stid="car-offer-card"** cards
- Images hosted on **images.trvl-media.com** CDN

## Auth
- No auth needed for public browsing and search
- `requires_auth: false`
- Member pricing shown but accessible without login

## Transport
- `transport: page` — browser-only access required
- PerimeterX bot detection blocks direct HTTP requests
- All operations use the `expedia-web` adapter for DOM/LD+JSON extraction

## Extraction
- **LD+JSON**: Hotel detail (Hotel schema in ItemList), FAQ (FAQPage)
- **DOM data-stid**: `lodging-card-responsive`, `content-hotel-title`, `content-hotel-address`, `content-hotel-reviewsummary`, `amenity-review-score`, `car-offer-card`, `content-item`
- **Text parsing**: Room listings, activity rankings, deal pricing

## Known Issues
- **Locale redirect** — browser may show Chinese locale; data-stid selectors work regardless of language
- **Dynamic pricing** — prices change based on dates, currency, and member status
- **Flights broken** — direct flight search URLs may return error page; flights use complex SPA routing
- **Activities text parsing** — ranked list uses "第 N 位" pattern in Chinese locale; may vary by locale
- **Room parsing fragile** — room sections don't have unique data-stid per card; text-based parsing required
- **First-page only** — no pagination via adapter for search results
