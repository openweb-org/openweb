import { OpenWebError, getHttpFailure } from '../../lib/errors.js'
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
  readonly ssrfValidator: (url: string) => Promise<void>
  readonly authHeaders?: Readonly<Record<string, string>>
}

/**
 * Resolve api_response CSRF: fetch a token endpoint *inside the browser
 * context* via page.evaluate, so the response's Set-Cookie updates land in
 * the browser's cookie jar. The follow-up API call (also via page.evaluate)
 * then sees the freshly-rotated CSRF token and matching cookies in lock-step.
 *
 * Why: doing this fetch from node with cookies merely *copied* from the
 * browser leaves the rotated cookies stranded — token + stale cookies → 401.
 */
export async function resolveApiResponse(
  handle: BrowserHandle,
  config: ApiResponseConfig,
  _serverUrl: string,
  deps: ApiResponseDeps,
): Promise<ResolvedInjections> {
  await deps.ssrfValidator(config.endpoint)

  const result = await handle.page.evaluate(
    async (args: {
      endpoint: string
      method: string
      headers: Record<string, string>
    }) => {
      try {
        const resp = await fetch(args.endpoint, {
          method: args.method,
          headers: args.headers,
          credentials: 'include',
        })
        const text = await resp.text()
        return { ok: resp.ok, status: resp.status, text }
      } catch (err) {
        return { ok: false, status: 0, text: String(err) }
      }
    },
    {
      endpoint: config.endpoint,
      method: config.method ?? 'GET',
      headers: { Accept: 'application/json', ...(deps.authHeaders ?? {}) },
    },
  )

  if (!result.ok) {
    const httpFailure = getHttpFailure(result.status || 502)
    throw new OpenWebError({
      error: httpFailure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: httpFailure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `CSRF endpoint ${config.endpoint} returned ${result.status}`,
      action: httpFailure.failureClass === 'needs_login'
        ? 'Ensure you are logged in.'
        : 'Retry later or inspect the endpoint definition.',
      retriable: httpFailure.retriable,
      failureClass: httpFailure.failureClass,
    })
  }

  let responseData: unknown
  try {
    responseData = JSON.parse(result.text)
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
    ssrfValidator: ctx.deps.ssrfValidator,
    authHeaders: ctx.deps.authHeaders as Record<string, string> | undefined,
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
