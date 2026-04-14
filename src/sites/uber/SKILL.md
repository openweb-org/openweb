# Uber

## Overview
Ride-hailing platform. Location search, fare estimates, ride history via GraphQL on m.uber.com and riders.uber.com. Cookie_session auth shared across uber.com subdomains.

## Workflows

### Get fare estimate for a ride
1. `searchLocations(query="Times Square", type=PICKUP)` → `locations[0].latitude`, `locations[0].longitude`
2. `searchLocations(query="Empire State Building", type=DROPOFF)` → `locations[0].latitude`, `locations[0].longitude`
3. `getRideEstimate(pickup={latitude, longitude}, destination={latitude, longitude})` ← searchLocations → `rides[]` with `displayName`, `fare`, `etaString`, `capacity`

### View past rides
1. `getRideHistory(limit)` → `rides[]` with `uuid`, `title`, `fare`, `detailUrl`, `nextPageToken`
2. `getRideHistory(nextPageToken)` ← previous getRideHistory → next page of rides

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchLocations | find pickup/dropoff location | query (text), type (PICKUP/DROPOFF) | id, name, address, latitude, longitude | entry point for getRideEstimate |
| getRideEstimate | get fare quotes for ride | pickup{latitude, longitude} ← searchLocations, destination{latitude, longitude} ← searchLocations | rides[] with displayName, fare, fareAmountCents, capacity, etaString | returns multiple vehicle types |
| getRideHistory | past ride trips | limit, nextPageToken ← previous getRideHistory | uuid, title, subtitle, fare, detailUrl, nextPageToken | paginated; hasMore indicates more pages |

## Quick Start

```bash
# Search for pickup location
openweb uber exec searchLocations '{"query":"Times Square New York","type":"PICKUP"}'

# Search for dropoff location
openweb uber exec searchLocations '{"query":"Empire State Building","type":"DROPOFF"}'

# Get fare estimates (use coordinates from searchLocations)
openweb uber exec getRideEstimate '{"pickup":{"latitude":40.758,"longitude":-73.9855},"destination":{"latitude":40.7484,"longitude":-73.9857}}'

# View past rides
openweb uber exec getRideHistory '{"limit":5}'
```

## Known Limitations
- **Read-only**: No ride request or cancellation operations (safety level: NEVER for real-money transactions).
- **Browser session required**: All operations use page transport (GraphQL via browser context for cookie auth).
- **Location search bias**: Pass current latitude/longitude for more relevant local results.
