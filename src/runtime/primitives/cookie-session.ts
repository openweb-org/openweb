import type { BrowserHandle, ResolvedInjections } from './types.js'

/**
 * Resolve cookie_session auth — extract cookies for the target URL from browser context
 * and format as a Cookie header string for HTTP requests.
 */
export async function resolveCookieSession(handle: BrowserHandle, serverUrl: string): Promise<ResolvedInjections> {
  const cookies = await handle.context.cookies(serverUrl)
  if (cookies.length === 0) {
    return { headers: {} }
  }

  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  return { headers: {}, cookieString }
}

import { registerResolver } from './registry.js'
registerResolver('cookie_session', async (ctx) => resolveCookieSession(ctx.handle, ctx.serverUrl))
