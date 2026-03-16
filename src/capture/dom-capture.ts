import type { Page } from 'playwright'

import type { DomExtraction } from './types.js'

const KNOWN_GLOBALS = [
  '__NEXT_DATA__',
  '__NUXT__',
  '__NUXT_DATA__',
  '__APOLLO_STATE__',
  '__APOLLO_CLIENT__',
  '__PRELOADED_STATE__',
  '__UNIVERSAL_DATA_FOR_REHYDRATION__',
  'ytcfg',
  '__context__',
  '__initialData',
  'PRELOADED',
  'netflix',
  'StackExchange',
  'initData',
  'bootstrap',
  'POSTHOG_APP_CONTEXT',
  '__nr',
  'gon',
  'WIZ_global_data',
] as const

export async function captureDomAndGlobals(
  page: Page,
  trigger: DomExtraction['trigger'],
): Promise<DomExtraction> {
  const extraction = await page.evaluate((knownGlobals: readonly string[]) => {
    const metaTags = Array.from(document.querySelectorAll('meta[name]')).map((m) => ({
      name: m.getAttribute('name') ?? '',
      content: m.getAttribute('content') ?? '',
    }))

    const scriptJsonTags = Array.from(
      document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]'),
    ).map((s) => ({
      id: s.id || null,
      type: s.getAttribute('type'),
      dataTarget: s.getAttribute('data-target') || null,
      size: (s.textContent ?? '').length,
    }))

    const hiddenInputs = Array.from(document.querySelectorAll('input[type="hidden"]')).map((i) => ({
      name: i.getAttribute('name'),
      formAction: i.closest('form')?.getAttribute('action') ?? null,
    }))

    const globals: Record<string, string> = {}
    for (const key of knownGlobals) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: accessing window globals by dynamic key
        const val = (window as any)[key]
        if (val !== undefined) {
          globals[key] = typeof val === 'object' ? 'object' : typeof val
        }
      } catch {
        /* cross-origin or getter error */
      }
    }

    const webpackChunks = Object.keys(window).filter((k) => k.startsWith('webpackChunk'))

    // biome-ignore lint/suspicious/noExplicitAny: checking gapi global availability
    const gapiAvailable = typeof (window as any).gapi?.client?.request === 'function'

    return { metaTags, scriptJsonTags, hiddenInputs, globals, webpackChunks, gapiAvailable }
  }, KNOWN_GLOBALS)

  return {
    ...extraction,
    timestamp: new Date().toISOString(),
    trigger,
    url: page.url(),
  }
}
