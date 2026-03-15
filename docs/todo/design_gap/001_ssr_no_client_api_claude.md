# Design Gap: Pure SSR Sites with No Client-Side API Traffic

## Severity: HIGH

## Problem

Server-side rendered sites serve complete HTML from the server. The browser receives
pre-rendered pages and makes no (or minimal) XHR/fetch calls. OpenWeb's compiler
records HAR traffic while browsing — but for these sites, HAR contains only static
asset requests (HTML, CSS, images), not structured API calls.

The compiler's clustering, parameter differentiation, and schema inference stages
all require API traffic as input. With no API traffic, the entire pipeline produces
nothing.

## Affected Sites

- **Hacker News** — Pure SSR, data baked into HTML. Has a public Firebase API
  (`hacker-news.firebaseio.com`) but the site itself never calls it client-side.
- **Wikipedia** — Server-rendered articles. Has MediaWiki API but the reading UI
  doesn't use it for page content.
- **Craigslist** — Minimal JS, fully server-rendered listings.
- **Stack Overflow** (partial) — Questions/answers are SSR; only voting/commenting
  uses client-side API calls.

## Why OpenWeb Can't Handle It

1. HAR recording captures browser network traffic — SSR sites have no API traffic
2. Compiler Phase 2 (Analyze & Extract) has no requests to cluster
3. Even if a public API exists (HN Firebase, Wikipedia MediaWiki), it won't appear
   in HAR because the site's own frontend doesn't use it
4. The LLM explorer agent browses pages but only triggers page loads, not API calls

## Potential Mitigations

- **API discovery outside HAR**: Probe known API paths (`/api`, `/graphql`,
  `/wp-json`, etc.) or detect framework-specific endpoints from HTML/headers
  (ApiTap already does this)
- **Public API database**: Maintain a mapping of known sites → their public APIs
  (e.g., HN → Firebase API, Wikipedia → MediaWiki API)
- **HTML extraction mode**: Fall back to extracting structured data from HTML DOM
  when no API traffic is found (similar to ApiTap's `read` mode)
- **Accept the limitation**: Document that pure SSR sites are out of scope for the
  compiler; recommend using official APIs or HTML scraping tools instead
