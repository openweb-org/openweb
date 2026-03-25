/**
 * Node-based SSR extraction: fetches pages via HTTP and parses embedded data.
 *
 * Used when an operation has `extraction.type: ssr_next_data` with
 * `transport: node` and no auth/csrf — avoids needing a browser.
 */
import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { validateSSRF } from '../lib/ssrf.js'
import { fetchWithRedirects } from './redirect.js'
import { getValueAtPath } from './value-path.js'
import type { ExtractionPrimitive } from '../types/primitives.js'
import type { ExecutorResult } from './executor-result.js'

export type { ExecutorResult }

const NEXT_DATA_START = '<script id="__NEXT_DATA__" type="application/json"'

function parseNextData(html: string): unknown {
  const tagStart = html.indexOf(NEXT_DATA_START)
  if (tagStart < 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: '__NEXT_DATA__ script tag not found in HTML response.',
      action: 'This page may not use Next.js SSR, or the response was blocked.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const jsonStart = html.indexOf('>', tagStart) + 1
  const jsonEnd = html.indexOf('</script>', jsonStart)
  if (jsonEnd < 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: '__NEXT_DATA__ script tag is malformed (no closing tag).',
      action: 'Inspect the raw HTML to understand the page structure.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  try {
    return JSON.parse(html.substring(jsonStart, jsonEnd)) as unknown
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: '__NEXT_DATA__ contains invalid JSON.',
      action: 'Inspect the raw HTML to understand the page structure.',
      retriable: false,
      failureClass: 'fatal',
    })
  }
}

export async function executeNodeSsr(
  url: string,
  extraction: Extract<ExtractionPrimitive, { type: 'ssr_next_data' }>,
  deps: { fetchImpl?: typeof fetch; ssrfValidator?: (url: string) => Promise<void> } = {},
): Promise<ExecutorResult> {
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF
  await ssrfValidator(url)

  const response = await fetchWithRedirects(
    url,
    'GET',
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    undefined,
    { fetchImpl: deps.fetchImpl ?? fetch, ssrfValidator },
  )

  if (!response.ok) {
    const httpFailure = getHttpFailure(response.status)
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `HTTP ${response.status} fetching ${url}`,
      action: 'Check the URL and parameters.',
      retriable: httpFailure.retriable,
      failureClass: httpFailure.failureClass,
    })
  }

  const html = await response.text()
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => { responseHeaders[key] = value })

  const nextData = parseNextData(html)
  const body = getValueAtPath(nextData, extraction.path)

  if (body === undefined) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Path "${extraction.path}" not found in __NEXT_DATA__.`,
      action: 'Update the fixture extraction path to match the current page payload.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  return { status: 200, body, responseHeaders }
}
