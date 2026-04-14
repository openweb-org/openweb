# Grubhub

## Overview
Grubhub is a food delivery platform (archetype: Food Delivery). Search restaurants, browse menus with prices, and check delivery time/fee estimates.

## Workflows

### Find restaurants and browse menu
1. `searchRestaurants(latitude, longitude, searchTerm)` → `restaurantId`, name, rating, deliveryFee
2. `getMenu(restaurantId)` → categories with items and prices

### Check delivery details
1. `searchRestaurants(latitude, longitude)` → `restaurantId`, name, deliveryEstimate
2. `getDeliveryEstimate(restaurantId)` → delivery time, fee, order minimum

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchRestaurants | find restaurants near a location | latitude, longitude, searchTerm? | restaurantId, name, rating, deliveryFee, deliveryEstimate | entry point; paginated |
| getMenu | browse restaurant menu | restaurantId ← searchRestaurants | categories, items with prices | full menu with descriptions |
| getDeliveryEstimate | check delivery time and fees | restaurantId ← searchRestaurants | deliveryEstimateMin/Max, deliveryFee, orderMinimum | includes pickup estimates |

## Quick Start

```bash
# Search for pizza near Midtown Manhattan
openweb grubhub exec searchRestaurants '{"latitude": 40.7484, "longitude": -73.9857, "searchTerm": "pizza"}'

# Get a restaurant's menu
openweb grubhub exec getMenu '{"restaurantId": "64436"}'

# Check delivery estimate
openweb grubhub exec getDeliveryEstimate '{"restaurantId": "64436"}'
```
