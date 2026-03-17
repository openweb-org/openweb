import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle } from './types.js'

export interface HtmlSelectorConfig {
  readonly selectors: Readonly<Record<string, string>>
  readonly attribute?: string
  readonly multiple?: boolean
}

type RawSelectorResult = Readonly<Record<string, ReadonlyArray<string | null>>>

function normalizeSingle(result: RawSelectorResult): Record<string, string | null> {
  const normalized: Record<string, string | null> = {}
  for (const [field, values] of Object.entries(result)) {
    normalized[field] = values[0] ?? null
  }
  return normalized
}

function normalizeMultiple(result: RawSelectorResult): Array<Record<string, string | null>> {
  const maxLength = Math.max(...Object.values(result).map((values) => values.length))
  const rows: Array<Record<string, string | null>> = []

  for (let index = 0; index < maxLength; index += 1) {
    const row: Record<string, string | null> = {}
    let hasValue = false
    for (const [field, values] of Object.entries(result)) {
      const value = values[index] ?? null
      row[field] = value
      hasValue ||= value !== null
    }

    if (hasValue) {
      rows.push(row)
    }
  }

  return rows
}

export async function resolveHtmlSelector(
  handle: BrowserHandle,
  config: HtmlSelectorConfig,
): Promise<unknown> {
  const rawResult = await handle.page.evaluate(({ selectors, attribute }) => {
    const values: Record<string, Array<string | null>> = {}
    for (const [field, selector] of Object.entries(selectors)) {
      values[field] = Array.from(document.querySelectorAll(selector)).map((element) => {
        if (attribute) {
          return element.getAttribute(attribute)
        }

        const text = element.textContent?.trim() ?? ''
        return text.length > 0 ? text : null
      })
    }

    return values
  }, { selectors: config.selectors, attribute: config.attribute })

  const hasAnyMatch = Object.values(rawResult).some((values) => values.length > 0)
  if (!hasAnyMatch) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: 'No DOM elements matched the configured selectors.',
      action: 'Open the matching page and verify the selectors still exist.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  return config.multiple ? normalizeMultiple(rawResult) : normalizeSingle(rawResult)
}
