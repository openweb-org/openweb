import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface ExchangeStep {
  readonly call: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, string>>
  readonly extract: string
  readonly as?: string
  readonly expires_field?: string
}

export interface ExchangeChainConfig {
  readonly steps: readonly ExchangeStep[]
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly query?: string
  }
}

export interface ExchangeChainDeps {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
}

/**
 * Substitute `${varName}` template references in a string using extracted values.
 */
function substituteTemplates(value: string, extracted: ReadonlyMap<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key: string) => extracted.get(key) ?? `\${${key}}`)
}

/**
 * Resolve exchange_chain auth: execute a sequence of HTTP steps,
 * passing extracted values between steps, producing a final token.
 */
export async function resolveExchangeChain(
  handle: BrowserHandle,
  config: ExchangeChainConfig,
  serverUrl: string,
  deps: ExchangeChainDeps = {},
): Promise<ResolvedInjections> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const ssrfValidator = deps.ssrfValidator

  // Execute steps sequentially, accumulating extracted values
  const extracted = new Map<string, string>()
  let lastValue = ''

  for (const step of config.steps) {
    // Substitute templates in the step URL
    const stepUrl = substituteTemplates(step.call, extracted)

    // SSRF validation: validate each step URL before fetching
    if (ssrfValidator) {
      await ssrfValidator(stepUrl)
    }

    // Only send cookies matching this step's origin (not all origins merged)
    const stepOrigin = new URL(stepUrl).origin
    const originCookies = await handle.context.cookies(stepOrigin)
    const cookieString = originCookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    // Build headers, substituting templates from previously extracted values
    const headers: Record<string, string> = {}
    if (step.headers) {
      for (const [k, v] of Object.entries(step.headers)) {
        headers[k] = substituteTemplates(v, extracted)
      }
    }

    if (cookieString) {
      headers.Cookie = cookieString
    }

    // Build body if specified, substituting templates
    let body: string | undefined
    if (step.body) {
      const substituted: Record<string, string> = {}
      for (const [k, v] of Object.entries(step.body)) {
        substituted[k] = substituteTemplates(v, extracted)
      }
      body = new URLSearchParams(substituted).toString()
    }

    const response = await fetchImpl(stepUrl, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
    })

    if (!response.ok) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `Exchange chain step failed: ${stepUrl} returned ${response.status}`,
        action: 'Ensure you are logged in. The exchange endpoint may require fresh cookies.',
        retriable: true,
      })
    }

    let responseData: unknown
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('json')) {
      responseData = await response.json()
    } else {
      // Try to parse as JSON anyway, fall back to text
      const text = await response.text()
      try {
        responseData = JSON.parse(text)
      } catch {
        responseData = text
      }
    }

    // Extract value using dot-path from response
    const value = extractPath(responseData, step.extract)
    if (!value) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `Exchange chain: could not extract "${step.extract}" from ${stepUrl} response.`,
        action: 'The response structure may have changed. Re-capture the site.',
        retriable: true,
      })
    }

    lastValue = value
    extracted.set(step.as ?? step.extract, value)
  }

  // Build final injection
  const resultHeaders: Record<string, string> = {}
  if (config.inject.header) {
    resultHeaders[config.inject.header] = (config.inject.prefix ?? '') + lastValue
  }

  return { headers: resultHeaders }
}

function extractPath(data: unknown, path: string): string | undefined {
  const segments = path.split('.')
  let current: unknown = data

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[segment]
  }

  if (current === null || current === undefined) return undefined
  return String(current)
}
