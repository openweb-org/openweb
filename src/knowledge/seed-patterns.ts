import type { PatternCategory } from './patterns.js'

interface SeedPattern {
  readonly category: PatternCategory
  readonly signal: string
  readonly action: string
  readonly source: string
}

/**
 * Seed patterns extracted from M3-M16 codex reviews and M5 pitfalls.
 * These encode hard-won knowledge about how websites work in practice.
 */
export const SEED_PATTERNS: readonly SeedPattern[] = [
  // ── Auth patterns ──
  {
    category: 'auth',
    signal: 'cookie name starts with __cf',
    action: 'Exclude from cookie_session detection — Cloudflare infrastructure cookie, not auth',
    source: 'M15 codex review R1',
  },
  {
    category: 'auth',
    signal: 'cookie names SID, HSID, SSID, SAPISID, SIDCC',
    action: 'Do NOT add to cookie denylist — these are real Google auth cookies',
    source: 'M15 codex review R1',
  },
  {
    category: 'auth',
    signal: 'sessionStorage key matching msal.token.keys.*',
    action: 'Use sessionstorage_msal auth type with Page global transport',
    source: 'M9 codex review',
  },
  {
    category: 'auth',
    signal: 'localStorage key containing JWT or token with eyJ prefix value',
    action: 'Use localStorage_jwt auth type — extract from localStorage and attach as Bearer header',
    source: 'M10 codex review',
  },
  {
    category: 'auth',
    signal: 'SAPISIDHASH in request headers',
    action: 'Use sapisidhash signing type — requires SAPISID cookie + origin for hash computation',
    source: 'M9 codex review',
  },
  {
    category: 'auth',
    signal: '401/403 response after token cache hit',
    action: 'Clear token cache and retry with fresh browser extraction — cached tokens may be expired',
    source: 'M14 codex review',
  },
  {
    category: 'auth',
    signal: 'cookie_session detected on public API (no login required)',
    action: 'Verify with node_no_auth probe first — public APIs may set tracking cookies that look like sessions',
    source: 'M10 codex review',
  },

  // ── API patterns ──
  {
    category: 'api',
    signal: 'response status 429 or Retry-After header',
    action: 'Mark operation as retriable failure class — do not mark as DRIFT or FAIL',
    source: 'M10 codex review',
  },
  {
    category: 'api',
    signal: 'POST/PUT endpoint without recorded request body',
    action: 'Skip emission — no body inference yet, mutations without modeled bodies are unsafe',
    source: 'M15 codex review R1',
  },
  {
    category: 'api',
    signal: 'GraphQL endpoint (path contains /graphql)',
    action: 'Flag mutation risk — GraphQL queries may contain mutations via POST',
    source: 'M10 codex review',
  },
  {
    category: 'api',
    signal: 'path contains checkout, purchase, or payment',
    action: 'Assign transact permission — never auto-execute without explicit user confirmation',
    source: 'M14 codex review',
  },

  // ── Extraction patterns ──
  {
    category: 'extraction',
    signal: 'window.__NEXT_DATA__ present on page',
    action: 'Use ssr_next_data extraction type — data already server-rendered, no API call needed',
    source: 'M5 pitfalls',
  },
  {
    category: 'extraction',
    signal: 'response schema declares field X but API returns field Y',
    action: 'Regenerate schema from fresh response — API schema drift is common (e.g., items vs feed_items)',
    source: 'M5 pitfall #8 (Instagram)',
  },
  {
    category: 'extraction',
    signal: 'script[type="application/json"] or script[type="application/ld+json"]',
    action: 'Use script_json extraction type — structured data embedded in HTML',
    source: 'M10 codex review',
  },
  {
    category: 'extraction',
    signal: 'extraction_detected signal but no corresponding API operation',
    action: 'Generate extraction-only operation — some sites embed data without API calls',
    source: 'M10 codex review',
  },

  // ── Pagination patterns ──
  {
    category: 'pagination',
    signal: 'Link header with rel="next" containing page= parameter',
    action: 'Use link_header pagination — parse Link header, follow next URL',
    source: 'M10 codex review (GitHub pagination fix)',
  },
  {
    category: 'pagination',
    signal: 'response contains next_max_id or cursor field',
    action: 'Use cursor pagination — pass cursor value as query parameter to next request',
    source: 'M9 codex review',
  },

  // ── Discovery patterns ──
  {
    category: 'discovery',
    signal: 'service worker page in browser context.pages()',
    action: 'Filter out service worker pages — they match in findPageForOrigin but are not user-visible',
    source: 'M5 pitfall #1',
  },
  {
    category: 'discovery',
    signal: 'backgrounded tab returns undefined for page.evaluate',
    action: 'Detect tab discard and reload — Chrome discards JS heap in backgrounded tabs',
    source: 'M5 pitfall #2',
  },
  {
    category: 'discovery',
    signal: 'SPA page with webpack chunk loading (10s+ after navigation)',
    action: 'Wait for network idle, not just DOMContentLoaded — SPA bootstrap timing varies',
    source: 'M5 pitfall #10 (Telegram)',
  },
  {
    category: 'discovery',
    signal: 'pnpm dev stdout contains non-JSON banner text',
    action: 'Use pnpm --silent dev to suppress banner — prevents JSON parsing failures in piped output',
    source: 'M5 pitfall #7',
  },
  {
    category: 'discovery',
    signal: 'URL path matches /login|signin|sign-in with password form',
    action: 'Detect as login_wall — trigger human_handoff, do not attempt to fill forms',
    source: 'M16 codex review',
  },
  {
    category: 'discovery',
    signal: 'DOM selector containing special characters (colons, brackets)',
    action: 'Escape CSS selectors before passing to Playwright — unescaped selectors cause parse errors',
    source: 'M16 codex review R1',
  },
  {
    category: 'discovery',
    signal: 'probe request sent to CLI URL host instead of operation host',
    action: 'Build probe URL from operation.host, not the CLI-provided URL — multi-host APIs break otherwise',
    source: 'M15 codex review R1',
  },
  {
    category: 'discovery',
    signal: 'redirect response (301/302/303) during probe or verify',
    action: 'Validate SSRF on each redirect hop — redirect chains can escape to internal networks',
    source: 'M15 codex review R1',
  },
] as const
