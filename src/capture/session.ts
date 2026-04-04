import type { Browser, BrowserContext, CDPSession, Page } from 'patchright'

import { logger } from '../lib/logger.js'
import { ensureBrowser, touchLastUsed } from '../runtime/browser-lifecycle.js'
import type { BrowserHandle } from '../runtime/browser-lifecycle.js'
import { writeCaptureBundle } from './bundle.js'
import { captureDomAndGlobals } from './dom-capture.js'
import { type HarCapture, attachHarCapture, buildHarLog } from './har-capture.js'
import { captureStateSnapshot } from './state-capture.js'
import type { CaptureMetadata, DomExtraction, StateSnapshot } from './types.js'
import { type WsCapture, attachWsCapture } from './ws-capture.js'

export interface CaptureSessionOptions {
  readonly cdpEndpoint?: string
  readonly outputDir: string
  readonly onLog?: (message: string) => void
  /** If provided, capture attaches to this specific page instead of pages()[0] */
  readonly targetPage?: Page
  /** If true, only record traffic from the target page — ignore other tabs */
  readonly isolateToTargetPage?: boolean
}

export interface CaptureSession {
  /** Resolves when the capture session is fully stopped and bundle is written */
  readonly done: Promise<void>
  /** Resolves when listeners are attached and capture is actively recording */
  readonly ready: Promise<void>
  /** Gracefully stop capture and write the bundle */
  stop(): void
}

