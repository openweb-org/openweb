import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

interface CookieToHeaderConfig {
  readonly cookie: string
  readonly header: string
}

/**
 * Resolve cookie_to_header CSRF — read a specific cookie value from browser
 * and inject it as a request header.
 */
export async function resolveCookieToHeader(
  handle: BrowserHandle,
  config: CookieToHeaderConfig,
  serverUrl: string,
): Promise<ResolvedInjections> {
  const cookies = await handle.context.cookies(serverUrl)
  const match = cookies.find((c) => c.name === config.cookie)

  if (!match) {
    throw new OpenWebError({
      error: 'execution_failed',
      code: 'EXECUTION_FAILED',
      message: `CSRF cookie not found: ${config.cookie}`,
      action: 'Ensure you are logged in to the site in Chrome.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  return {
    headers: { [config.header]: match.value },
  }
}
