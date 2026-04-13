# Kayak

## Overview
Travel meta-search engine — flights, hotels across 100+ providers.

## Workflows

### Search for flights
1. `searchFlights(origin, destination, departureDate, returnDate)` → results with `resultId`, `legs`, `segments`
2. Results include booking URLs to provider sites (Southwest, United, etc.)
3. Use `legs` map to get duration/times, `segments` map for airline/flight details

### Search for hotels
1. `searchHotels(destination, checkInDate, checkOutDate)` → results with hotel name, rating, prices
2. Results include prices from multiple providers for comparison

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchFlights | find flights | origin, destination, departureDate | results, legs, segments, airlines | round-trip if returnDate given |
| searchHotels | find hotels | destination, checkInDate, checkOutDate | results with provider pricing | use dashes in destination |

## Quick Start

```bash
# Search round-trip flights SFO → NYC
openweb kayak exec searchFlights '{"origin":"SFO","destination":"NYC","departureDate":"2026-05-15","returnDate":"2026-05-22"}'

# Search hotels in New York
openweb kayak exec searchHotels '{"destination":"New-York","checkInDate":"2026-05-15","checkOutDate":"2026-05-20","guests":2}'
```
