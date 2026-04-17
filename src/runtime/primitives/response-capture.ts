import type { Response as PwResponse } from 'patchright'

import { OpenWebError } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'
import type { PageWaitUntil } from '../page-plan.js'
import type { BrowserHandle } from './types.js'

export interface ResponseCaptureConfig {
  readonly match_url: string
  readonly unwrap?: string
}

export interface ResponseCaptureOptions {
  readonly navigateUrl: string
  readonly navTimeoutMs: number
  readonly waitUntil?: PageWaitUntil
}

/**
 * Convert a simple glob pattern (with * wildcards) to a RegExp. Matches the
 * whole string. Other regex metacharacters are escaped.
 */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * Navigate to a URL and return the first network response whose URL matches
 * the configured glob. The listener is installed BEFORE navigation so fast
 * responses that fire before page.goto resolves are not missed.
 */
export async function resolveResponseCapture(
  handle: BrowserHandle,
  config: ResponseCaptureConfig,
  options: ResponseCaptureOptions,
): Promise<unknown> {
  const { page } = handle
  const { navigateUrl, navTimeoutMs } = options
  const waitUntil = options.waitUntil ?? 'load'
  const matcher = globToRegExp(config.match_url)

  let captured: { body: unknown } | null = null
  let resolveWaiter: (() => void) | null = null
  const matchPromise = new Promise<void>((resolve) => {
    resolveWaiter = resolve
  })

  const handler = async (resp: PwResponse) => {
    if (captured) return
    if (!matcher.test(resp.url())) return
    try {
      const body = await resp.json()
      captured = { body }
      resolveWaiter?.()
    } catch {
      // Non-JSON or body-unavailable response — ignore and keep waiting.
    }
  }

  page.on('response', handler)

  try {
    const navPromise = page.goto(navigateUrl, { waitUntil, timeout: navTimeoutMs }).catch(() => {})
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('response_capture: timeout')), navTimeoutMs)
    })
    await Promise.race([matchPromise, Promise.all([navPromise, matchPromise]), timeoutPromise]).catch(() => {})
  } finally {
    page.off('response', handler)
  }

  const result = captured as { body: unknown } | null
  if (!result) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `response_capture: no response matched "${config.match_url}" within ${navTimeoutMs}ms`,
      action: 'Verify match_url glob pattern and that the page issues a matching request on load.',
      retriable: true,
      failureClass: 'needs_page',
    })
  }

  return config.unwrap ? getValueAtPath(result.body, config.unwrap) : result.body
}
