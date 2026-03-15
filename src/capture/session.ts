import type { Browser, BrowserContext, CDPSession, Page } from 'playwright'

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

export function createCaptureSession(opts: CaptureSessionOptions): CaptureSession {
  const log = opts.onLog ?? (() => {})

  // Two-phase signaling: stopSignal triggers shutdown, completionResolve marks "all done"
  let signalStop: () => void
  const stopSignal = new Promise<void>((resolve) => {
    signalStop = resolve
  })

  let completionResolve: () => void
  let completionReject: (err: Error) => void
  const done = new Promise<void>((resolve, reject) => {
    completionResolve = resolve
    completionReject = reject
  })

  let stopped = false
  let cdp: CDPSession | undefined
  const harCaptures: HarCapture[] = []
  let wsCapture: WsCapture | undefined

  const stateSnapshots: StateSnapshot[] = []
  const domExtractions: DomExtraction[] = []
  let navigationCount = 0
  const startTime = new Date().toISOString()

  async function takeSnapshots(page: Page, context: BrowserContext, trigger: StateSnapshot['trigger']): Promise<void> {
    if (stopped) return
    try {
      const [state, dom] = await Promise.all([
        captureStateSnapshot(page, context, trigger),
        captureDomAndGlobals(page, trigger),
      ])
      if (stopped) return // re-check after await (H1 fix)
      stateSnapshots.push(state)
      domExtractions.push(dom)
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
      // Fire-and-forget with .catch to prevent unhandled rejections (H2 fix)
      void (async () => {
        try {
          await page.waitForLoadState('domcontentloaded', { timeout: 10_000 })
        } catch {
          // timeout — take snapshot anyway
        }
        await takeSnapshots(page, context, 'navigation')
      })().catch(() => {})
    })
  }

  function detachAll(): void {
    for (const hc of harCaptures) hc.detach()
    wsCapture?.detach()
  }

  async function writeBundle(): Promise<void> {
    const endTime = new Date().toISOString()
    // Merge entries from all HAR captures (main page + new tabs)
    const allEntries = harCaptures.flatMap((hc) => hc.entries)
    const harLog = buildHarLog(allEntries)
    const wsFrames = wsCapture?.frames ?? []

    const wsConnectionIds = new Set<string>()
    for (const f of wsFrames) {
      if (f.type === 'open') wsConnectionIds.add(f.connectionId)
    }

    const metadata: CaptureMetadata = {
      siteUrl: stateSnapshots[0]?.url ?? 'unknown',
      startTime,
      endTime,
      pageCount: navigationCount + 1,
      requestCount: harLog.entries.length,
      wsConnectionCount: wsConnectionIds.size,
      snapshotCount: stateSnapshots.length,
      captureVersion: '0.1.0',
    }

    log(`\nwriting capture bundle to ${opts.outputDir} ...`)
    await writeCaptureBundle(opts.outputDir, { harLog, wsFrames, stateSnapshots, domExtractions, metadata })
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
    // Don't close the browser — we don't own it (design principle)
  }

  // Main capture loop
  void (async () => {
    try {
      log(`connecting to ${opts.cdpEndpoint} ...`)
      const browser = await connectWithRetry(opts.cdpEndpoint)
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

      // Listen for new pages (tabs) — track HAR captures for cleanup (C1/C2 fix)
      context.on('page', (newPage) => {
        if (stopped) return
        log(`  new page detected: ${newPage.url()}`)
        const newHar = attachHarCapture(newPage)
        harCaptures.push(newHar)
        attachPageListeners(newPage, context)
      })

      // Initial snapshots
      await takeSnapshots(page, context, 'initial')
      log('capture active — press Ctrl+C to stop')

      // Wait for stop signal
      await stopSignal

      // Detach all listeners
      detachAll()

      // Write bundle
      await writeBundle()
      await cleanup()
      completionResolve?.()
    } catch (err) {
      await cleanup()
      if (stopped) {
        try {
          await writeBundle()
        } catch {
          /* best effort */
        }
        completionResolve?.()
      } else {
        const error = err instanceof Error ? err : new Error(String(err))
        log(`error: ${error.message}`)
        completionReject?.(error)
      }
    }
  })()

  return {
    done,
    stop() {
      if (stopped) return
      stopped = true
      signalStop?.()
    },
  }
}
