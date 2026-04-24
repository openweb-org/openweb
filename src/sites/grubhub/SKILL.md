# Grubhub

## Overview
Grubhub is a food delivery platform (archetype: Food Delivery). Search restaurants, browse menus with prices, and check delivery time/fee estimates.

Responses are **adapter-trimmed** (camelCase, prices in USD dollars). Fields are clean and ready to use.

## Workflows

### Find restaurants and browse menu
1. `searchRestaurants(latitude, longitude, searchTerm)` → `restaurants[]` with `restaurantId`, `name`, ratings, fees
2. `getMenu(restaurantId)` → `categories[].items[]` with names and prices

### Check delivery details
1. `searchRestaurants(latitude, longitude)` → `restaurants[].restaurantId`
2. `getDeliveryEstimate(restaurantId)` → open/hours, delivery fee, pickup estimate, minimum order

## Operations

| Operation | Intent | Key Input | Top-level Shape | Notes |
|-----------|--------|-----------|-----------------|-------|
| searchRestaurants | find restaurants near a location | latitude, longitude, searchTerm? | `{ totalResults, restaurants[] }` | paginated via `pageNum`/`pageSize` |
| getMenu | browse restaurant menu | restaurantId ← searchRestaurants | `{ restaurantName, categories[] }` | items in `categories[].items[]` |
| getDeliveryEstimate | check delivery time and fees | restaurantId ← searchRestaurants | `{ open, openDelivery, deliveryFee, orderMinimum, … }` | money in USD; ranges in minutes |

## Field Reference

### searchRestaurants — `restaurants[]`
- `restaurantId` — unique ID (use with getMenu and getDeliveryEstimate)
- `name` — restaurant name
- `rating` — average rating (0-5 scale, null if too few)
- `ratingCount` — number of ratings
- `priceRating` — price tier (1-4, dollar signs)
- `cuisines` — array of cuisine strings
- `logo` — logo URL (nullable)
- `deliveryFee` — delivery fee in USD
- `deliveryEstimateMin` / `deliveryEstimateMax` — delivery time range in minutes (nullable)
- `address` — street address (nullable)
- `distance` — miles from delivery location (nullable)
- `totalResults` — total matching restaurants (top level)

### getMenu — `categories[]`
- `restaurantName` — restaurant name (top level)
- `categories[].name` — category name (e.g. "Appetizers", "Pizza")
- `categories[].items[].itemId` — menu item ID
- `categories[].items[].name` — item name
- `categories[].items[].description` — item description (nullable)
- `categories[].items[].price` — price in USD
- `categories[].items[].popular` — popular flag

### getDeliveryEstimate
- `restaurantId` — restaurant ID
- `open` / `openDelivery` / `openPickup` — availability flags
- `deliveryEstimateMin` / `deliveryEstimateMax` — delivery time range in minutes
- `pickupEstimateMin` / `pickupEstimateMax` — pickup time range in minutes (nullable)
- `deliveryFee` — delivery fee in USD
- `orderMinimum` — minimum order in USD
- `salesTax` — sales tax rate (e.g. 8.875 for 8.875%)

## Quick Start

```bash
# Search for pizza near Midtown Manhattan
openweb grubhub exec searchRestaurants '{"latitude": 40.7484, "longitude": -73.9857, "searchTerm": "pizza"}'

# Get a restaurant's menu
openweb grubhub exec getMenu '{"restaurantId": "64436"}'

# Check delivery estimate
openweb grubhub exec getDeliveryEstimate '{"restaurantId": "64436"}'
```
