# Compile Review Guide

How to review `openweb compile` output effectively. The compile output is a **draft** — it needs agent curation before the spec is ready for use.

## Draft → Curate → Verify

1. **Draft**: `openweb compile` runs fully offline and deterministic. It produces a draft spec with auto-detected auth, auto-filtered samples, auto-generated operation names.
2. **Curate**: You (the agent) review the draft, rename operations, remove noise, confirm auth/CSRF/signing choices, decide if another capture is needed.
3. **Verify**: `openweb verify` confirms the spec works against the live site.

A spec is **Ready** when it has been curated + verified.

## Reading the Compile Summary

After compile, the summary shows:

- **Samples**: `captured → after filter (rejected)` — how many raw API calls survived filtering
- **Operations**: total operations generated, how many verified, how many mutations skipped
- **Primitives**: detected auth, CSRF, signing types
- **Hints**: warnings about potential issues that need your attention

## Review Hints — What They Mean

| Hint | What to check |
|------|--------------|
| "Very few API samples captured" | The capture session was too short or too shallow. Recapture with more browsing. |
| "N mutation operations skipped" | POST/PUT/PATCH/DELETE with request bodies can't be auto-generated yet. Identify these manually if needed. |
| "No auth primitive detected" | If the site requires login, the capture may be missing authenticated traffic. Check if user was logged in. |
| "No operations verified" | Endpoints may require auth or may have changed. Check auth setup and try manual verification. |
| "Many operations generated" | Likely includes tracking/analytics endpoints. Review and remove noise. |

## Per-Archetype Review Checklist

### Social Media
- [ ] Auth detected correctly (cookie_session, exchange_chain, etc.)
- [ ] CSRF detected if present (cookie_to_header is common)
- [ ] Feed/timeline endpoint captured
- [ ] Pagination works (cursor-based is typical)
- [ ] Write operations properly gated (write/transact permission)

### Messaging
- [ ] Transport correct (page or adapter for Discord/Telegram/WhatsApp)
- [ ] Token extraction method correct (webpack_module_walk for Discord)
- [ ] WebSocket limitation acknowledged (can't capture real-time streams)

### Developer Tools
- [ ] Pagination type correct (link_header for GitHub, cursor for others)
- [ ] Path parameters extracted properly (e.g., /{owner}/{repo})
- [ ] GraphQL endpoints handled (if present)

### E-commerce
- [ ] Extraction type correct (ssr_next_data for Next.js sites)
- [ ] Checkout/payment paths assigned `transact` permission
- [ ] Product search and detail endpoints captured

### Public APIs (no auth)
- [ ] Auth correctly detected as "none" (no false positive from tracking cookies)
- [ ] Response schema accurate (check field names, types)
- [ ] Example parameters reasonable

## Common False Positives

- **Tracking cookies detected as auth**: Cloudflare, Google Analytics, Meta pixel cookies may trigger cookie_session. The probe step (`--probe`) helps catch this.
- **Analytics endpoints as operations**: `/collect`, `/track`, `/beacon`, `/pixel` paths are noise. Filter should catch most, but review for site-specific analytics.
- **CDN/static endpoints**: `/static/`, `/_next/`, `/assets/` paths should be filtered out.

## Common False Negatives

- **Auth not detected**: User wasn't logged in during capture, or auth uses an unsupported pattern.
- **CSRF not detected**: CSRF token embedded in JavaScript (not cookie or meta tag) — agent must identify manually.
- **Operations missing**: Key pages weren't visited during capture. Solution: recapture with targeted browsing.
- **Extraction not detected**: Site uses non-standard SSR patterns (not Next.js `__NEXT_DATA__` or standard `<script type="application/json">`).
