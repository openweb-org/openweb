import { OpenWebError } from '../lib/errors.js'

const MAX_REDIRECTS = 5
const SENSITIVE_HEADERS = ['cookie', 'authorization', 'x-csrftoken', 'x-csrf-token']

export interface RedirectOptions {
  readonly fetchImpl: typeof fetch
  readonly ssrfValidator: (url: string) => Promise<void>
}

/**
 * Fetch with manual redirect following, SSRF validation per hop,
 * and CR-01 cross-origin sensitive header stripping.
 */
export async function fetchWithRedirects(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  opts: RedirectOptions,
): Promise<Response> {
  const originalOrigin = new URL(url).origin
  let currentUrl = url
  let currentMethod = method
  let currentBody = body

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    await opts.ssrfValidator(currentUrl)

    const response = await opts.fetchImpl(currentUrl, {
      method: currentMethod,
      headers,
      body: currentMethod !== 'GET' && currentMethod !== 'HEAD' ? currentBody : undefined,
      redirect: 'manual',
    })

    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new OpenWebError({
        error: 'execution_failed',
        code: 'EXECUTION_FAILED',
        message: 'Redirect response missing Location header.',
        action: 'Retry or inspect upstream endpoint behavior.',
        retriable: true,
        failureClass: 'retriable',
      })
    }

    const nextUrl = new URL(location, currentUrl)
    currentUrl = nextUrl.toString()

    // 301/302/303: rewrite to GET and drop body (matches native fetch behavior)
    // Only 307/308 preserve the original method
    if (response.status === 301 || response.status === 302 || response.status === 303) {
      currentMethod = 'GET'
      currentBody = undefined
    }

    // CR-01: Strip sensitive headers on cross-origin redirect
    if (nextUrl.origin !== originalOrigin) {
      for (const name of SENSITIVE_HEADERS) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === name) delete headers[key]
        }
      }
    }
  }

  throw new OpenWebError({
    error: 'execution_failed',
    code: 'EXECUTION_FAILED',
    message: `Too many redirects (>${MAX_REDIRECTS})`,
    action: 'Retry later or inspect endpoint redirects.',
    retriable: true,
    failureClass: 'retriable',
  })
}
