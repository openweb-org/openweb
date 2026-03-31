import type { Page, Request, Response } from 'playwright'

import { logger } from '../lib/logger.js'
import type { HarEntry, HarLog } from './types.js'

// ── Body size gate ──────────────────────────────────────────────

const MAX_BODY_SIZE = 1_048_576 // 1 MB — bodies larger than this are omitted (metadata still recorded)

// ── HAR capture ─────────────────────────────────────────────────

export interface HarCapture {
  readonly entries: HarEntry[]
  /** Number of in-flight requests (awaiting response) + async response handlers */
  readonly pendingCount: () => number
  /** Resolves when all in-flight response handlers complete (or timeout) */
  drain(timeoutMs?: number): Promise<void>
  detach(): void
}

export function attachHarCapture(page: Page): HarCapture {
  const entries: HarEntry[] = []
  const pendingRequests = new Map<Request, { startedDateTime: string; startTime: number }>()
  const pendingResponses = new Set<Promise<void>>()

  const onRequest = (req: Request): void => {
    try {
      pendingRequests.set(req, { startedDateTime: new Date().toISOString(), startTime: Date.now() })
    } catch {
      // intentional: invalid URL from browser
    }
  }

  const onResponse = (res: Response): void => {
    const req = res.request()
    const pending = pendingRequests.get(req)
    if (!pending) return
    pendingRequests.delete(req)

    const task = (async () => {
      try {
        const responseHeaders = await res.allHeaders()
        const contentType = responseHeaders['content-type'] ?? null

        let bodyText: string | undefined
        try {
          const body = await res.body()
          if (body.length <= MAX_BODY_SIZE) {
            bodyText = body.toString('utf8')
          }
          // If body > MAX_BODY_SIZE, bodyText stays undefined — metadata still recorded
        } catch {
          // intentional: body unavailable (streamed, aborted, or redirected)
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
      } catch (err) {
        logger.debug(`HAR response processing failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()
    pendingResponses.add(task)
    void task.then(() => pendingResponses.delete(task))
  }

  const onRequestFailed = (req: Request): void => {
    pendingRequests.delete(req)
  }

  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onRequestFailed)

  return {
    entries,
    pendingCount: () => pendingRequests.size + pendingResponses.size,
    drain(timeoutMs = 3000): Promise<void> {
      if (pendingResponses.size === 0) return Promise.resolve()
      return Promise.race([
        Promise.allSettled([...pendingResponses]).then(() => {}),
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
      ])
    },
    detach() {
      page.removeListener('request', onRequest)
      page.removeListener('response', onResponse)
      page.removeListener('requestfailed', onRequestFailed)
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
