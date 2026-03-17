import { OpenWebError, getHttpFailure } from '../../lib/errors.js'
import { validateSSRF } from '../../lib/ssrf.js'
import { fetchWithRedirects } from '../redirect.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface ApiResponseConfig {
  readonly endpoint: string
  readonly method?: string
  readonly extract: string
  readonly inject: {
    readonly header?: string
    readonly prefix?: string
    readonly json_body_path?: string
  }
}

export interface ApiResponseDeps {
  readonly fetchImpl?: typeof fetch
  readonly ssrfValidator?: (url: string) => Promise<void>
  readonly authHeaders?: Readonly<Record<string, string>>
  readonly cookieString?: string
}

/**
 * Resolve api_response CSRF: call an API endpoint, extract a token from
 * the response, and inject it as a header.
 */
export async function resolveApiResponse(
  handle: BrowserHandle,
  config: ApiResponseConfig,
  serverUrl: string,
  deps: ApiResponseDeps = {},
): Promise<ResolvedInjections> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const ssrfValidator = deps.ssrfValidator ?? validateSSRF

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  // Include auth headers from prior auth resolution
  if (deps.authHeaders) {
    Object.assign(headers, deps.authHeaders)
  }

  // Include cookies
  if (deps.cookieString) {
    headers.Cookie = deps.cookieString
  } else {
    // Get cookies from browser context
    const cookies = await handle.context.cookies(config.endpoint)
    if (cookies.length > 0) {
      headers.Cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    }
  }

  const response = await fetchWithRedirects(
    config.endpoint,
    config.method ?? 'GET',
    headers,
    undefined,
    { fetchImpl, ssrfValidator },
  )

  if (!response.ok) {
    const httpFailure = getHttpFailure(response.status)
    throw new OpenWebError({
      error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `CSRF endpoint ${config.endpoint} returned ${response.status}`,
      action: httpFailure.failureClass === 'needs_login'
        ? 'Ensure you are logged in.'
        : 'Retry later or inspect the endpoint definition.',
      retriable: httpFailure.retriable,
      failureClass: httpFailure.failureClass,
    })
  }

  let responseData: unknown
  try {
    responseData = await response.json()
  } catch {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `CSRF endpoint ${config.endpoint} returned non-JSON response.`,
      action: 'Check the endpoint.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  // Extract value using dot-path
  const value = extractPath(responseData, config.extract)
  if (!value) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `Could not extract "${config.extract}" from ${config.endpoint} response.`,
      action: 'The response structure may have changed.',
      retriable: false,
      failureClass: 'fatal',
    })
  }

  const resultHeaders: Record<string, string> = {}
  if (config.inject.header) {
    resultHeaders[config.inject.header] = (config.inject.prefix ?? '') + value
  }

  return { headers: resultHeaders }
}

import { registerResolver } from './registry.js'
registerResolver('api_response', async (ctx, config) =>
  resolveApiResponse(ctx.handle, config as unknown as Parameters<typeof resolveApiResponse>[1], ctx.serverUrl, {
    fetchImpl: ctx.deps?.fetchImpl,
    ssrfValidator: ctx.deps?.ssrfValidator,
    authHeaders: ctx.deps?.authHeaders as Record<string, string> | undefined,
    cookieString: ctx.deps?.cookieString,
  }))

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
