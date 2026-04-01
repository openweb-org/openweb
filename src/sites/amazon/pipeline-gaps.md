## Pipeline Gaps — Amazon Discovery (2026-04-01)

### 1. Extraction executor ignores operation parameters

**Problem:** The `executeExtraction()` function in `extraction-executor.ts` doesn't receive
or substitute path/query parameters. For parameterized operations like `/dp/{asin}`, the
extraction evaluates on the wrong page (server URL or `page_url` without parameter substitution).

**Root cause:** `extraction-executor.ts:87` — `executeExtraction(browser, spec, operation)`
receives only the operation object, not the resolved parameters. The `http-executor.ts:175`
call site also doesn't pass params.

**Suggested fix:** Pass params to `executeExtraction`, resolve the page URL with parameter
substitution (like `http-executor.ts:163` does with `substitutePath`), and auto-navigate
to the resolved URL before evaluating the expression. This would eliminate the need for
adapters on many SSR sites.

### 2. Browser-wide capture creates noisy traffic

**Problem:** Default `openweb capture start` captures ALL browser tabs, not just the target
site. The Amazon capture included 5440 off-domain requests from X, LinkedIn, Google, etc.
This led to 57 auto-curated operations, most of which were noise from other sites (including
Twitter's `ct0` CSRF token being incorrectly picked as Amazon's auth).

**Root cause:** `--isolate` exists but starts a new tab. The default non-isolated mode
monitors all existing tabs.

**Suggested fix:** Default capture should filter by the specified site URL's domain during
recording, or at least during analysis. The `--isolate` flag helps but isn't the default.

### 3. tsx `__name` injection breaks page.evaluate callbacks — FIXED

**Problem:** When using `page.evaluate(() => { function f(x) { return x; } })` in TypeScript
adapter files run through tsx, the transpiler injects `__name` helper calls that fail in
the browser context with `ReferenceError: __name is not defined`.

**Root cause:** tsx hardcodes `keepNames: true` in its esbuild transform. Named function
declarations inside `page.evaluate()` callbacks get `__name(fn, "name")` injected into the
serialized function body. The browser context doesn't have the `__name` helper.

**Fix:** `page-polyfill.ts` injects a no-op `__name` into the browser page context
(matching esbuild's semantics) before any adapter, browser-fetch, extraction, or
session-http execution. The polyfill is idempotent and uses a string expression
to avoid tsx transforming the polyfill itself.
