# Google Maps

## Overview

Google Maps — location search, place details, directions, and geocoding. Adapter-based extraction from internal APIs and SPA DOM.

## Workflows

### Find a place and get details

1. `searchPlaces(query)` → place listings → `placeId`
2. `getPlaceDetails(placeId)` → name, address, rating, hours, website, phone, reviews
3. `getPlaceReviews(placeId)` → detailed reviews with author, rating, relative time
4. `getPlacePhotos(placeId)` → photo URLs with dimensions
5. `getPlaceHours(placeId)` → weekly operating schedule
6. `getPlaceAbout(placeId)` → description, category, attributes

### Search nearby and compare

1. `nearbySearch(category, location)` → place listings → `placeId`
2. `getPlaceDetails(placeId)` per result → compare ratings, hours, prices

### Get directions between locations

1. `getDirections(origin, destination)` → driving routes with distance, duration
2. `getTransitDirections(origin, destination)` → public transit routes
3. `getWalkingDirections(origin, destination)` → walking routes
4. `getBicyclingDirections(origin, destination)` → cycling routes

### Geocoding

1. `geocode(address)` → lat, lng, placeId from address string
2. `reverseGeocode(lat, lng)` → address, place name from coordinates

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPlaces | search places by query | query | placeId, name, address, rating, lat/lng | entry point, SPA nav |
| getPlaceDetails | full place details | placeId ← searchPlaces | name, rating, hours, website, phone, reviews | preview API |
| getPlaceReviews | detailed reviews | placeId ← searchPlaces | reviews[].text, authorName, rating, relativeTime | preview API |
| getPlacePhotos | photo URLs | placeId ← searchPlaces | photos[].url, width, height | preview API |
| getPlaceHours | operating schedule | placeId ← searchPlaces | status, schedule[].day, hours | preview API |
| getPlaceAbout | description + attributes | placeId ← searchPlaces | description, category, rating, website, phone | preview API |
| getDirections | driving directions | origin, destination | routes[].name, distanceText, durationText | entry point, SPA nav |
| getTransitDirections | transit directions | origin, destination | routes[].name, durationText | entry point, SPA nav |
| getWalkingDirections | walking directions | origin, destination | routes[].name, distanceText, durationText | entry point, SPA nav |
| getBicyclingDirections | cycling directions | origin, destination | routes[].name, distanceText, durationText | entry point, SPA nav |
| nearbySearch | search by category near location | category, location | placeId, name, address, rating, lat/lng | entry point, SPA nav |
| getAutocompleteSuggestions | type-ahead suggestions | input | suggestions[].text, placeId, description | entry point, suggest API |
| geocode | address to coordinates | address | lat, lng, placeId, formattedAddress | entry point, SPA nav |
| reverseGeocode | coordinates to address | lat, lng | address, name, placeId | entry point, SPA nav |

## Quick Start

```bash
# Search for places
openweb google-maps exec searchPlaces '{"query": "coffee shops in San Francisco"}'

# Get place details (use placeId from search results)
openweb google-maps exec getPlaceDetails '{"placeId": "0x80858135f0db680b:0x47e714bf5f0080a3", "query": "The Coffee Berry SF"}'

# Get driving directions
openweb google-maps exec getDirections '{"origin": "San Francisco, CA", "destination": "Los Angeles, CA"}'

# Get transit directions
openweb google-maps exec getTransitDirections '{"origin": "Union Square, San Francisco", "destination": "Golden Gate Park, San Francisco"}'

# Search nearby
openweb google-maps exec nearbySearch '{"category": "restaurants", "location": "Times Square"}'

# Geocode an address
openweb google-maps exec geocode '{"address": "1600 Amphitheatre Parkway, Mountain View, CA"}'

# Reverse geocode coordinates
openweb google-maps exec reverseGeocode '{"lat": 37.7749, "lng": -122.4194}'
```
