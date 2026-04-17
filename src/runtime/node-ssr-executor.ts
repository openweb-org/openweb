import { DEFAULT_USER_AGENT } from '../lib/config.js'
/**
 * Node-based extraction: fetches pages via HTTP and parses embedded data —
 * no browser required.
 *
 * Used when an operation has `extraction.type: ssr_next_data | script_json`
 * with `transport: node` and no auth/csrf.
 */
import { OpenWebError, getHttpFailure } from '../lib/errors.js'
import { validateSSRF } from '../lib/ssrf.js'
import type { ExtractionPrimitive } from '../types/primitives.js'
import type { ExecutorResult } from './executor-result.js'
import { parseScriptJson } from './primitives/script-json-parse.js'
import { fetchWithRedirects } from './redirect.js'
import { getValueAtPath } from './value-path.js'

export type { ExecutorResult }

const NEXT_DATA_START = '<script id="__NEXT_DATA__" type="application/json"'

export function parseNextData(html: string): unknown {
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

type NodeExtraction = Extract<ExtractionPrimitive, { type: 'ssr_next_data' | 'script_json' }>

function extractBody(html: string, extraction: NodeExtraction): unknown {
  if (extraction.type === 'ssr_next_data') {
    const nextData = parseNextData(html)
    const body = getValueAtPath(nextData, extraction.path)
    if (body === undefined) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Path "${extraction.path}" not found in __NEXT_DATA__.`,
        action: 'Update the site package extraction path to match the current page payload.',
        retriable: false,
        failureClass: 'fatal',
      })
    }
    return body
  }
  // script_json
  return parseScriptJson(html, extraction.selector, {
    path: extraction.path,
    stripComments: extraction.strip_comments,
  })
}

export async function executeNodeExtraction(
  url: string,
  extraction: NodeExtraction,
  deps: { fetchImpl?: typeof fetch; ssrfValidator?: (url: string) => Promise<void> } = {},
): Promise<ExecutorResult> {
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF
  await ssrfValidator(url)

  const response = await fetchWithRedirects(
    url,
    'GET',
    {
      'User-Agent': DEFAULT_USER_AGENT,
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

  const body = extractBody(html, extraction)
  return { status: 200, body, responseHeaders }
}
