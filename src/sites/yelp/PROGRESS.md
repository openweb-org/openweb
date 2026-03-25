# Yelp — Progress

## 2026-03-23: Initial discovery attempt — CAPTCHA blocked

**What changed:**
- Attempted full discover workflow: capture, compile, verify
- Browsed 6 Yelp pages via Playwright CDP (search, business detail, pagination)
- All pages served DataDome CAPTCHA — zero usable DOM extractions or API traffic
- Tested alternative endpoints: `/search/snippet` (403), `/gql/batch` (403 with queries), `api.yelp.com/v3` (401 needs API key)
- Confirmed `/search_suggest/v2/prefetch` works publicly (autocomplete suggestions only)
- Documented block in `doc/blocked.md`

**Why:**
- Yelp is a target for M26 discovery (business search, detail, reviews)
- DataDome bot detection blocks all headless browser and curl access to data-bearing pages

**Verification:** No fixture to verify — all endpoints CAPTCHA-blocked except autocomplete
**Commit:** 72ce770
