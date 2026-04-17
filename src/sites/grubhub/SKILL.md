# Grubhub

## Overview
Grubhub is a food delivery platform (archetype: Food Delivery). Search restaurants, browse menus with prices, and check delivery time/fee estimates.

Responses are the **raw Grubhub wire shape** (snake_case, prices in cents). Use the field mappings below when composing output — don't expect pretty names.

## Workflows

### Find restaurants and browse menu
1. `searchRestaurants(latitude, longitude, searchTerm)` → `results[]` with `restaurant_id`, `name`, ratings, fees
2. `getMenu(restaurantId)` → `menu_category_list[].menu_item_list[]` with names and prices

### Check delivery details
1. `searchRestaurants(latitude, longitude)` → `results[].restaurant_id`
2. `getDeliveryEstimate(restaurantId)` → open/hours, delivery fee, pickup estimate, minimum order

## Operations

| Operation | Intent | Key Input | Top-level Shape | Notes |
|-----------|--------|-----------|-----------------|-------|
| searchRestaurants | find restaurants near a location | latitude, longitude, searchTerm? | `{ results[], stats, facets }` | `stats.total_results` for count; paginated via `pageNum`/`pageSize` |
| getMenu | browse restaurant menu | restaurantId ← searchRestaurants | `{ restaurant_id, name, menu_category_list[] }` (unwrapped from `restaurant`) | items in `menu_category_list[].menu_item_list[]` |
| getDeliveryEstimate | check delivery time and fees | restaurantId ← searchRestaurants | `{ open, open_delivery, delivery_fee, order_minimum, delivery_estimate_range_v2, … }` (unwrapped from `restaurant_availability`) | money in cents; ranges in minutes |

## Field Mappings (raw → pretty)

### searchRestaurants — `results[]`
- `id` → `results[].restaurant_id`
- `name` → `results[].name`
- `rating` (0-5) → `results[].ratings.rating_bayesian10_point`
- `rating count` → `results[].ratings.rating_count`
- `price tier` (1-4) → `results[].price_rating`
- `cuisines` → `results[].cuisines` (array of strings)
- `logo URL` → `results[].logo`
- `delivery fee in USD` → `results[].delivery_fee.price / 100`
- `delivery min minutes` → `results[].delivery_estimate_range.start_time_minutes` (fallback: `results[].delivery_time_estimate_lower_bound`)
- `delivery max minutes` → `results[].delivery_estimate_range.end_time_minutes` (fallback: `results[].delivery_time_estimate_upper_bound`)
- `street address` → `results[].address.street_address`
- `distance (miles)` → `results[].distance_from_location` (string/number)
- `total matches` → `stats.total_results`

### getMenu (unwrapped `restaurant`)
- `restaurant name` → `.name`
- `categories` → `.menu_category_list[]`
- `category name` → `.menu_category_list[].name`
- `items` → `.menu_category_list[].menu_item_list[]`
- `item id` → `.menu_category_list[].menu_item_list[].id`
- `item name` → `.menu_category_list[].menu_item_list[].name`
- `item description` → `.menu_category_list[].menu_item_list[].description`
- `item popular?` → `.menu_category_list[].menu_item_list[].popular`
- `item price in USD` → `.menu_category_list[].menu_item_list[].price.amount / 100`

### getDeliveryEstimate (unwrapped `restaurant_availability`)
- `is open` → `.open`
- `delivery available` → `.open_delivery`
- `pickup available` → `.open_pickup`
- `delivery min minutes` → `.delivery_estimate_range_v2.minimum` (fallback: `.delivery_estimate`)
- `delivery max minutes` → `.delivery_estimate_range_v2.maximum` (fallback: `.delivery_estimate`)
- `pickup min minutes` → `.pickup_estimate_range_v2.minimum`
- `pickup max minutes` → `.pickup_estimate_range_v2.maximum`
- `delivery fee USD` → `.delivery_fee.amount / 100`
- `order minimum USD` → `.order_minimum.amount / 100`
- `sales tax rate` → `.sales_tax` (fractional)

## Quick Start

```bash
# Search for pizza near Midtown Manhattan
openweb grubhub exec searchRestaurants '{"latitude": 40.7484, "longitude": -73.9857, "searchTerm": "pizza"}'

# Get a restaurant's menu
openweb grubhub exec getMenu '{"restaurantId": "64436"}'

# Check delivery estimate
openweb grubhub exec getDeliveryEstimate '{"restaurantId": "64436"}'
```
