import type { Page, Request, Response } from 'playwright'

import type { HarEntry, HarLog } from './types.js'

// ── Analytics / tracking domains to filter out ──────────────────

const BLOCKED_DOMAINS = new Set([
  'google-analytics.com',
  'googletagmanager.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'hotjar.com',
  'sentry.io',
  'doubleclick.net',
  'facebook.net',
  'fbcdn.net',
  'criteo.com',
  'datadog-agent',
  'datadoghq.com',
  'newrelic.com',
  'nr-data.net',
  'fullstory.com',
  'clarity.ms',
  'optimizely.com',
  'launchdarkly.com',
  'intercom.io',
  'intercomcdn.com',
  'cdn.heapanalytics.com',
  'quantserve.com',
  'scorecardresearch.com',
  'rubiconproject.com',
  'adsrvr.org',
  'adnxs.com',
  'moatads.com',
  'taboola.com',
  'outbrain.com',
])

const API_CONTENT_TYPES = new Set([
  'application/json',
  'application/vnd.api+json',
  'text/json',
  'application/x-www-form-urlencoded',
  'application/graphql+json',
  'application/graphql-response+json',
])

const STATIC_ASSET_RE = /\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico|webp|avif|mp4|webm)$/

// ── Filtering ───────────────────────────────────────────────────

function isBlockedDomain(hostname: string): boolean {
  for (const domain of BLOCKED_DOMAINS) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true
  }
  return false
}

function shouldCapture(url: URL, contentType: string | null): boolean {
  if (isBlockedDomain(url.hostname)) return false
  if (STATIC_ASSET_RE.test(url.pathname)) return false
  if (contentType) {
    const base = contentType.split(';')[0]?.trim() ?? ''
    if (base && !API_CONTENT_TYPES.has(base)) return false
  }
  return true
}

// ── HAR capture ─────────────────────────────────────────────────

export interface HarCapture {
  readonly entries: HarEntry[]
  detach(): void
}

export function attachHarCapture(page: Page): HarCapture {
  const entries: HarEntry[] = []
  const pendingRequests = new Map<Request, { startedDateTime: string; startTime: number }>()

  const onRequest = (req: Request): void => {
    try {
      const url = new URL(req.url())
      if (isBlockedDomain(url.hostname) || STATIC_ASSET_RE.test(url.pathname)) return
      pendingRequests.set(req, { startedDateTime: new Date().toISOString(), startTime: Date.now() })
    } catch {
      // invalid URL — skip
    }
  }

  const onResponse = async (res: Response): Promise<void> => {
    const req = res.request()
    const pending = pendingRequests.get(req)
    if (!pending) return
    pendingRequests.delete(req)

    try {
      const url = new URL(req.url())
      const responseHeaders = await res.allHeaders()
      const contentType = responseHeaders['content-type'] ?? null

      if (!shouldCapture(url, contentType)) return

      let bodyText: string | undefined
      try {
        const body = await res.body()
        bodyText = body.toString('utf8')
      } catch {
        // body unavailable (e.g. streamed or aborted)
      }

      const requestHeaders = await req.allHeaders()

      entries.push({
        startedDateTime: pending.startedDateTime,
        time: Date.now() - pending.startTime,
        request: {
          method: req.method(),
          url: req.url(),
          headers: Object.entries(requestHeaders).map(([name, value]) => ({ name, value })),
          postData: req.postData() ?? undefined,
        },
        response: {
          status: res.status(),
          statusText: res.statusText(),
          headers: Object.entries(responseHeaders).map(([name, value]) => ({ name, value })),
          content: {
            size: bodyText?.length ?? 0,
            mimeType: contentType ?? '',
            text: bodyText,
          },
        },
      })
    } catch {
      // response processing failed — skip entry
    }
  }

  page.on('request', onRequest)
  page.on('response', onResponse)

  return {
    entries,
    detach() {
      page.removeListener('request', onRequest)
      page.removeListener('response', onResponse)
    },
  }
}

export function buildHarLog(entries: readonly HarEntry[]): HarLog {
  return {
    version: '1.2',
    creator: { name: 'openweb', version: '0.1.0' },
    entries: [...entries],
  }
}

/** Re-export filter for testing */
export { shouldCapture as shouldCaptureRequest, isBlockedDomain }
