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

/**
 * Extract the registrable domain (SLD + TLD) from a hostname.
 * e.g. "api.notion.so" → "notion.so", "www.github.com" → "github.com"
 */
function extractBaseDomain(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname
  return parts.slice(-2).join('.')
}

function isBlockedHost(host: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
}

function buildAllowedDomains(options: FilterOptions): string[] {
  const domains: string[] = []

  if (options.targetUrl) {
    try {
      const baseDomain = extractBaseDomain(new URL(options.targetUrl).hostname)
      domains.push(baseDomain)
    } catch {
      // invalid URL — skip
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

export function filterSamples(samples: RecordedRequestSample[], options: FilterOptions = {}): RecordedRequestSample[] {
  const allowedDomains = buildAllowedDomains(options)
  const allowMutations = options.allowMutations ?? true

  return samples.filter((sample) => {
    if (!allowMutations && sample.method !== 'GET') return false
    if (sample.status < 200 || sample.status >= 300) return false
    if (isBlockedHost(sample.host)) return false
    if (!isAllowedHost(sample.host, allowedDomains)) return false
    if (sample.contentType && !sample.contentType.includes('application/json')) return false
    return true
  })
}
