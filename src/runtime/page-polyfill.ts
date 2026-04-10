import type { Page } from 'patchright'

const POLYFILL_SCRIPT = `
  if (typeof globalThis.__name === 'undefined') {
    Object.defineProperty(globalThis, '__name', {
      value: (target, value) => Object.defineProperty(target, 'name', { value, configurable: true }),
      configurable: true,
      writable: true,
    });
  }
`

/** Pages that already have the init-script registered. */
const registered = new WeakSet<Page>()

/**
 * Polyfill esbuild's `__name` helper in the browser page context.
 *
 * tsx (the dev-mode TypeScript runner) hardcodes `keepNames: true` in its
 * esbuild transform. This causes `__name(fn, "name")` calls to be injected
 * into function bodies — including functions serialized and executed inside
 * `page.evaluate()`. The browser context lacks the `__name` helper, so
 * those calls throw `ReferenceError: __name is not defined`.
 *
 * Registers an init script via `page.addInitScript()` so the polyfill
 * survives `page.goto()` navigations. Also injects into the current
 * document immediately. Idempotent — safe to call multiple times.
 *
 * Uses a string expression to avoid tsx transforming the polyfill itself.
 */
export async function ensurePagePolyfills(page: Page): Promise<void> {
  if (!registered.has(page)) {
    await page.addInitScript(POLYFILL_SCRIPT).catch(() => {})
    registered.add(page)
  }
  await page.evaluate(POLYFILL_SCRIPT)
}
