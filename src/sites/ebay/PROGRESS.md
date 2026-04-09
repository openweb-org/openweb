# eBay — Progress

## 2026-04-09: Initial site package

**What changed:**
- Added eBay as new site with 3 operations: searchItems, getItemDetail, getSellerProfile
- Adapter-based package using page transport with DOM/LD+JSON extraction
- All operations verified PASS

**Why:**
- eBay is a major e-commerce platform with no prior OpenWeb support

**Verification:** All 3 ops pass verify (searchItems, getItemDetail, getSellerProfile). Build passes.
