# eBay

## Overview
eBay — world's largest auction and marketplace platform. E-commerce archetype.

## Workflows

### Search and view item
1. `searchItems(keywords)` -> results with `itemId`
2. `getItemDetail(itemId)` -> full item info (title, price, bids, condition, shipping)

### Research a seller
1. `searchItems(keywords)` -> results with seller info
2. `getItemDetail(itemId)` -> seller card with `storeSlug`
3. `getSellerProfile(username)` -> feedback score, items sold, followers

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchItems | search listings by keyword | keywords | itemId, title, price, condition, image | entry point, paginated |
| getItemDetail | full item details | itemId <- searchItems | title, price, condition, seller, shipping, returns, brand, model, images | LD+JSON Product schema |
| getSellerProfile | seller reputation | username <- getItemDetail.seller.storeSlug | storeName, positiveFeedback, itemsSold, followers | uses /str/ URL |

## Quick Start

```bash
# Search for items
openweb ebay exec searchItems '{"keywords": "vintage watch"}'

# Get item details (use itemId from search results)
openweb ebay exec getItemDetail '{"itemId": "358422352053"}'

# Get seller profile (use storeSlug from item detail)
openweb ebay exec getSellerProfile '{"username": "freegeekportland"}'
```
