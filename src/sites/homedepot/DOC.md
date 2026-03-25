# Home Depot Fixture

## Overview
Home Depot (homedepot.com) — largest US home improvement retailer. 10 operations covering product search, details, pricing, reviews, store info.

## Operations
| Operation | Intent | Notes |
|-----------|--------|-------|
| searchProducts | Search products by keyword | Product listing with filters |
| getProductDetail | Get product details | Full product info |
| getProductPricing | Get product pricing | Price, promotions |
| getProductReviews | Get product reviews | User reviews and ratings |
| getProductImages | Get product images | Product image gallery |
| getProductSpecs | Get product specifications | Technical specs |
| getDepartments | Get department listing | Category navigation |
| getStoreDetails | Get store details | Store info, hours, location |
| getStoreReviews | Get store reviews | Store customer reviews |
| getStoreFAQ | Get store FAQ | Frequently asked questions |

## Auth
- No auth needed for public data
- `requires_auth: false`
