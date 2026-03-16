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

  // Get cookies from browser context for authenticating exchange requests
  const cookies = await handle.context.cookies(serverUrl)

  // Also get cookies for the exchange endpoint origins
  const allOrigins = new Set<string>()
  for (const step of config.steps) {
    try {
      allOrigins.add(new URL(step.call).origin)
    } catch { /* skip invalid URLs */ }
  }

  // Merge cookies from all relevant origins
  const allCookies = new Map<string, string>()
  for (const c of cookies) {
    allCookies.set(c.name, c.value)
  }
  for (const origin of allOrigins) {
    const originCookies = await handle.context.cookies(origin)
    for (const c of originCookies) {
      allCookies.set(c.name, c.value)
    }
  }

  const cookieString = Array.from(allCookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

  // Execute steps sequentially, accumulating extracted values
  const extracted = new Map<string, string>()
  let lastValue = ''

  for (const step of config.steps) {
    const headers: Record<string, string> = {
      ...step.headers,
    }

    // Always send cookies with exchange requests
    if (cookieString) {
      headers.Cookie = cookieString
    }

    // Build body if specified
    let body: string | undefined
    if (step.body) {
      body = new URLSearchParams(step.body as Record<string, string>).toString()
    }

    const response = await fetchImpl(step.call, {
      method: 'POST',
      headers,
      body,
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: `Exchange chain step failed: ${step.call} returned ${response.status}`,
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
        message: `Exchange chain: could not extract "${step.extract}" from ${step.call} response.`,
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
