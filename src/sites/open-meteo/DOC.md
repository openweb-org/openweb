# Open-Meteo

## Overview
Free weather API — geocoding, forecast, historical, and air quality data. No auth required.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| search_location | geocode location name | GET /v1/search | on `geocoding-api.open-meteo.com` |
| get_forecast | hourly/daily forecast | GET /v1/forecast | on `api.open-meteo.com` |
| get_historical | historical weather | GET /v1/archive | on `archive-api.open-meteo.com` |
| get_air_quality | air quality data | GET /v1/air-quality | on `air-quality-api.open-meteo.com` |

## API Architecture
- Each data type lives on a **separate subdomain** (geocoding-api, api, archive-api, air-quality-api)
- All endpoints are GET-only with query params
- `hourly` and `daily` params accept arrays of variable names (e.g. `temperature_2m`, `precipitation`)
- Responses nest data under `hourly`/`daily` objects with parallel arrays (time + values)

## Auth
None — fully public API.

## Transport
- `node` — all endpoints use direct HTTP

## Dependencies
- `search_location` feeds `latitude`/`longitude` into `get_forecast` and other endpoints
