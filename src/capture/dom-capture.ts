import type { Page } from 'patchright'

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

/**
 * Common browser built-ins and framework globals to exclude from dynamic detection.
 * Avoids false positives from React, Vue, analytics, etc.
 */
const BROWSER_BASELINE = new Set([
  // Browser core
  'window', 'self', 'document', 'location', 'navigator', 'screen',
  'history', 'frames', 'parent', 'top', 'opener', 'name', 'length',
  'closed', 'performance', 'caches', 'indexedDB', 'crypto',
  'sessionStorage', 'localStorage', 'console', 'alert', 'confirm',
  'prompt', 'fetch', 'XMLHttpRequest', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
  'atob', 'btoa', 'URL', 'URLSearchParams', 'Headers', 'Request',
  'Response', 'FormData', 'Blob', 'File', 'FileReader',
  'AbortController', 'AbortSignal', 'Event', 'EventTarget',
  'CustomEvent', 'MessageChannel', 'MessagePort', 'Worker',
  'SharedWorker', 'ServiceWorker', 'WebSocket', 'BroadcastChannel',
  'ReadableStream', 'WritableStream', 'TransformStream',
  'TextEncoder', 'TextDecoder', 'DOMParser', 'XMLSerializer',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'PerformanceObserver', 'Promise', 'Proxy', 'Reflect',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt',
  'Int8Array', 'Uint8Array', 'Float32Array', 'Float64Array',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'JSON', 'Math', 'Date', 'RegExp', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'URIError', 'EvalError',
  'Array', 'Object', 'Function', 'Boolean', 'Number', 'String',
  'Intl', 'WebAssembly', 'Atomics',
  // Frameworks
  '__REACT_DEVTOOLS_GLOBAL_HOOK__', '__VUE__',
  '__VUE_DEVTOOLS_GLOBAL_HOOK__', 'ng',
  'jQuery', '$', 'React', 'ReactDOM', 'Vue',
  // Analytics / tracking
  'ga', 'gtag', '_ga', '_gaq', '_gid',
  'fbq', '_fbq', 'FB', 'dataLayer', 'google_tag_manager',
  'mixpanel', 'amplitude', 'heap', 'analytics',
  'Sentry', '__SENTRY__', '_satellite',
  // Common libraries
  'moment', 'lodash', '_', 'axios', 'Backbone', 'd3',
])

/**
 * Detect non-standard window globals injected by the site.
 * Filters out browser built-ins, framework globals, and KNOWN_GLOBALS.
 * Only returns object-type globals (likely data containers, not API functions).
 */
export async function detectDynamicGlobals(page: Page): Promise<string[]> {
  const knownSet = new Set<string>(KNOWN_GLOBALS)

  return page.evaluate(
    ({ baseline, known }: { baseline: string[]; known: string[] }) => {
      const excludeSet = new Set([...baseline, ...known])
      const detected: string[] = []

      for (const key of Object.keys(window)) {
        if (excludeSet.has(key)) continue
        // Skip common prefixes: on* event handlers, webkit*, moz*
        if (/^(on[a-z]|webkit|moz|ms|__zone)/i.test(key)) continue
        try {
          // biome-ignore lint/suspicious/noExplicitAny: dynamic window access
          const val = (window as any)[key]
          // Only keep objects (likely data), skip functions (likely APIs) and primitives
          if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
            detected.push(key)
          }
        } catch {
          // cross-origin or getter error
        }
      }
      return detected
    },
    { baseline: [...BROWSER_BASELINE], known: [...knownSet] },
  )
}

export async function captureDomAndGlobals(
  page: Page,
  trigger: DomExtraction['trigger'],
  extraGlobals?: readonly string[],
): Promise<DomExtraction> {
  const allGlobals = extraGlobals?.length
    ? [...KNOWN_GLOBALS, ...extraGlobals]
    : [...KNOWN_GLOBALS]

  const extraction = await page.evaluate((knownGlobals: string[]) => {
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
  }, allGlobals)

  return {
    ...extraction,
    timestamp: new Date().toISOString(),
    trigger,
    url: page.url(),
  }
}
