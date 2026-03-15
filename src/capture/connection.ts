import { chromium, type Browser } from 'playwright'

import { OpenWebError } from '../lib/errors.js'

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
      })
    }
    try {
      return await chromium.connectOverCDP(cdpEndpoint, { timeout: 30_000 })
    } catch (err) {
      if (signal?.aborted) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: 'CDP connection aborted.',
          action: 'Retry the capture command.',
          retriable: true,
        })
      }
      if (attempt === maxRetries - 1) {
        const message = err instanceof Error ? err.message : String(err)
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `CDP connection failed after ${String(maxRetries)} attempts: ${message}`,
          action: 'Ensure Chrome is running with --remote-debugging-port. Example: google-chrome --remote-debugging-port=9222',
          retriable: true,
        })
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}
