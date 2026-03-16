import { OpenWebError } from '../../lib/errors.js'
import type { BrowserHandle, ResolvedInjections } from './types.js'

export interface MetaTagConfig {
  readonly name: string
  readonly header: string
}

/**
 * Resolve meta_tag CSRF: read <meta name="..." content="..."> from the page
 * and inject as a request header.
 */
export async function resolveMetaTag(
  handle: BrowserHandle,
  config: MetaTagConfig,
): Promise<ResolvedInjections> {
  const { name, header } = config

  const content = await handle.page.evaluate((metaName: string) => {
    // Use attribute selector with CSS.escape to prevent selector injection
    const escaped = CSS.escape(metaName)
    const meta = document.querySelector(`meta[name="${escaped}"]`)
    return meta?.getAttribute('content') ?? null
  }, name)

  if (!content) {
    throw new OpenWebError({
      error: 'auth',
      code: 'AUTH_FAILED',
      message: `Meta tag "${name}" not found in page. Ensure you are on the correct page.`,
      action: 'Navigate to the site in Chrome and retry.',
      retriable: true,
      failureClass: 'needs_login',
    })
  }

  return { headers: { [header]: content } }
}
