# Google Maps — Pipeline Gaps & Fix Report

## 2026-04-02 Fix Summary

### Status: 11/11 PASS (was 5/11)

### Root Causes Fixed

#### 1. Navigation method: `page.evaluate(window.location.href=...)` → `page.goto()`
**Affected ops:** searchPlaces, nearbySearch, geocode, getDirections (all 4 modes), reverseGeocode
**Symptom:** Navigation errors, context destroyed, timeouts, 502s
**Cause:** Google Maps was the only adapter using `page.evaluate(() => { window.location.href = url })` for navigation. This destroys the Playwright execution context mid-evaluate, causing `ReferenceError` or `Target page closed` errors. Every other adapter (google-search, booking, redfin, amazon, etc.) uses `page.goto()`.
**Fix:** Replaced all `page.evaluate(window.location.href = ...)` with `page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })`. Removed manual `sleep()` calls that were compensating for the broken navigation — `page.goto()` properly waits for load.

#### 2. `__name` polyfill lost after navigation
**Affected ops:** getDirections (all 4 modes)
**Symptom:** `ReferenceError: __name is not defined` inside `page.evaluate()`
**Cause:** `ensurePagePolyfills()` in `adapter-executor.ts` injects the esbuild `__name` helper into the browser via `page.evaluate()`. After `page.goto()`, the browser context is fresh and the polyfill is gone. The `parseRoute` function inside `page.evaluate()` is decorated with `__name()` by esbuild's `keepNames` option.
**Fix:** Added `injectPolyfill(page)` helper that re-injects the `__name` polyfill after each `page.goto()` in `getDirectionsForMode`.

#### 3. Malformed example files
**Affected ops:** getTransitDirections, getWalkingDirections, reverseGeocode
**Symptom:** `malformed example file: missing cases array`
**Cause:** Three example files used a flat format (`operationId`/`parameters`/`expect`) instead of the expected v1 format (`operation_id`/`cases[].input`/`cases[].assertions`).
**Fix:** Rewrote all three files to match the v1 example format used by the other 7 examples.

#### 4. Autocomplete endpoint 502
**Affected ops:** getAutocompleteSuggestions
**Symptom:** HTTP 502 from `/maps/suggest` endpoint
**Cause:** The `/maps/suggest` endpoint doesn't reliably serve responses from automated browser contexts.
**Fix:** Switched to DOM interaction — type into the Maps search box (`#searchboxinput`), wait for the autocomplete dropdown, then extract suggestions from `[role="listbox"] [role="option"]` elements.

### Remaining Gaps

| Area | Gap | Impact |
|------|-----|--------|
| Bot detection | Google may flag automated browsers — "Sorry..." captcha page | Blocks all ops if IP is flagged |
| DOM selectors | Obfuscated class names (`.hfpxzc`, `.MW4etd`, `.W4Efsd`, `.MespJc`) may change | Search/directions extraction breaks on selector drift |
| Preview API indices | Place data at `info[11]`, `info[4][7]`, `info[203][1]` etc. are position-dependent | Details/reviews/photos/hours/about return nulls on index shift |
| Direction routes | Transit routes show duplicate entries (same route parsed twice) | `routes[]` may have 2x expected length |
| Direction parsing | `via` regex only captures simple route names; complex transit descriptions may not parse | Route `name` falls back to "Route" |
| Autocomplete | DOM-based approach depends on Google Maps rendering the suggestion dropdown | May return empty `suggestions[]` if dropdown doesn't render |
| getTransitDirections | Intermittent "Target page closed" during sequential verification | Non-deterministic; passes on retry |
| Geocode precision | Uses search results extraction — may return the search result rather than a precise geocode point | `lat`/`lng` from search listing URL, not from a geocoding API |
