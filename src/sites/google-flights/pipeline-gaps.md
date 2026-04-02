# Google Flights — Pipeline Gaps

## Status: 5/5 PASS (2026-04-02)

All operations verified and passing.

## Fixed Issues

### Adapter init() failure (was: 0/5 PASS)
- **Root cause**: `init()` checked `url.includes('google.com/travel/flights')` but `autoNavigate` navigates to `google.com/` (server origin). Init always returned false.
- **Fix**: Relaxed `init()` to `url.includes('google.com')` (matches google-maps pattern).

### Adapter execute() never navigated to operation URL
- **Root cause**: `execute()` called DOM extraction functions directly without navigating the page to the correct path with params. The page was still at `google.com/` — no flight data to extract.
- **Fix**: Added `OP_PATHS` mapping (operationId → URL path). Execute now builds the full URL with `tfs`/`tfu` query params, navigates via `page.goto()`, and settles 3s before extraction.

### Missing examples (was: 3/5 ops had examples)
- Added `exploreDestinations.example.json` (no required params)
- Added `getPriceInsights.example.json` (reuses searchFlights tfs param)

## Remaining Gaps

- **`tfs` encoding is opaque** — protobuf-based, must be captured from real Google Flights URLs. Cannot be constructed programmatically.
- **DOM selectors are fragile** — `li.pIav2d` (searchFlights) is a minified class name. Google may change it at any time, causing DRIFT or empty results.
- **searchFlights regex sensitivity** — the time regex expects a specific format (`HH:MM AM/PM`); flights with overnight/next-day markers may be skipped.
- **getFlightBookingDetails** — the spec path `/travel/flights/booking` may redirect; extraction relies on text patterns that only appear when a specific itinerary is selected via `tfs`.
- **getPriceInsights** — price trend data, cheapest months, and popular airlines depend on Google showing these sections; some routes may not have insights.
- **exploreDestinations** — relies on `$`-delimited text and `Nonstop|stop` pattern; destinations without stop info or unusual price formats may be missed.
- **3s settle wait** — fixed delay after page load; slow connections or heavy pages may need more time. Not adaptive.
