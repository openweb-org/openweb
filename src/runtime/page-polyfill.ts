import type { Page } from 'patchright'

/**
 * Polyfill esbuild's `__name` helper in the browser page context.
 *
 * tsx (the dev-mode TypeScript runner) hardcodes `keepNames: true` in its
 * esbuild transform. This causes `__name(fn, "name")` calls to be injected
 * into function bodies — including functions serialized and executed inside
 * `page.evaluate()`. The browser context lacks the `__name` helper, so
 * those calls throw `ReferenceError: __name is not defined`.
 *
 * This function injects a minimal `__name` (matching esbuild's semantics)
 * into the page's global scope. It is idempotent — safe to call multiple
 * times on the same page.
 *
 * Uses a string expression to avoid tsx transforming the polyfill itself.
 */
export async function ensurePagePolyfills(page: Page): Promise<void> {
  await page.evaluate(`
    if (typeof globalThis.__name === 'undefined') {
      Object.defineProperty(globalThis, '__name', {
        value: (target, value) => Object.defineProperty(target, 'name', { value, configurable: true }),
        configurable: true,
        writable: true,
      });
    }
  `)
}
