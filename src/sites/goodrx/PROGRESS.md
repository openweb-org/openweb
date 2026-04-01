## 2026-04-01: Fresh rediscovery — 3 operations (searchDrugs, getDrugPrices, getPharmacies)

**What changed:**
- Rediscovered GoodRx from scratch with 3 target operations
- Adapter-only site: PerimeterX blocks all direct HTTP, data in DOM/JSON-LD
- searchDrugs: autocomplete via search input interaction
- getDrugPrices: DOM extraction from pharmacy price list items + JSON-LD Drug schema
- getPharmacies: DOM extraction of pharmacy links from pharmacy-near-me page

**Why:**
- Prior package (10 ops) deleted; rebuilding with focused scope

**Verification:** adapter-verified via openweb verify goodrx --browser
