import type { LabeledSample, SampleCategory } from '../types-v2.js'
import type { RecordedRequestSample } from '../types.js'

export interface LabelOptions {
  readonly allowHosts?: readonly string[]
  readonly allowMutations?: boolean
}

// ---------------------------------------------------------------------------
// Config — inlined for bundle compatibility (no readFileSync + import.meta.url)
// ---------------------------------------------------------------------------

const BLOCKED_HOST_PATTERNS: readonly string[] = [
  'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com',
  'googleadservices.com', 'doubleclick.net', 'facebook.com', 'facebook.net',
  'fbcdn.net', 'twitter.com', 'analytics.twitter.com', 't.co', 'hotjar.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com', 'sentry.io',
  'newrelic.com', 'nr-data.net', 'optimizely.com', 'intercom.io', 'intercomcdn.com',
  'crisp.chat', 'drift.com', 'fullstory.com', 'clarity.ms', 'mouseflow.com',
  'bugsnag.com', 'datadoghq.com', 'logrocket.com', 'posthog.com', 'plausible.io',
  'matomo.cloud', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net',
  'unpkg.com', 'cdnjs.cloudflare.com',
]

const BLOCKED_PATH_PATTERNS: readonly RegExp[] = [
  /\/manifest\.json$/,
  /\/_next\//,
  /\/\.well-known\//,
  /\/favicon\./,
  /\/robots\.txt$/,
  /\/sitemap\.xml/,
  /^\/_\/(trace|tracking|telemetry|beacon|collect|analytics|pixel)\b/,
  /\/api\/v?\d*\/(trace|telemetry|beacon|collect)\b/i,
  /\/events?\/(create|batch|track|report)\b/i,
  /\/health(z|check)?$/,
  /\/ping$/,
  /\/cookie-settings\b/,
  /\/_ajax\b/,
  /\/sw\.js$/,
  /\/service-worker/,
  /\/workbox-/,
  /\/csp-report\b/,
  /\/collect\/?$/,
  /\/trackObserve/,
  /\/events?\/(ext-tag|tms)-/,
  /\/security\/csp\b/,
  /\/px\//,
  /\/tscp\//,
  /\/realtimeFrontendClientConnectivityTracking/,
  /\/stats\/qoe\b/,
  /\/log_event\b/,
  /\/verify_session\b/,
  /\/youtubei\/v1\/log_event\b/,
  /\/collector\b/,
]

// ---------------------------------------------------------------------------
// Domain helpers (copied from filter.ts — not exported there)
// ---------------------------------------------------------------------------

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

function extractBaseDomain(hostname: string): string {
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname

  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_PART_TLDS.has(lastTwo)) {
    if (parts.length <= 3) return hostname
    return parts.slice(-3).join('.')
  }

  return parts.slice(-2).join('.')
}

const HOSTING_PLATFORMS = new Set([
  'github.io', 'gitlab.io', 'netlify.app', 'netlify.com',
  'vercel.app', 'herokuapp.com', 'pages.dev', 'web.app',
  'firebaseapp.com', 'azurewebsites.net', 'azurestaticapps.net',
  'fly.dev', 'render.com', 'railway.app', 'surge.sh',
  'deno.dev', 'workers.dev',
])

function isHostingPlatform(baseDomain: string): boolean {
  return HOSTING_PLATFORMS.has(baseDomain)
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function isBlockedHost(host: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((b) => host === b || host.endsWith(`.${b}`))
}

function isOffDomain(host: string, targetUrl: string, allowHosts: readonly string[]): boolean {
  const allowedDomains = buildAllowedDomains(targetUrl, allowHosts)
  if (allowedDomains.length === 0) return false
  return !allowedDomains.some((d) => host === d || host.endsWith(`.${d}`))
}

function buildAllowedDomains(targetUrl: string, allowHosts: readonly string[]): string[] {
  const domains: string[] = []
  try {
    const hostname = new URL(targetUrl).hostname
    const baseDomain = extractBaseDomain(hostname)
    domains.push(isHostingPlatform(baseDomain) ? hostname : baseDomain)
  } catch {
    // invalid targetUrl — skip
  }
  for (const host of allowHosts) {
    domains.push(host)
  }
  return domains
}

function isBlockedPath(urlPath: string): boolean {
  return BLOCKED_PATH_PATTERNS.some((p) => p.test(urlPath))
}

const STATIC_CONTENT_TYPE_PREFIXES = [
  'image/', 'font/', 'video/', 'audio/', 'text/css',
]

function isStaticContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return STATIC_CONTENT_TYPE_PREFIXES.some((prefix) => ct.startsWith(prefix))
}

const STATIC_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js', '.mjs', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.ico', '.webp', '.avif', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.flac',
  '.map', '.ts', '.tsx', '.jsx',
])

function getPathExtension(urlPath: string): string {
  // Strip query string and fragment
  const clean = urlPath.split('?')[0].split('#')[0]
  const lastDot = clean.lastIndexOf('.')
  if (lastDot === -1) return ''
  return clean.slice(lastDot).toLowerCase()
}

function isStaticExtension(urlPath: string): boolean {
  const ext = getPathExtension(urlPath)
  return ext !== '' && STATIC_EXTENSIONS.has(ext)
}

// ---------------------------------------------------------------------------
// Main labeler
// ---------------------------------------------------------------------------

/**
 * Label every sample with a category. No data is dropped — every input
 * sample produces exactly one LabeledSample in the output.
 */
export function labelSamples(
  samples: RecordedRequestSample[],
  targetUrl: string,
  options?: LabelOptions,
): LabeledSample[] {
  const allowHosts = options?.allowHosts ?? []

  return samples.map((sample, i): LabeledSample => {
    const { category, reasons } = categorize(sample, targetUrl, allowHosts)
    return {
      id: `s-${i}`,
      sample,
      category,
      responseKind: sample.response.kind,
      reasons,
    }
  })
}

function categorize(
  sample: RecordedRequestSample,
  targetUrl: string,
  allowHosts: readonly string[],
): { category: SampleCategory; reasons: string[] } {
  // Rule 1: blocked domain → tracking
  if (isBlockedHost(sample.host)) {
    return {
      category: 'tracking',
      reasons: [`host ${sample.host} matches blocked-domains list`],
    }
  }

  // Rule 2: off-domain
  if (isOffDomain(sample.host, targetUrl, allowHosts)) {
    return {
      category: 'off_domain',
      reasons: [`host ${sample.host} is not within target domain or allow-list`],
    }
  }

  // Rule 3: blocked path → tracking
  if (isBlockedPath(sample.path)) {
    return {
      category: 'tracking',
      reasons: [`path ${sample.path} matches blocked-paths pattern`],
    }
  }

  // Rule 4: static content-type
  if (isStaticContentType(sample.contentType)) {
    return {
      category: 'static',
      reasons: [`content-type ${sample.contentType} indicates static asset`],
    }
  }

  // Rule 5: static file extension
  if (isStaticExtension(sample.path)) {
    return {
      category: 'static',
      reasons: [`path extension ${getPathExtension(sample.path)} indicates static asset`],
    }
  }

  // Rule 6: everything else → api
  return {
    category: 'api',
    reasons: ['default: no blocking/static rules matched'],
  }
}
