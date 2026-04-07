import type { Page } from 'patchright'

import { OpenWebError, getHttpFailure } from './errors.js'

export interface PageFetchOptions {
  readonly url: string
  readonly method?: 'GET' | 'POST'
  readonly body?: string
  readonly headers?: Record<string, string>
  readonly credentials?: 'same-origin' | 'include'
  readonly timeout?: number
}

export interface PageFetchResult {
  readonly status: number
  readonly text: string
}

export interface GraphqlFetchOptions {
  readonly url: string
  readonly operationName: string
  readonly variables: Record<string, unknown>
  readonly hash?: string
  readonly query?: string
  readonly headers?: Record<string, string>
  readonly batched?: boolean
  readonly timeout?: number
}

const DEFAULT_TIMEOUT = 15_000

/**
 * Browser-context fetch with AbortController timeout.
 * Returns raw { status, text }. Throws OpenWebError on network failure.
 */
export async function pageFetch(page: Page, options: PageFetchOptions): Promise<PageFetchResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT

  const result = await page.evaluate(
    async (args: { url: string; method: string; body?: string; headers: Record<string, string>; credentials: string; timeout: number }) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), args.timeout)
      try {
        const resp = await fetch(args.url, {
          method: args.method,
          headers: args.headers,
          body: args.body,
          credentials: args.credentials as RequestCredentials,
          signal: controller.signal,
        })
        const text = await resp.text()
        return { status: resp.status, text }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return { status: 0, text: 'Request timed out' }
        }
        return { status: 0, text: String(err) }
      } finally {
        clearTimeout(timer)
      }
    },
    {
      url: options.url,
      method: options.method ?? 'POST',
      body: options.body,
      headers: options.headers ?? {},
      credentials: options.credentials ?? 'include',
      timeout,
    },
  )

  if (result.status === 0) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `pageFetch failed: ${result.text}`,
      action: 'Check network connectivity and URL.',
      retriable: true,
      failureClass: 'retriable',
    })
  }

  return result
}

/**
 * GraphQL fetch via pageFetch. Builds the request body (APQ hash or query),
 * calls pageFetch, checks for errors array, returns the `data` field.
 * Throws OpenWebError on GraphQL errors or HTTP failure.
 */
export async function graphqlFetch(page: Page, options: GraphqlFetchOptions): Promise<unknown> {
  const body: Record<string, unknown> = {
    operationName: options.operationName,
    variables: options.variables,
  }

  if (options.hash) {
    body.extensions = {
      persistedQuery: { version: 1, sha256Hash: options.hash },
    }
  } else if (options.query) {
    body.query = options.query
  }

  const payload = options.batched ? JSON.stringify([body]) : JSON.stringify(body)

  const result = await pageFetch(page, {
    url: options.url,
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    timeout: options.timeout,
  })

  if (result.status >= 400) {
    const failure = getHttpFailure(result.status)
    throw new OpenWebError({
      error: failure.failureClass === 'needs_login' ? 'auth' : 'execution_failed',
      code: failure.failureClass === 'needs_login' ? 'AUTH_FAILED' : 'EXECUTION_FAILED',
      message: `GraphQL ${options.operationName}: HTTP ${result.status}`,
      action: failure.failureClass === 'needs_login'
        ? 'Log in to the site and try again.'
        : 'Check parameters and endpoint availability.',
      retriable: failure.retriable,
      failureClass: failure.failureClass,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    throw OpenWebError.apiError(`GraphQL ${options.operationName}`, 'Response is not valid JSON')
  }

  const gqlResponse = options.batched
    ? (parsed as unknown[])[0] as Record<string, unknown>
    : parsed as Record<string, unknown>

  if (gqlResponse.errors && Array.isArray(gqlResponse.errors) && gqlResponse.errors.length > 0) {
    const firstError = gqlResponse.errors[0] as Record<string, unknown>
    throw OpenWebError.apiError(
      `GraphQL ${options.operationName}`,
      (firstError.message as string) ?? 'Unknown GraphQL error',
    )
  }

  return gqlResponse.data
}
