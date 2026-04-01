## Pipeline Gaps — Substack Discovery (2026-04-01)

### 1. $ref Not Supported in OpenAPI Specs

**Problem:** Used `$ref: '#/components/schemas/Post'` in openapi.yaml, which caused
verify to fail with "can't resolve reference #/components/schemas/Post from id #".
No other site package uses `$ref`. The runtime's JSON Schema validator doesn't resolve
OpenAPI `$ref` pointers.

**Root cause:** The runtime uses a JSON Schema validator that doesn't bundle/dereference
`$ref` before validation. No existing spec uses `$ref`, so this was never tested.

**Suggested fix:** Either document that `$ref` is unsupported in spec-curation.md, or
add `$ref` resolution in the spec loader (`src/lib/spec-loader.ts`). Documentation is
the cheaper fix — all inline schemas work fine.

### 2. Multi-Subdomain Sites Need Adapter for Cross-Origin API Calls

**Problem:** Substack publications live on different subdomains (`{pub}.substack.com`
or custom domains). The capture labeler marks cross-domain requests as `off_domain`,
and `page.evaluate(fetch())` from one domain can't call another domain's API. Only
17 of 236 captured requests were labeled `api`.

**Root cause:** `--isolate` captures tab-level traffic, but when the page navigates
across domains, the labeler (correctly) marks non-source-domain requests as off_domain.
The compile expects same-domain traffic.

**Suggested fix:** For multi-domain sites like Substack, the adapter approach is
correct — it navigates the page to the right domain before making same-origin calls.
Document this pattern in archetypes as "multi-domain content platform" — adapter
is expected, not a workaround.

### 3. Subdomain Redirects Break Cross-Origin Fetch

**Problem:** `astralcodexten.substack.com` redirects to `www.astralcodexten.com`.
Using full URLs like `https://astralcodexten.substack.com/api/v1/archive` from a
page on `www.astralcodexten.com` fails with cross-origin error.

**Root cause:** `page.goto()` follows redirects transparently, but `fetch()` with a
full URL to the pre-redirect domain is cross-origin from the post-redirect domain.

**Suggested fix:** Adapters should use relative paths (`/api/v1/archive`) instead of
full URLs after `ensureDomain()` navigation. The page's current origin (after redirect)
handles the request correctly. This is already the fix applied.
