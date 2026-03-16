import type { BrowserHandle, ResolvedInjections } from './types.js'

/**
 * Resolve cookie_session auth — extract all cookies from browser context
 * and format as a Cookie header string for HTTP requests.
 */
export async function resolveCookieSession(handle: BrowserHandle): Promise<ResolvedInjections> {
  const cookies = await handle.context.cookies()
  if (cookies.length === 0) {
    return { headers: {} }
  }

  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return { headers: {}, cookieString }
}
