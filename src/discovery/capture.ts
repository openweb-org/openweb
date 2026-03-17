import os from 'node:os'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'

import type { Browser, Page } from 'playwright'

import { connectWithRetry } from '../capture/connection.js'
import { createCaptureSession } from '../capture/session.js'

export interface InteractiveCaptureOptions {
  /** CDP endpoint (e.g. http://localhost:9222) */
  readonly cdpEndpoint: string
  /** URL to navigate to */
  readonly targetUrl: string
  /** Duration to wait after network idle (ms). Default: 8000 */
  readonly captureDuration?: number
  /** Log callback */
  readonly onLog?: (message: string) => void
}

export interface InteractiveCaptureResult {
  /** Directory containing capture bundle (traffic.har, state_snapshots/, etc.) */
  readonly recordingDir: string
  /** Connected browser instance (for reuse in exploration) */
  readonly browser: Browser
  /** Active page (for reuse in exploration) */
  readonly page: Page
}

/**
 * Wait for network to become idle (no inflight requests for `quietMs`).
 */
async function waitForNetworkIdle(page: Page, quietMs = 2000, maxWaitMs = 15000): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: maxWaitMs })
  } catch {
    // Timeout is fine — some pages never fully idle
  }
  await new Promise((resolve) => setTimeout(resolve, quietMs))
}

/**
 * Interactive capture: connect to CDP, open a NEW page for the target URL,
 * attach capture to that specific page, navigate, then wait for idle.
 *
 * This avoids capturing credentials from an unrelated tab (CRITICAL fix).
 * The capture session's `ready` promise ensures listeners are attached
 * before navigation begins (no race condition).
 */
export async function interactiveCapture(opts: InteractiveCaptureOptions): Promise<InteractiveCaptureResult> {
  const log = opts.onLog ?? (() => {})
  const captureDuration = opts.captureDuration ?? 8000

  // Create output directory
  const recordingDir = await mkdtemp(path.join(os.tmpdir(), 'openweb-discover-'))

  // Step 1: Connect to browser and open a dedicated page for the target URL
  const browser = await connectWithRetry(opts.cdpEndpoint)
  const context = browser.contexts()[0]
  if (!context) throw new Error('No browser context found')

  // Open a new blank page — this is the page we'll capture on
  const page = await context.newPage()

  // Step 2: Start capture session attached to our specific page only
  const session = createCaptureSession({
    cdpEndpoint: opts.cdpEndpoint,
    outputDir: recordingDir,
    targetPage: page,
    isolateToTargetPage: true,
    onLog: log,
  })

  // Step 3: Wait for capture to be ready (listeners attached) — no fixed sleep
  await session.ready

  // Step 4: Navigate — this triggers API calls that get captured
  log(`navigating to ${opts.targetUrl}`)
  try {
    await page.goto(opts.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  } catch (err) {
    // Navigation timeout is ok — page might be slow
    log(`navigation warning: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Step 5: Wait for network idle + additional capture time
  log('waiting for page load ...')
  await waitForNetworkIdle(page)

  log(`capturing for ${String(captureDuration / 1000)}s ...`)
  await new Promise((resolve) => setTimeout(resolve, captureDuration))

  // Step 6: Stop capture
  log('stopping capture ...')
  session.stop()
  await session.done

  return { recordingDir, browser, page }
}
