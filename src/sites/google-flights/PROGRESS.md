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
