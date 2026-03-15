import type { BrowserContext, CDPSession, Page } from 'playwright'

import type { CaptureMetadata, DomExtraction, StateSnapshot } from './types.js'
import { writeCaptureBundle } from './bundle.js'
import { connectWithRetry } from './connection.js'
import { captureDomAndGlobals } from './dom-capture.js'
import { attachHarCapture, buildHarLog, type HarCapture } from './har-capture.js'
import { captureStateSnapshot } from './state-capture.js'
import { attachWsCapture, type WsCapture } from './ws-capture.js'

export interface CaptureSessionOptions {
  readonly cdpEndpoint: string
  readonly outputDir: string
  readonly onLog?: (message: string) => void
}

export interface CaptureSession {
  /** Resolves when the capture session is fully stopped and bundle is written */
  readonly done: Promise<void>
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

  let stopped = false
  let cdp: CDPSession | undefined
  const harCaptures: HarCapture[] = []
  let wsCapture: WsCapture | undefined

  const stateSnapshots: StateSnapshot[] = []
  const domExtractions: DomExtraction[] = []
  let navigationCount = 0
  let snapshotSeq = 0
  const startTime = new Date().toISOString()

  // Track in-flight async snapshot work so we can drain on stop
  const pendingSnapshots = new Set<Promise<void>>()

  async function takeSnapshots(
    page: Page,
    context: BrowserContext,
    trigger: StateSnapshot['trigger'],
    seq: number,
  ): Promise<void> {
    if (stopped) return
    try {
      const [state, dom] = await Promise.all([
        captureStateSnapshot(page, context, trigger),
        captureDomAndGlobals(page, trigger),
      ])
      if (stopped) return
      // Insert at sequence position to maintain navigation order (H3 fix)
      stateSnapshots.push({ ...state, _seq: seq } as StateSnapshot & { _seq: number })
      domExtractions.push({ ...dom, _seq: seq } as DomExtraction & { _seq: number })
      log(`  snapshot #${String(stateSnapshots.length)} (${trigger}) @ ${page.url()}`)
    } catch (err) {
      if (!stopped) {
        log(`  snapshot failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  function attachPageListeners(page: Page, context: BrowserContext): void {
    page.on('framenavigated', (frame) => {
      if (stopped || frame !== page.mainFrame()) return
      navigationCount++
      // Assign sequence number at event time, not completion time (H3 fix)
      const seq = snapshotSeq++
      const task = (async () => {
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
        } catch {
          // timeout — take snapshot anyway
        }
        await takeSnapshots(page, context, 'navigation', seq)
      })().catch(() => {})
      // Track for drain on stop (H2 fix)
      pendingSnapshots.add(task)
      void task.then(() => pendingSnapshots.delete(task))
    })
  }

  function detachAll(): void {
    for (const hc of harCaptures) hc.detach()
    wsCapture?.detach()
  }

  /** Wait for all in-flight HAR responses and snapshots to settle */
  async function drainPending(timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    // Drain snapshot promises
    if (pendingSnapshots.size > 0) {
      await Promise.race([
        Promise.allSettled([...pendingSnapshots]),
        new Promise((r) => setTimeout(r, timeoutMs)),
      ])
    }
    // Wait for in-flight HAR response handlers
    const remaining = Math.max(0, deadline - Date.now())
    const hasPending = () => harCaptures.some((hc) => hc.pendingCount() > 0)
    if (hasPending() && remaining > 0) {
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!hasPending() || Date.now() >= deadline) {
            clearInterval(interval)
            resolve()
          }
        }, 50)
      })
    }
  }

  async function writeBundle(): Promise<void> {
    const endTime = new Date().toISOString()

    // Sort snapshots/extractions by sequence number (H3 fix)
    type Sequenced<T> = T & { _seq?: number }
    const sortBySeq = <T>(arr: T[]): T[] =>
      [...arr].sort((a, b) => ((a as Sequenced<T>)._seq ?? 0) - ((b as Sequenced<T>)._seq ?? 0))

    const sortedSnapshots = sortBySeq(stateSnapshots)
    const sortedExtractions = sortBySeq(domExtractions)

    const allEntries = harCaptures.flatMap((hc) => hc.entries)
    const harLog = buildHarLog(allEntries)
    const wsFrames = wsCapture?.frames ?? []

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

  async function cleanup(): Promise<void> {
    try {
      await cdp?.detach()
    } catch {
      /* already detached */
    }
  }

  // Main capture loop
  void (async () => {
    try {
      log(`connecting to ${opts.cdpEndpoint} ...`)
      const browser = await connectWithRetry(opts.cdpEndpoint, 3, abortController.signal)
      const context = browser.contexts()[0]
      if (!context) throw new Error('No browser context found. Open a page in Chrome first.')

      const page = context.pages()[0]
      if (!page) throw new Error('No page found. Navigate to a URL in Chrome first.')

      log(`connected — capturing on: ${page.url()}`)

      // Attach all capture sources
      const mainHar = attachHarCapture(page)
      harCaptures.push(mainHar)
      cdp = await context.newCDPSession(page)
      wsCapture = await attachWsCapture(cdp)
      attachPageListeners(page, context)

      // Listen for new pages (tabs)
      context.on('page', (newPage) => {
        if (stopped) return
        log(`  new page detected: ${newPage.url()}`)
        const newHar = attachHarCapture(newPage)
        harCaptures.push(newHar)
        attachPageListeners(newPage, context)
      })

      // Initial snapshots
      const initialSeq = snapshotSeq++
      await takeSnapshots(page, context, 'initial', initialSeq)
      log('capture active — press Ctrl+C to stop')

      // Wait for stop signal
      await stopDfd.promise

      // Detach listeners first to prevent new work
      detachAll()

      // Drain in-flight async work before writing bundle (H2 fix)
      await drainPending()

      // Write bundle
      await writeBundle()
      await cleanup()
      completionDfd.resolve()
    } catch (err) {
      await cleanup()
      if (stopped) {
        try {
          await drainPending(1000)
          await writeBundle()
        } catch {
          /* best effort */
        }
        completionDfd.resolve()
      } else {
        const error = err instanceof Error ? err : new Error(String(err))
        log(`error: ${error.message}`)
        completionDfd.reject(error)
      }
    }
  })()

  return {
    done: completionDfd.promise,
    stop() {
      if (stopped) return
      stopped = true
      abortController.abort()
      stopDfd.resolve()
    },
  }
}
