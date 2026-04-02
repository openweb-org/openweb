## 2026-04-01: Rediscovery — 3 core operations

**What changed:**
- Rebuilt package from scratch with 3 operations: searchProducts, getStoreProducts, getNearbyStores
- Verified persisted query hashes still valid from prior package
- Added new getStoreProducts operation (replaces old getCategoryProducts with auto-shopId resolution)
- Added abort controller timeouts to GraphQL fetch calls

**Why:**
- Prior package deleted; rediscovery requested with focused 3-operation scope
- Hashes confirmed via fresh capture (2026-04-01)

**Verification:** adapter-verified, runtime exec pending
