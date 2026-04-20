# Pinterest Pipeline Gaps

## Doc gaps

### Custom header requirement not documented in capture-guide.md

**Problem:** Pinterest requires custom headers (`x-requested-with: XMLHttpRequest`, `x-pinterest-appstate: active`, `x-pinterest-pws-handler`) for ALL API calls, even via `page.evaluate(fetch)`. The capture guide only covers cookie auth, token auth, and CORS — not custom header requirements for bot detection.

**Root cause:** `skills/openweb/references/capture-guide.md` — "Direct API Calls via page.evaluate(fetch)" section only mentions `credentials: 'same-origin'`, not site-specific headers.

**Suggested fix:** Add a subsection to capture-guide.md about "Custom Header Requirements" noting that some sites require additional headers beyond cookies for `page.evaluate(fetch)` to succeed. Recommend checking captured HAR request headers to identify required non-standard headers.

## Code gaps

### CSRF auto-detection picked wrong cookie/header pair

**Problem:** The CSRF auto-detector picked `segmentedControlMode` cookie → `screen-dpr` header instead of the correct `csrftoken` cookie → `x-csrftoken` header. The correct pair was obvious from the HAR (POST requests had `x-csrftoken` header matching `csrftoken` cookie value).

**Root cause:** `src/compiler/analyzer/csrf-detect.ts` — the correlation algorithm matched a UI preference cookie to a DPR hint header, possibly because both appeared in all requests. The correct CSRF pair (`csrftoken` → `x-csrftoken`) was either not correlated or scored lower.

**Suggested fix:** Boost scoring for cookie/header pairs where the header name contains "csrf" or "token". This would correctly identify the CSRF pair in most cases.

### Compiler splits JSON query parameter into array

**Problem:** Pinterest's `data` query parameter is a JSON string. The compiler parsed it as an array of strings (splitting at commas inside the JSON), producing `type: array, items: string` instead of `type: string`.

**Root cause:** URL query parameter parsing in the analyzer splits repeated params or comma-separated values.

**Suggested fix:** Detect when a query parameter value is valid JSON and preserve it as a single `type: string` parameter rather than splitting.

## Missing automation

### No auto-detection of custom required headers

**Problem:** Had to manually discover that Pinterest requires `x-requested-with`, `x-pinterest-appstate`, and `x-pinterest-pws-handler` headers by comparing successful browser requests to failing fetch calls.

**Suggested fix:** During analysis, compare headers present on all API requests (besides standard browser headers) and flag site-specific headers as likely required. These could be auto-configured as `const` header parameters in the generated spec.
