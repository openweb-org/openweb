import type { RecordedRequestSample } from '../types.js'

export interface FilterOptions {
  /** Target site URL — used to derive allowed hosts (e.g. https://www.notion.so) */
  readonly targetUrl?: string
  /** Additional allowed host suffixes (e.g. ['notion.so', 'api.notion.so']) */
  readonly allowHosts?: readonly string[]
  /** Allow non-GET methods (POST, PUT, DELETE, etc.). Default: true */
  readonly allowMutations?: boolean
}

/** Tracking / analytics domains to always block */
const BLOCKED_HOST_PATTERNS: readonly string[] = [
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'facebook.com',
  'facebook.net',
  'fbcdn.net',
  'twitter.com',
  'analytics.twitter.com',
  't.co',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'sentry.io',
  'newrelic.com',
  'nr-data.net',
  'optimizely.com',
  'intercom.io',
  'intercomcdn.com',
  'crisp.chat',
  'drift.com',
  'fullstory.com',
  'clarity.ms',
  'mouseflow.com',
  'bugsnag.com',
  'datadoghq.com',
  'logrocket.com',
  'posthog.com',
  'plausible.io',
  'matomo.cloud',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
]

/** Known multi-part public suffixes (ccSLD patterns) */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'ne.kr', 'ac.kr', 'go.kr',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.za', 'org.za', 'web.za', 'gov.za',
  'com.br', 'org.br', 'net.br', 'gov.br',
  'co.in', 'net.in', 'org.in', 'gen.in', 'gov.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.tw', 'org.tw', 'net.tw', 'gov.tw',
  'com.mx', 'org.mx', 'gob.mx', 'net.mx',
  'com.sg', 'org.sg', 'net.sg', 'gov.sg',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'co.id', 'or.id', 'go.id', 'web.id',
  'com.ar', 'org.ar', 'net.ar', 'gov.ar',
  'co.th', 'or.th', 'go.th', 'in.th',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr',
  'com.ua', 'org.ua', 'net.ua',
  'com.hk', 'org.hk', 'net.hk', 'gov.hk',
])

/**
 * Extract the registrable domain from a hostname.
 * Handles multi-part TLDs: "api.bbc.co.uk" → "bbc.co.uk", not "co.uk".
 * Simple TLDs: "api.notion.so" → "notion.so".
 */
function extractBaseDomain(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname

  // Check if last two parts form a known multi-part TLD
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_PART_TLDS.has(lastTwo)) {
    // Need at least 3 parts for SLD + multi-part TLD
    if (parts.length <= 3) return hostname
    return parts.slice(-3).join('.')
  }

  return parts.slice(-2).join('.')
}

function isBlockedHost(host: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
}

/**
 * Hosting platforms where each subdomain is a different tenant.
 * For these, the allowed domain must be the full hostname, not just the base.
 * e.g. target=foo.github.io should NOT allow bar.github.io.
 */
const HOSTING_PLATFORMS = new Set([
  'github.io',
  'gitlab.io',
  'netlify.app',
  'netlify.com',
  'vercel.app',
  'herokuapp.com',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'azurewebsites.net',
  'azurestaticapps.net',
  'fly.dev',
  'render.com',
  'railway.app',
  'surge.sh',
  'deno.dev',
  'workers.dev',
])

function isHostingPlatform(baseDomain: string): boolean {
  return HOSTING_PLATFORMS.has(baseDomain)
}

function buildAllowedDomains(options: FilterOptions): string[] {
  const domains: string[] = []

  if (options.targetUrl) {
    try {
      const hostname = new URL(options.targetUrl).hostname
      const baseDomain = extractBaseDomain(hostname)
      // For hosting platforms, use full hostname to prevent cross-tenant matching
      if (isHostingPlatform(baseDomain)) {
        domains.push(hostname)
      } else {
        domains.push(baseDomain)
      }
    } catch {
      // intentional: invalid targetUrl from user input — skip domain extraction
    }
  }

  if (options.allowHosts) {
    for (const host of options.allowHosts) {
      domains.push(host)
    }
  }

  return domains
}

function isAllowedHost(host: string, allowedDomains: string[]): boolean {
  // No domains specified → allow everything (minus blocklist)
  if (allowedDomains.length === 0) return !isBlockedHost(host)

  // Check if host matches any allowed domain (exact or subdomain)
  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** Infrastructure/noise path patterns to reject.
 * Patterns are intentionally narrow to avoid false positives on real API paths.
 * e.g. /api/tracking/shipments is allowed; /_/tracking is blocked.
 */
const BLOCKED_PATH_PATTERNS: readonly RegExp[] = [
  /\/manifest\.json$/,
  /\/_next\//,
  /\/\.well-known\//,
  /\/favicon\./,
  /\/robots\.txt$/,
  /\/sitemap\.xml/,
  /^\/_\/(trace|tracking|telemetry|beacon|collect|analytics|pixel)\b/,  // internal-prefixed paths
  /\/api\/v?\d*\/(trace|telemetry|beacon|collect)\b/i,                  // api/v1/trace etc.
  /\/events?\/(create|batch|track|report)\b/i,                         // event tracking
  /\/health(z|check)?$/,
  /\/ping$/,
  /\/cookie-settings\b/,
  /\/_ajax\b/,
  /\/sw\.js$/,
  /\/service-worker/,
  /\/workbox-/,
  /\/csp-report\b/,
]

function isBlockedPath(urlPath: string): boolean {
  return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(urlPath))
}

export function filterSamples(samples: RecordedRequestSample[], options: FilterOptions = {}): RecordedRequestSample[] {
  const allowedDomains = buildAllowedDomains(options)
  const allowMutations = options.allowMutations ?? true

  return samples.filter((sample) => {
    if (!allowMutations && sample.method !== 'GET') return false
    if (sample.status < 200 || sample.status >= 300) return false
    if (isBlockedHost(sample.host)) return false
    if (!isAllowedHost(sample.host, allowedDomains)) return false
    if (isBlockedPath(sample.path)) return false
    if (sample.contentType && !sample.contentType.includes('application/json')) return false
    return true
  })
}
