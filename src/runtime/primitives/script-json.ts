import { OpenWebError } from '../../lib/errors.js'
import { parseScriptContent, parseScriptContents } from './script-json-parse.js'
import type { BrowserHandle } from './types.js'

export interface ScriptJsonConfig {
  readonly selector: string
  readonly path?: string
  readonly strip_comments?: boolean
  readonly type_filter?: string
  readonly multi?: boolean
}

/**
 * Resolve script_json extraction: find <script> tag(s) by selector,
 * parse JSON content, optionally filter by @type, and return either
 * the first match or an array (multi=true).
 */
export async function resolveScriptJson(
  handle: BrowserHandle,
  config: ScriptJsonConfig,
): Promise<unknown> {
  const { selector, path, strip_comments, type_filter, multi } = config

  if (type_filter || multi) {
    const raws = await handle.page.evaluate((sel: string) => {
      const els = document.querySelectorAll(sel)
      const out: string[] = []
      for (const el of Array.from(els)) {
        const t = el.textContent
        if (t) out.push(t)
      }
      return out
    }, selector)

    if (!raws || raws.length === 0) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Script element matching "${selector}" not found.`,
        action: 'Ensure the page is fully loaded.',
        retriable: true,
        failureClass: 'retriable',
      })
    }

    return parseScriptContents(raws, selector, {
      path,
      stripComments: strip_comments,
      typeFilter: type_filter,
      multi,
    })
  }

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
