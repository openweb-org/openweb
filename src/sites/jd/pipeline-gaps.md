## Pipeline Gaps — JD.com Rediscovery (2026-04-01)

### Doc gaps

**Problem:** `discover.md` recommends `--url https://<site-domain>` for capture start, but jd.com redirects internationally to corporate.jd.com. No guidance on subdomain-specific captures for Chinese sites.
**Root cause:** `discover.md` Step 2, capture start example.
**Suggested fix:** Add a note to discover.md: "For sites with international redirects (e.g., jd.com → corporate.jd.com), use a subdomain URL (e.g., search.jd.com) instead of the bare domain."

### Code gaps

**Problem:** `autoNavigate` uses `waitUntil: 'networkidle'` with 15s timeout. For sites that redirect (jd.com → corporate.jd.com), networkidle may not be reached within 15s, causing intermittent "no browser tab open" failures. First verify attempt had searchProducts fail; second attempt passed.
**Root cause:** `src/runtime/session-executor.ts:92` — `waitUntil: 'networkidle'`
**Suggested fix:** Use `waitUntil: 'load'` in `autoNavigate` — same recommendation as capture-guide.md's "networkidle is never safe for SPAs" guidance.

### Rules too tight

**Problem:** OpenAPI 3.1 schema validation rejects `null` values in adapter-extracted data. DOM extraction commonly returns `null` for optional fields (price, shop name, sales) when CSS selectors don't match (CSS module hash changes). Every nullable field must be explicitly declared as `type: ['string', 'null']`.
**Root cause:** `src/lifecycle/verify.ts` — Ajv-based schema validation.
**Suggested fix:** Not a code fix — but doc should note: "For adapter-only packages, prefer `type: ['string', 'null']` for all optional fields. CSS module-based sites change class names on every deployment, so DOM extraction routinely returns null for non-critical fields."

### Missing automation

**Problem:** No way to detect whether a site uses CSS module hashing during capture or compile. The compiler labels traffic but doesn't analyze DOM structure. For adapter-only packages, knowing upfront that selectors must be attribute-based (not class-based) would save a curation cycle.
**Root cause:** No DOM analysis phase in the pipeline.
**Suggested fix:** During capture, optionally snapshot the DOM class name distribution. Flag sites where >50% of class names contain hash-like suffixes (e.g., `_name_b6zo3_45`). Surface in analysis.json as `"cssModuleDetected": true`.
