## 2026-04-01: Rediscovery — DOM extraction (4 ops)

**What changed:**
- Complete rewrite from prior h5st-signed API + login-required ops to pure DOM extraction
- 4 operations: searchProducts, getProductDetail, getProductReviews, getProductPrice
- No auth required — all data from public pages
- Replaced CSS class selectors with attribute-based selectors (`[data-sku]`, `[title]`) for resilience against CSS module hash changes

**Why:**
- Prior adapter required login for search/detail/reviews (api.m.jd.com returned 403 without cookies)
- h5st signing via PSign was fragile and domain-specific
- DOM extraction works without any authentication
- CSS module selectors from prior version broke on deployment

**Verification:** adapter-verified via openweb verify jd
**Commit:** pending
