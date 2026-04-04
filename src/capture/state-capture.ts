import type { BrowserContext, Page } from 'patchright'

import type { CookieEntry, StateSnapshot } from './types.js'

export async function captureStateSnapshot(
  page: Page,
  context: BrowserContext,
  trigger: StateSnapshot['trigger'],
): Promise<StateSnapshot> {
  const localStorage = await page.evaluate(() => {
    const data: Record<string, string> = {}
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key !== null) {
        data[key] = window.localStorage.getItem(key) ?? ''
      }
    }
    return data
  })

  const sessionStorage = await page.evaluate(() => {
    const data: Record<string, string> = {}
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (key !== null) {
        data[key] = window.sessionStorage.getItem(key) ?? ''
      }
    }
    return data
  })

  const rawCookies = await context.cookies()
  const cookies: CookieEntry[] = rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    expires: c.expires,
  }))

  return {
    timestamp: new Date().toISOString(),
    trigger,
    url: page.url(),
    localStorage,
    sessionStorage,
    cookies,
  }
}
