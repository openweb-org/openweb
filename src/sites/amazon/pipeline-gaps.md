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

### 3. tsx `__name` injection breaks page.evaluate callbacks

**Problem:** When using `page.evaluate(() => { const f = (x) => x; ... })` in TypeScript
adapter files run through tsx, the transpiler injects `__name` helper calls that fail in
the browser context with `ReferenceError: __name is not defined`.

**Root cause:** tsx/esbuild transformation adds decorator-like helpers for named functions.
Browser's evaluate context doesn't have these helpers.

**Suggested fix:** Document this as a known issue in capture-guide.md or extraction-patterns.md.
Workaround: use `page.evaluate(\`(expression string)\`)` instead of function callbacks in
adapter files.
