import { OpenWebError, getHttpFailure } from '../../lib/errors.js'
import { getValueAtPath } from '../value-path.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface ExchangeStep {
  readonly call: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, string>>
  readonly extract: string
  readonly extract_from?: 'body' | 'cookie'
  readonly as?: string
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
  readonly ssrfValidator: (url: string) => Promise<void>
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
  _serverUrl: string,
  deps: ExchangeChainDeps,
): Promise<ResolvedInjections & { queryParams?: Readonly<Record<string, string>> }> {
  const { fetchImpl = fetch, ssrfValidator } = deps

  // Execute steps sequentially, accumulating extracted values
  const extracted = new Map<string, string>()
  let lastValue = ''

  for (const step of config.steps) {
    // Substitute templates in the step URL
    const stepUrl = substituteTemplates(step.call, extracted)

    // SSRF validation: validate each step URL before fetching
    await ssrfValidator(stepUrl)

    // Only send cookies matching this step's origin (not all origins merged)
    const stepOrigin = new URL(stepUrl).origin
    const originCookies = await handle.context.cookies(stepOrigin)

    // Cookie-only step: read a cookie value without making an HTTP request
    if (step.extract_from === 'cookie') {
      const cookie = originCookies.find((c) => c.name === step.extract)
      if (!cookie) {
        throw new OpenWebError({
          error: 'execution_failed',
          code: 'EXECUTION_FAILED',
          message: `Exchange chain: cookie "${step.extract}" not found for ${stepOrigin}.`,
          action: 'Ensure you are logged in. The required cookie may be missing.',
          retriable: true,
          failureClass: 'needs_login',
        })
      }
      lastValue = cookie.value
      extracted.set(step.as ?? step.extract, lastValue)
      continue
    }

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
      method: (step.method ?? 'POST').toUpperCase(),
      headers,
      body,
      redirect: 'manual',
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      throw new OpenWebError({
        error: 'auth',
        code: 'AUTH_FAILED',
        message: location
          ? `Exchange chain step redirected to ${location}`
          : `Exchange chain step redirected with HTTP ${response.status}`,
        action: 'Ensure you are logged in. The exchange endpoint may require fresh cookies.',
        retriable: true,
        failureClass: 'needs_login',
      })
    }

    if (!response.ok) {
      const httpFailure = getHttpFailure(response.status)
      throw new OpenWebError({
        error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
        code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
        message: `Exchange chain step failed: ${stepUrl} returned ${response.status}`,
        action: httpFailure.failureClass === 'needs_login'
          ? 'Ensure you are logged in. The exchange endpoint may require fresh cookies.'
          : 'Retry later or inspect the exchange endpoint definition.',
        retriable: httpFailure.retriable,
        failureClass: httpFailure.failureClass,
      })
    }

    // Extract value from response body using dot-path
    let responseData: unknown
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('json')) {
      responseData = await response.json()
    } else {
      const text = await response.text()
      try {
        responseData = JSON.parse(text)
      } catch {
        responseData = text
      }
    }
    const value = getValueAtPath(responseData, step.extract)
    if (value === undefined || value === null) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: `Exchange chain: could not extract "${step.extract}" from ${stepUrl} response.`,
        action: 'The response structure may have changed. Re-capture the site.',
        retriable: false,
        failureClass: 'fatal',
      })
    }

    lastValue = String(value)
    extracted.set(step.as ?? step.extract, lastValue)
  }

  // Build final injection
  const resultHeaders: Record<string, string> = {}
  const queryParams: Record<string, string> = {}
  if (config.inject.header) {
    resultHeaders[config.inject.header] = (config.inject.prefix ?? '') + lastValue
  }
  if (config.inject.query) {
    queryParams[config.inject.query] = lastValue
  }

  return {
    headers: resultHeaders,
    ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
  }
}

import { registerResolver } from './registry.js'
registerResolver('exchange_chain', async (ctx, config) =>
  resolveExchangeChain(ctx.handle, config as unknown as Parameters<typeof resolveExchangeChain>[1], ctx.serverUrl, {
    fetchImpl: ctx.deps.fetchImpl,
    ssrfValidator: ctx.deps.ssrfValidator,
  }))
