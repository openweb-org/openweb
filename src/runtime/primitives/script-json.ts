import { OpenWebError } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'
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
      failureClass: 'retriable',
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
      failureClass: 'fatal',
    })
  }

  if (!path) {
    return data
  }

  const value = getValueAtPath(data, path)
  if (value === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Path "${path}" not found in script JSON.`,
      action: 'Verify the JSON structure.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return value
}
