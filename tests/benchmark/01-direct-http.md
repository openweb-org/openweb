# Benchmark 1: Direct HTTP — Open-Meteo Weather Forecast

## Task

Get the weather forecast for Berlin (latitude 52.52, longitude 13.41) including hourly temperature.

## Mode

`direct_http` — no browser, no auth required.

## Expected Tool Calls

1. `openweb sites` — list available sites
2. `openweb open-meteo` — check site readiness (should show: Requires browser: no)
3. `openweb open-meteo get_forecast` — inspect operation parameters
4. `openweb open-meteo exec get_forecast '{"latitude": 52.52, "longitude": 13.41, "hourly": ["temperature_2m"]}'` — execute

## Success Criteria

- stdout contains valid JSON with `latitude`, `longitude`, `hourly.temperature_2m` keys
- `hourly.temperature_2m` is a non-empty array of numbers
- No error on stderr
- Agent correctly identifies no browser/auth needed from readiness metadata

## Failure Criteria

- Error on stderr with any failureClass
- Agent attempts to connect browser/CDP for a direct_http site
- Agent cannot find or use the correct parameters
