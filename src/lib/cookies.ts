/** Format browser cookies into a Cookie header string. */
export function formatCookieString(cookies: ReadonlyArray<{ name: string; value: string }>): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}
