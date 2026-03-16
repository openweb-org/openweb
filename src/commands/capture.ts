import process from 'node:process'
import path from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'

import { OpenWebError } from '../lib/errors.js'
import { createCaptureSession } from '../capture/session.js'

const PID_FILE = '.openweb-capture.pid'

export interface CaptureStartOptions {
  readonly cdpEndpoint: string
  readonly output?: string
}

export async function captureStartCommand(opts: CaptureStartOptions): Promise<void> {
  const outputDir = opts.output ?? path.join(process.cwd(), 'capture')

  const session = createCaptureSession({
    cdpEndpoint: opts.cdpEndpoint,
    outputDir,
    onLog: (msg) => console.log(msg),
  })

  // Write PID file after session creation (not before, to avoid stale PID files)
  await writeFile(PID_FILE, String(process.pid))

  // Graceful shutdown on SIGINT / SIGTERM
  const onSignal = (): void => {
    console.log('\nstopping capture ...')
    session.stop()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    await session.done
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await rm(PID_FILE, { force: true })
  }
}

export async function captureStopCommand(): Promise<void> {
  let pid: number
  try {
    const raw = await readFile(PID_FILE, 'utf8')
    pid = Number.parseInt(raw.trim(), 10)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No active capture session found.',
      action: 'Start a capture first with: openweb capture start --cdp-endpoint <url>',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  try {
    process.kill(pid, 'SIGINT')
    console.log(`Sent stop signal to capture process (PID ${String(pid)}).`)
  } catch (err) {
    await rm(PID_FILE, { force: true })
    const message = err instanceof Error ? err.message : String(err)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Failed to stop capture: ${message}`,
      action: 'The capture process may have already exited.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}
