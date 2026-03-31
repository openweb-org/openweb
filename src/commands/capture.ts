import process from 'node:process'
import crypto from 'node:crypto'
import path from 'node:path'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

import { OpenWebError } from '../lib/errors.js'
import { createCaptureSession } from '../capture/session.js'

const PID_PREFIX = '.openweb-capture-'
const PID_SUFFIX = '.pid'

function pidFilePath(sessionId: string): string {
  return `${PID_PREFIX}${sessionId}${PID_SUFFIX}`
}

function generateSessionId(): string {
  return crypto.randomBytes(4).toString('hex')
}

export interface CaptureStartOptions {
  readonly cdpEndpoint: string
  readonly output?: string
  readonly isolate?: boolean
  readonly url?: string
}

export async function captureStartCommand(opts: CaptureStartOptions): Promise<void> {
  if (opts.isolate && !opts.url) {
    throw new OpenWebError({
      error: 'invalid_params',
      code: 'INVALID_PARAMS',
      message: '--isolate requires --url <url>',
      action: 'Provide a URL: openweb capture start --isolate --url https://example.com --cdp-endpoint ...',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const sessionId = generateSessionId()
  const defaultDir = opts.isolate ? `capture-${sessionId}` : 'capture'
  const outputDir = opts.output ?? path.join(process.cwd(), defaultDir)

  // Print session ID first (stdout) so callers can capture it: SESSION=$(openweb capture start ...)
  process.stdout.write(`${sessionId}\n`)

  let isolatedPage: import('playwright').Page | undefined

  if (opts.isolate) {
    const browser = await chromium.connectOverCDP(opts.cdpEndpoint)
    const context = browser.contexts()[0]
    if (!context) throw new Error('No browser context found')
    isolatedPage = await context.newPage()
    await isolatedPage.goto(opts.url as string, { waitUntil: 'load', timeout: 30_000 })
  }

  const session = createCaptureSession({
    cdpEndpoint: opts.cdpEndpoint,
    outputDir,
    onLog: (msg) => process.stderr.write(`${msg}\n`),
    ...(isolatedPage ? { targetPage: isolatedPage, isolateToTargetPage: true } : {}),
  })

  const pidFile = pidFilePath(sessionId)
  await writeFile(pidFile, String(process.pid))

  const onSignal = (): void => {
    process.stderr.write('\nstopping capture ...\n')
    session.stop()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    await session.done
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (isolatedPage) {
      await Promise.race([isolatedPage.close().catch(() => {}), new Promise<void>((r) => setTimeout(r, 5_000))])
    }
    await rm(pidFile, { force: true })
  }
}

export interface CaptureStopOptions {
  readonly session?: string
}

export async function captureStopCommand(opts?: CaptureStopOptions): Promise<void> {
  let pidFile: string
  let sessionId: string

  if (opts?.session) {
    sessionId = opts.session
    pidFile = pidFilePath(sessionId)
  } else {
    // Find the single active session
    const files = (await readdir('.').catch(() => [] as string[]))
      .filter((f) => f.startsWith(PID_PREFIX) && f.endsWith(PID_SUFFIX))

    if (files.length === 0) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: 'No active capture session found.',
        action: 'Start a capture first with: openweb capture start --cdp-endpoint <url>',
        retriable: false,
        failureClass: 'fatal',
      })
    }

    if (files.length > 1) {
      const ids = files.map((f) => f.slice(PID_PREFIX.length, -PID_SUFFIX.length))
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Multiple capture sessions active: ${ids.join(', ')}`,
        action: 'Specify which session to stop: openweb capture stop --session <id>',
        retriable: false,
        failureClass: 'fatal',
      })
    }

    pidFile = files[0] as string
    sessionId = pidFile.slice(PID_PREFIX.length, -PID_SUFFIX.length)
  }

  let pid: number
  try {
    const raw = await readFile(pidFile, 'utf8')
    pid = Number.parseInt(raw.trim(), 10)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `No active capture session found for session ${sessionId}.`,
      action: 'Start a capture first with: openweb capture start --cdp-endpoint <url>',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  try {
    process.kill(pid, 'SIGINT')
    process.stdout.write(`Sent stop signal to capture process (PID ${String(pid)}, session ${sessionId}).\n`)
  } catch (err) {
    await rm(pidFile, { force: true })
    const message = err instanceof Error ? err.message : String(err)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Failed to stop capture session ${sessionId}: ${message}`,
      action: 'The capture process may have already exited.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}
