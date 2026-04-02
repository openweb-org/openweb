# Instagram Pipeline Gaps

## Auto-Curation: CSRF Detection False Positive

**Problem:** Auto-curation selected `brcap` cookie → `content-length` header as CSRF. This is clearly wrong — `content-length` is an HTTP standard header, not a CSRF token. The real CSRF is `csrftoken` cookie → `x-csrftoken` header.

**Root cause:** `src/compiler/analyzer/csrf-detect.ts` — the cookie-to-header matcher doesn't exclude standard HTTP headers (`content-length`, `content-type`, `accept`, etc.) from CSRF candidate matching.

**Suggested fix:** Add a denylist of standard HTTP headers to CSRF detection. Headers like `content-length`, `content-type`, `accept`, `host`, `connection`, `user-agent` should never be CSRF candidates.

## Auto-Curation: Path Normalization Missed Shortcode-Based Media IDs

**Problem:** Compiler created separate operations for each hardcoded media shortcode (`getMediaDwg8nuzej9pInfo`, `getMediaDwjils2ff9Info`, etc.) instead of normalizing them into the parameterized `/api/v1/media/{id}/info/` path alongside the numeric PK requests.

**Root cause:** `src/compiler/analyzer/path-normalize.ts` — the path normalizer did recognize the numeric PK variant as parameterized but treated shortcodes (alphanumeric with underscores/hyphens) as distinct literal paths.

**Suggested fix:** Improve path segment pattern matching to recognize mixed-case alphanumeric strings with special characters (`DWmZq_Aj5-R`) as likely ID parameters, especially when they appear in the same path position as already-parameterized segments.

## Auto-Curation: Required Const Headers Not Detected

**Problem:** Instagram's `/api/v1/` endpoints require `x-ig-app-id` and `x-requested-with: XMLHttpRequest` headers. Without them, all requests return 400. The compiler captured these headers in the traffic but didn't flag them as required const parameters — they had to be added manually during curation.

**Root cause:** The compiler has no heuristic for detecting "required constant headers" — headers that appear on every request with the same value and whose absence causes failure.

**Suggested fix:** During analysis, identify headers that appear on 100% of API requests with the same value and are not standard HTTP headers. Flag these as candidate const parameters in the analysis report. This would help Pinterest (`x-pinterest-appstate`) and Instagram (`x-ig-app-id`) automatically.

## Compile-Time Verify: PII Scrubbing Mangled Media ID

**Problem:** The example for `getMediaInfo` had `id: "+1-555-0100"` — the PII scrubber mistakenly identified the numeric media PK as a phone number and replaced it with a fake one.

**Root cause:** `src/compiler/curation/scrub.ts` — the PII scrubber pattern for phone numbers is too aggressive, matching long numeric strings that happen to be API identifiers.

**Suggested fix:** Don't scrub values that appear in URL path segments or are clearly API identifiers (path parameters). Path parameter values are structural, not PII.
