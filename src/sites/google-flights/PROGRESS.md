## 2026-04-02: Fix adapter — 5/5 PASS

**What changed:**
- Fixed `init()`: relaxed URL check from `/travel/flights` to `google.com` (autoNavigate only reaches server origin)
- Fixed `execute()`: added `OP_PATHS` mapping + `page.goto()` with tfs/tfu params + 3s settle wait
- Added missing examples for `exploreDestinations` and `getPriceInsights`
- Removed stale quarantine note from DOC.md
- Updated manifest fingerprints for all 5 ops

**Why:**
- Same systemic adapter-pattern bug as google-search/booking/redfin: runtime navigates to server origin, adapter must handle navigation to operation URL

**Verification:** `pnpm build && pnpm dev verify google-flights` — 5/5 PASS

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 3 adapter-based operations; note quarantine status

**Verification:** spec review only — no new capture or compilation

## 2026-03-26: Expand coverage from 3 to 5 ops

**What changed:**
- Added `exploreDestinations` operation — extracts destination cards from /travel/explore (destination, dates, flight price, stops, duration, hotel price)
- Added `getPriceInsights` operation — extracts monthly price trends, cheapest/most expensive months with price ranges, price trend predictions, popular airlines with starting prices
- Updated adapter to handle both /travel/flights and /travel/explore URLs
- Updated openapi.yaml with 2 new paths and response schemas
- Updated manifest.json operation count from 3 to 5
- Updated DOC.md with all 5 operations

**Why:**
- Expand beyond basic search to cover destination exploration and price intelligence

**Verification:** Manual adapter verification via CDP browser — exploreDestinations extracted 40 destinations with prices; getPriceInsights extracted cheapest/expensive months, price ranges, 6 popular airlines, and real-time price trend prediction