/** Deferred promise — avoids TS2454 definite-assignment issues */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function createCaptureSession(opts: CaptureSessionOptions): CaptureSession {
  const log = opts.onLog ?? (() => {})
  const abortController = new AbortController()

  const stopDfd = deferred()
  const completionDfd = deferred()
  const readyDfd = deferred()

  let stopped = false
  let draining = false

  // Resource tracking for cleanup
  let handleRef: BrowserHandle | undefined
  let browserRef: Browser | undefined
  let contextRef: BrowserContext | undefined
  let onNewPageHandler: ((page: Page) => void) | undefined
  const cdpSessions: CDPSession[] = []
  const harCaptures: HarCapture[] = []
  const wsCaptures: WsCapture[] = []
  const pageListenerCleanups: Array<() => void> = []

  const stateSnapshots: StateSnapshot[] = []
  const domExtractions: DomExtraction[] = []
  let navigationCount = 0
  let snapshotSeq = 0
  const startTime = new Date().toISOString()

  // Keep-alive: touch last-used every 60s to prevent watchdog from killing Chrome
  const keepAliveTimer = setInterval(() => touchLastUsed().catch(() => {}), 60_000)

  // Track in-flight async snapshot work so we can drain on stop
  const pendingSnapshots = new Set<Promise<void>>()

  async function takeSnapshots(
    page: Page,
    context: BrowserContext,
    trigger: StateSnapshot['trigger'],
    seq: number,
    urlAtEvent: string,
  ): Promise<void> {
    // During drain, allow in-flight work to complete (don't discard)
    // Only reject new work after drain is done (detachAll already prevents new events)
    if (stopped && !draining) return
    try {
      // If the page has already navigated away from the URL that triggered this
      // snapshot, the DOM/storage belongs to a different document — skip to avoid
      // mislabeling (H3: rapid redirect correctness)
      if (trigger === 'navigation' && page.url() !== urlAtEvent) {
        log(`  snapshot skipped (page already navigated away from ${urlAtEvent})`)
        return
      }
      const [state, dom] = await Promise.all([
        captureStateSnapshot(page, context, trigger),
        captureDomAndGlobals(page, trigger),
      ])
      // Use URL captured at event time, not current page URL (H3 fix)
      const stateWithSeq = { ...state, url: urlAtEvent, _seq: seq } as StateSnapshot & { _seq: number }
      const domWithSeq = { ...dom, url: urlAtEvent, _seq: seq } as DomExtraction & { _seq: number }
      stateSnapshots.push(stateWithSeq)
      domExtractions.push(domWithSeq)
      log(`  snapshot #${String(stateSnapshots.length)} (${trigger}) @ ${urlAtEvent}`)
    } catch (err) {
      if (!stopped) {
        log(`  snapshot failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /** Attach framenavigated listener; returns cleanup function (Leak #2 fix) */
  function attachPageListeners(page: Page, context: BrowserContext): () => void {
    const handler = (frame: { url(): string }): void => {
      if (stopped || frame !== page.mainFrame()) return
      navigationCount++
      const seq = snapshotSeq++
      const urlAtEvent = page.url()
      const task = (async () => {
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
        } catch {
          // intentional: timeout — take snapshot with whatever DOM state is available
        }
        await takeSnapshots(page, context, 'navigation', seq, urlAtEvent)
      })().catch(() => {}) // intentional: errors handled inside takeSnapshots — prevent unhandled rejection
      pendingSnapshots.add(task)
      void task.then(() => pendingSnapshots.delete(task))
    }
    page.on('framenavigated', handler)
    return () => page.removeListener('framenavigated', handler)
  }

  function detachAll(): void {
    for (const hc of harCaptures) hc.detach()
    for (const wc of wsCaptures) wc.detach()
    // Leak #2: detach framenavigated listeners
    for (const cleanup of pageListenerCleanups) cleanup()
    // Leak #1: detach context.on('page') listener
    if (onNewPageHandler && contextRef) {
      contextRef.removeListener('page', onNewPageHandler)
    }
  }

  /** Wait for all in-flight HAR responses and snapshots to settle */
  async function drainPending(timeoutMs = 3000): Promise<void> {
    draining = true
    try {
      const deadline = Date.now() + timeoutMs
      // Drain snapshot promises
      if (pendingSnapshots.size > 0) {
        await Promise.race([
          Promise.allSettled([...pendingSnapshots]),
          new Promise((r) => setTimeout(r, timeoutMs)),
        ])
      }
      // Leak #4: await tracked HAR response promises instead of polling
      const remaining = Math.max(0, deadline - Date.now())
      if (remaining > 0) {
        await Promise.allSettled(harCaptures.map((hc) => hc.drain(remaining)))
      }
    } finally {
      draining = false
    }
  }

  async function writeBundle(): Promise<void> {
    const endTime = new Date().toISOString()

    // Sort snapshots/extractions by sequence number
    type Sequenced<T> = T & { _seq?: number }
    const sortBySeq = <T>(arr: T[]): T[] =>
      [...arr].sort((a, b) => ((a as Sequenced<T>)._seq ?? 0) - ((b as Sequenced<T>)._seq ?? 0))

    const sortedSnapshots = sortBySeq(stateSnapshots)
    const sortedExtractions = sortBySeq(domExtractions)

    const allEntries = harCaptures.flatMap((hc) => hc.entries)
    const harLog = buildHarLog(allEntries)
    const wsFrames = wsCaptures.flatMap((wc) => wc.frames)

    const wsConnectionIds = new Set<string>()
    for (const f of wsFrames) {
      if (f.type === 'open') wsConnectionIds.add(f.connectionId)
    }

    const metadata: CaptureMetadata = {
      siteUrl: sortedSnapshots[0]?.url ?? 'unknown',
      startTime,
      endTime,
      pageCount: navigationCount + 1,
      requestCount: harLog.entries.length,
      wsConnectionCount: wsConnectionIds.size,
      snapshotCount: sortedSnapshots.length,
      captureVersion: '0.1.0',
    }

    log(`\nwriting capture bundle to ${opts.outputDir} ...`)
    await writeCaptureBundle(opts.outputDir, {
      harLog,
      wsFrames,
      stateSnapshots: sortedSnapshots,
      domExtractions: sortedExtractions,
      metadata,
    })
    log(
      `done — ${String(metadata.requestCount)} requests, ${String(metadata.wsConnectionCount)} ws connections, ${String(metadata.snapshotCount)} snapshots`,
    )
  }

  /** Leak #3: detach all CDP sessions and disconnect browser */
  async function cleanup(): Promise<void> {
    clearInterval(keepAliveTimer)
    for (const session of cdpSessions) {
      try {
        await session.detach()
      } catch {
        // intentional: already detached — safe to ignore
      }
    }
    try {
      if (handleRef) await handleRef.release()
      else await browserRef?.close().catch(() => {})
    } catch {
      // intentional: already disconnected — safe to ignore
    }
  }

  // Main capture loop
  void (async () => {
    try {
      log(`connecting to ${opts.cdpEndpoint ?? 'managed browser'} ...`)
      const handle = await ensureBrowser(opts.cdpEndpoint)
      handleRef = handle
      const browser = handle.browser
      browserRef = browser
      const context = browser.contexts()[0]
      if (!context) throw new Error('No browser context found. Open a page in Chrome first.')
      contextRef = context

      // Use targetPage if provided, otherwise fall back to first page
      const page = opts.targetPage ?? context.pages()[0]
      if (!page) throw new Error('No page found. Navigate to a URL in Chrome first.')

      log(`connected — capturing on: ${page.url()}`)

      // Attach all capture sources
      const mainHar = attachHarCapture(page)
      harCaptures.push(mainHar)
      const cdp = await context.newCDPSession(page)
      cdpSessions.push(cdp)
      const initialWs = await attachWsCapture(cdp)
      wsCaptures.push(initialWs)
      const initialCleanup = attachPageListeners(page, context)
      pageListenerCleanups.push(initialCleanup)

      // Listen for new pages (tabs) — skip if isolating to target page
      if (!opts.isolateToTargetPage) {
        // Leak #1 fix: store handler reference for detach
        // Leak #5 fix: attach WS capture for new pages too
        onNewPageHandler = (newPage: Page): void => {
          if (stopped) return
          log(`  new page detected: ${newPage.url()}`)
          const newHar = attachHarCapture(newPage)
          harCaptures.push(newHar)
          const cleanup = attachPageListeners(newPage, context)
          pageListenerCleanups.push(cleanup)
          // Attach WS capture for new page via CDP session
          void (async () => {
            try {
              const newCdp = await context.newCDPSession(newPage)
              cdpSessions.push(newCdp)
              const newWs = await attachWsCapture(newCdp)
              wsCaptures.push(newWs)
            } catch (err) {
              logger.debug(`CDP session for new page failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          })()
        }
        context.on('page', onNewPageHandler)
      }

      // Signal that capture is ready — listeners are attached
      readyDfd.resolve()

      // Initial snapshots
      const initialSeq = snapshotSeq++
      await takeSnapshots(page, context, 'initial', initialSeq, page.url())
      log('capture active — press Ctrl+C to stop')

      // Wait for stop signal
      await stopDfd.promise

      // Drain in-flight work BEFORE detaching listeners (H2 fix)
      // This allows pending response events to still fire during drain
      await drainPending()

      // Now detach listeners — no new events after this point
      detachAll()

      // Write bundle
      await writeBundle()
      await cleanup()
      completionDfd.resolve()
    } catch (err) {
      await cleanup()
      const error = err instanceof Error ? err : new Error(String(err))
      // Reject ready if not yet resolved (connection failed before attach)
      readyDfd.reject(error)
      if (stopped) {
        try {
          await drainPending(1000)
          detachAll()
          await writeBundle()
        } catch {
          // intentional: best-effort bundle write during error recovery
        }
        completionDfd.resolve()
      } else {
        log(`error: ${error.message}`)
        completionDfd.reject(error)
      }
    }
  })()

  return {
    done: completionDfd.promise,
    ready: readyDfd.promise,
    stop() {
      if (stopped) return
      stopped = true
      abortController.abort()
      stopDfd.resolve()
    },
  }
}
