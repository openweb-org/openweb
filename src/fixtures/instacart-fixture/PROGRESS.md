# Instacart Fixture — Progress

## 2026-03-24: Initial discovery and fixture creation

**What changed:**
- Created instacart-fixture with 10 operations: searchProducts, getProductDetail, getProductRatings, getProductNutrition, getNearbyStores, getDeliveryWindows, getStoreCategories, getStoreInfo, getCategoryProducts, getRecipesByProduct
- Built L3 adapter (`instacart-graphql.ts`) — uses Apollo persisted queries (GET with sha256 hashes) + page navigation for search/detail
- Added test cases for key operations

**Why:**
- Instacart uses Apollo Client persisted queries — full query strings rejected (`PersistedQueryNotSupported`)
- All GraphQL is GET (not POST) with `operationName`, `variables`, `extensions` as URL params
- Search results are SSR-hydrated (no direct search-by-keyword GraphQL query) — adapter uses page navigation + Items response interception
- Category browsing is two-step: CollectionProductsWithFeaturedProducts returns item IDs, then Items query hydrates with prices

**Discovery notes:**
- Capture tool connected to wrong tab initially (pages()[0]) — had to close existing tab, start capture, then open new tab
- Instacart has ~100+ GraphQL operations per page load, most are UI/config/analytics — only ~15 are user-data operations
- Price data deeply nested: `item.price.viewSection.itemCard.priceString` — adapter normalizes to flat structure
- Ratings use 0-100 internal scale (100 = 5 stars, 80 = 4 stars, etc.)
- `GetProductReviews` operation exists but doesn't fire reliably on product pages — excluded from initial fixture
- `retailerInventorySessionToken` is dynamic per-session, needed for some operations (categories, recipes)

**Verification:** Operations verified against live API. `pnpm build` exits 0.
