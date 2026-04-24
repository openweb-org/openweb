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

## 2026-04-14 — Schema Drift Fix

**Context:** Verify failing on getProductPrice — `inStock` typed as `boolean` but adapter returns `null` when no data
**Changes:** Changed `inStock` type from `boolean` to `['boolean', 'null']` in getProductPrice response schema
**Verification:** 4/4 PASS
**Commit:** pending

## 2026-04-25 — Userflow QA: DOM selector + review field fixes

**Context:** Blind QA with 3 personas (数码发烧友/iPhone, 白领/机械键盘, 家长/儿童书桌). JD's search page now uses CSS-module hashed class names, breaking the prior attribute-based selectors.

**Bugs found & fixed:**

| # | Op | Field | Severity | Before | After | Root cause |
|---|-----|-------|----------|--------|-------|------------|
| 1 | searchProducts | price | P0 | null (0/30 iPhone, partial others) | 30/30 all personas | JD no longer uses `.p-price`; price is `<i>¥</i><span>N</span>` inside `_container_1agky` |
| 2 | searchProducts | shopName | P0 | null (0/30 all) | 30/30 all personas | JD no longer links to `mall.jd.com`/`shop.jd.com`; shop name is in `_limit_` span inside `_shopFloor_` |
| 3 | searchProducts | sales | P1 | null (many) or wrong format | 28-30/30 | Official stores show "100万+条评价" instead of "已售X万+"; added `条评价` fallback |
| 4 | getProductReviews | user | P1 | "" (empty string) | "奶***e" (anonymized) | API field is `userNickName`, not `userInfo.nickName` |
| 5 | getProductReviews | score | P1 | 0 (always) | 5 (correct 1-5) | API field is `commentScore`, not `score` |

**Changes:**
- `jd-global-api.ts` — searchProducts: rewrote price (¥ `<i>` sibling scan), shopName (CSS-module `_limit_`/`_shopFloor_`), sales (added `条评价` fallback)
- `jd-global-api.ts` — getProductReviews: `userInfo.nickName` → `userNickName`, `score` → `commentScore`
- `openapi.yaml` — updated `sales` description, added `user` anonymization note

**Verification:** All 4 ops × 3 personas pass. price 30/30, shopName 30/30, sales 28-30/30, reviews user+score populated.
