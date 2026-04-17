import { OpenWebError } from '../../lib/errors.js'
import { parseScriptContent } from './script-json-parse.js'
import type { BrowserHandle } from './types.js'

export interface ScriptJsonConfig {
  readonly selector: string
  readonly path?: string
  readonly strip_comments?: boolean
}

/**
 * Resolve script_json extraction: find a <script> tag by selector,
 * parse its JSON content, and optionally traverse a path.
 */
export async function resolveScriptJson(
  handle: BrowserHandle,
  config: ScriptJsonConfig,
): Promise<unknown> {
  const { selector, path, strip_comments } = config

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

  return parseScriptContent(raw, selector, { path, stripComments: strip_comments })
}
