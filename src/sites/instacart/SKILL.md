# Instacart

## Overview
Grocery delivery marketplace. Archetype: Food Delivery.

## Workflows

### Search groceries
1. `searchProducts(query)` → products with name, price, brand, availability

### Browse a store's catalog
1. `getStoreProducts(retailerSlug, slug)` → products in a department
   - `retailerSlug` is a known store slug (e.g. "costco", "sprouts", "publix")
   - `slug` is a category (e.g. "produce", "dairy", "snacks")

### Check delivery availability
1. `getNearbyStores(postalCode)` → stores with `retailerId`, delivery ETAs

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchProducts | search groceries by keyword | query | products (name, price, brand, availability) | entry point; returns autocomplete suggestions too |
| getStoreProducts | browse a store department | retailerSlug (known slug), slug (category) | products (name, price, brand), collection info | auto-resolves shopId; entry point |
| getNearbyStores | find stores with delivery ETAs | postalCode | stores (retailerId, etaMinutes, etaDisplay) | entry point; results depend on IP geolocation |

## Quick Start

```bash
# Search for groceries
openweb instacart exec searchProducts '{"query": "bananas", "limit": 5}'

# Browse Costco produce
openweb instacart exec getStoreProducts '{"retailerSlug": "costco", "slug": "produce", "first": 10}'

# Find nearby stores
openweb instacart exec getNearbyStores '{"postalCode": "90210"}'
```
