# ChatGPT Pipeline Gaps

## 1. ssrfValidator not propagated to auth resolvers

**Problem:** `session-executor.ts` resolves `ssrfValidator` default on line 132 but passes raw `deps` (with `undefined` ssrfValidator) to `resolveAuth`, `resolveCsrf`, and `resolveSigning`.

**Root cause:** `src/runtime/session-executor.ts:167` — `resolveAuth(handle, serverExt.auth, serverUrl, deps)` should use `{ ...deps, ssrfValidator }`.

**Fix applied:** Spread resolved `ssrfValidator` into deps for all three resolve calls. This affects ALL sites using exchange_chain, sapisidhash, or any auth primitive through the session-http path.

## 2. Token cache doesn't support exchange_chain auth

**Problem:** `executeCachedFetch` in `cache-manager.ts` only reconstructs auth for `localStorage_jwt`. For `exchange_chain` sites, it sends cached cookies without the Bearer token, causing 200 HTML responses (Cloudflare challenge) instead of JSON.

**Root cause:** `src/runtime/cache-manager.ts:48-66` — only `localStorage_jwt` branch exists for auth reconstruction. `exchange_chain` requires calling a token endpoint, which can't be done without a browser.

**Fix applied:** Early return `null` when auth type is `exchange_chain`, falling through to `executeSessionHttp` which has the full auth resolution.

**Suggested improvement:** Cache the exchange_chain Bearer token alongside cookies. The token endpoint response could be cached with a TTL (ChatGPT tokens expire in ~30 min). This would allow cached fast-path for exchange_chain sites between token refreshes.

## 3. Cloudflare UA binding requires explicit User-Agent header

**Problem:** Node.js `fetch` sends `undici` as User-Agent. Cloudflare binds `cf_clearance` to the browser's UA. API calls from Node.js are rejected with 403 unless the UA matches.

**Root cause:** No automatic UA forwarding from browser to Node.js fetch. Each site must add a `User-Agent` header parameter to every operation.

**Suggested improvement:** When transport is `node` and auth requires browser cookies, automatically extract and forward the browser's User-Agent in the session-executor, without requiring per-operation header params.
