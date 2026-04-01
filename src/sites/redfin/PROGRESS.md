## 2026-04-01: Initial discovery — 3 operations

**What changed:**
- Created adapter-only package with 3 operations: searchHomes, getPropertyDetails, getMarketData
- JSON-LD extraction for search listings and property details
- DOM text extraction for housing market data

**Why:**
- Redfin is fully SSR-rendered — no JSON APIs. Standard capture → compile produces 0 usable operations.
- Adapter-only workflow per discover.md "Adapter-Only Sites"

**Verification:** adapter-verified via openweb verify
