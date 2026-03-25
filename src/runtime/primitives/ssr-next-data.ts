import { OpenWebError } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'
import type { BrowserHandle } from './types.js'

export interface SsrNextDataConfig {
  readonly path: string
}

export async function resolveSsrNextData(
  handle: BrowserHandle,
  config: SsrNextDataConfig,
): Promise<unknown> {
  const nextData = await handle.page.evaluate(() => {
    const globalData = (window as Window & { __NEXT_DATA__?: unknown }).__NEXT_DATA__
    if (globalData !== undefined) {
      return globalData
    }

    const script = document.querySelector('#__NEXT_DATA__')
    const raw = script?.textContent
    if (!raw) {
      return null
    }

    try {
      return JSON.parse(raw) as unknown
    } catch {
      // intentional: malformed __NEXT_DATA__ JSON in page context
      return null
    }
  })

  if (nextData === null || nextData === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: '__NEXT_DATA__ was not found on the current page.',
      action: 'Open the matching Next.js page and wait for it to finish loading.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  const value = getValueAtPath(nextData, config.path)
  if (value === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Path "${config.path}" was not found in __NEXT_DATA__.`,
      action: 'Update the fixture path to match the current Next.js payload.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return value
}
