# Instacart

## Overview
Grocery delivery marketplace. Archetype: Grocery Delivery / Marketplace.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search groceries by keyword | GraphQL GET persisted + page navigation | autocomplete via CrossRetailerSearchAutosuggestions, products via Items interception |
| getProductDetail | get product details and pricing | page navigation + response interception | navigates to product URL, captures ItemDetailData + Items responses |
| getProductRatings | get product star ratings | GraphQL GET GetProductRatings | averageRating (5-star scale), distribution by star count |
| getProductNutrition | get nutritional facts | GraphQL GET ProductNutritionalInfo | calories, macros, serving size |
| getNearbyStores | find nearby stores with delivery ETAs | GraphQL GET GetAccurateRetailerEtas | returns retailerIds with ETA in minutes |
| getDeliveryWindows | get delivery time windows | GraphQL GET DeliveryHoursInfo | available hours per date per retailer |
| getStoreCategories | browse store departments | GraphQL GET DepartmentNavCollections | returns category tree with slugs for getCategoryProducts |
| getStoreInfo | get retailer metadata | GraphQL GET LandingRetailerMetas | store name, description, SEO info |
| getCategoryProducts | browse products in a department | GraphQL GET CollectionProductsWithFeaturedProducts + Items | two-step: get item IDs from collection, then fetch item details |
| getRecipesByProduct | get recipe suggestions | GraphQL GET RecipesByProductId | recipes related to a specific product |

## API Architecture
- **GraphQL with persisted queries** — all API traffic is GET with `operationName`, `variables`, and `extensions` (sha256Hash) as URL query params
- Full query strings rejected (`PersistedQueryNotSupported`) — only hashed queries accepted
- Apollo Client automatic persisted queries (APQ) format
- Hashes are deployment-specific and may change with Instacart releases
- Responses include `__typename` fields throughout (standard Apollo)
- Price data is deeply nested: `item.price.viewSection.itemCard.priceString`
- Ratings use 0-100 scale internally (divide by 20 for 5-star)

## Auth
- **cookie_session** — user location/zone set via cookies and IP geolocation
- Most read operations work without login (guest access)
- Auth cookies: `_instacart_session`, various tracking cookies
- Zone/location determined by: `postalCode`, `zoneId`, `coordinates` in API variables + `GeolocationFromIp` query

## Transport
- **page** (L3 adapter) — adapter uses `page.evaluate(fetch(..., { credentials: 'include' }))` for GraphQL queries
- Search and product detail use page navigation + response interception for reliability
- Any Instacart page must be open (`instacart.com/*`)

## Extraction
- Direct JSON from GraphQL responses (persisted queries return same structure as full queries)
- Item data normalized from deeply nested Instacart schema to flat structure
- Price extracted from `viewSection.itemCard.priceString`
- Availability from `availability.viewSection.stockLevelLabelString`

## Known Issues
- Persisted query hashes change with Instacart deployments — hashes may need periodic updates
- `retailerInventorySessionToken` is dynamic and session-specific — some operations need it but it's extracted from prior responses
- Search products uses page navigation which is slower than direct API calls
- Product IDs have format `items_{shopId}-{productId}` for Items query vs numeric for ratings/nutrition
- Guest access returns location-dependent results based on IP geolocation
