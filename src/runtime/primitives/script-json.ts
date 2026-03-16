import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle } from './types.js'

export interface ScriptJsonConfig {
  readonly selector: string
  readonly path?: string
}

/**
 * Resolve script_json extraction: find a <script> tag by selector,
 * parse its JSON content, and optionally traverse a path.
 */
export async function resolveScriptJson(
  handle: BrowserHandle,
  config: ScriptJsonConfig,
): Promise<unknown> {
  const { selector, path } = config

  const raw = await handle.page.evaluate((sel: string) => {
    const el = document.querySelector(sel)
    return el?.textContent ?? null
  }, selector)

  if (!raw) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Script element matching "${selector}" not found.`,
      action: 'Ensure the page is fully loaded.',
      retriable: true,
    })
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Script content is not valid JSON for selector "${selector}".`,
      action: 'Check the selector targets a JSON script tag.',
      retriable: false,
    })
  }

  if (path) {
    const segments = path.split('.')
    for (const segment of segments) {
      if (data === null || data === undefined || typeof data !== 'object') {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `Path "${path}" not found in script JSON.`,
          action: 'Verify the JSON structure.',
          retriable: false,
        })
      }
      data = (data as Record<string, unknown>)[segment]
    }
  }

  return data
}
