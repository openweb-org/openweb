## Pipeline Gaps — Redfin (2026-04-01)

### Auto-navigate uses `networkidle` for SPA sites

**Problem:** `autoNavigate()` in `session-executor.ts:92` uses `waitUntil: 'networkidle'` with 15s timeout. Rich SPA sites like Redfin may not settle within 15s, causing auto-navigate failures ("no browser tab open for this site") during verify.

**Root cause:** `src/runtime/session-executor.ts:92` — `await newPage.goto(siteUrl, { waitUntil: 'networkidle', timeout: 15_000 })`

**Suggested fix:** Use `waitUntil: 'load'` + short delay (3s) for auto-navigate, matching the capture-guide recommendation. The capture guide explicitly warns "never use networkidle for SPAs" — the same logic should apply to auto-navigate.

### Schema validation strictness for adapter fallback responses

**Problem:** Adapter operations that return fallback/empty objects when expected DOM content is absent fail schema validation if the schema uses `required` fields or strict types without null. This forces all nullable fields to use `type: [T, 'null']` even when null is semantically wrong (the field always exists but may be empty).

**Root cause:** JSON Schema validation treats `null` as distinct from absent. Adapters that return `null` for missing numeric data need nullable types.

**Suggested fix:** This is working as intended — schema should accurately reflect nullable types. No code change needed, but adapter-only site docs could note this pattern.
