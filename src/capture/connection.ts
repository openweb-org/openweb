import { chromium, type Browser } from 'playwright'

import { OpenWebError } from '../lib/errors.js'

/** Sleep that can be aborted */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}

export async function connectWithRetry(
  cdpEndpoint: string,
  maxRetries = 3,
  signal?: AbortSignal,
): Promise<Browser> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: 'CDP connection aborted.',
        action: 'Retry the capture command.',
        retriable: true,
        failureClass: 'needs_browser',
      })
    }
    try {
      // Race connect against abort signal
      const browser = await (signal
        ? Promise.race([
            chromium.connectOverCDP(cdpEndpoint, { timeout: 30_000 }),
            new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            }),
          ])
        : chromium.connectOverCDP(cdpEndpoint, { timeout: 30_000 }))
      return browser
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'aborted' || signal?.aborted) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: 'CDP connection aborted.',
          action: 'Retry the capture command.',
          retriable: true,
          failureClass: 'needs_browser',
        })
      }
      if (attempt === maxRetries - 1) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `CDP connection failed after ${String(maxRetries)} attempts: ${message}`,
          action: 'Ensure Chrome is running with --remote-debugging-port. Example: google-chrome --remote-debugging-port=9222',
          retriable: true,
          failureClass: 'needs_browser',
        })
      }
      try {
        await abortableSleep(1000 * (attempt + 1), signal)
      } catch {
        // abort during sleep — throw abort error
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: 'CDP connection aborted.',
          action: 'Retry the capture command.',
          retriable: true,
          failureClass: 'needs_browser',
        })
      }
    }
  }
  throw new Error('unreachable')
}
