## 2026-04-01: Initial discovery and compilation

**What changed:**
- Fresh capture of ChatGPT backend API traffic (46 API entries, 564 total samples)
- Compiled and curated to 6 operations: getProfile, listConversations, getConversation, searchConversations, getModels, sendMessage
- exchange_chain auth configured (GET /api/auth/session → Bearer token)
- Schemas cleaned: PII scrubbed, over-specific enums generalized

**Why:**
- Rediscovery from scratch after prior package deleted
- Added getModels (new vs prior package)

**Verification:** compile-time verify showed auth_drift (expected — token expired between capture and verify)

## 2026-04-19 — Fixture: sendMessage write-op (fixture-only)

**Context:** `sendMessage` had no example fixture — `verify --write --ops sendMessage` reported "0/0 ops". Per handoff2.md §5.4 the op is recoverable (no inverse needed; user-account side effect is acceptable).
**Changes:** Added `examples/sendMessage.example.json` with `prompt: "verify ping ${now}"` (the `${now}` template helper guarantees a fresh user-visible message per run). Adapter and openapi unchanged.
**Verification:** Fixture loads correctly (op now appears in the verify scan; previously skipped as 0/0). Live verify currently blocked by an auth-detection code issue — managed Chrome is logged into chatgpt.com but the runner reports "Waiting for login..." and times out at 45s. Tracked separately under the in-flight chatgpt adapter rewrite (commit bda0d62, w-chatgpt-fix); not a fixture defect.
**Pitfalls encountered:** Verify uses the registry-installed copy at `$OPENWEB_HOME/sites/chatgpt/`, so the new example file had to be mirrored there for in-loop testing.

## 2026-04-19 — sendMessage adapter: dispatch-events + passive intercept

**Context:**
- `pnpm dev verify chatgpt --ops sendMessage --browser --write` opened the browser, reported "Waiting for login...", and timed out at 45s — even with a fully logged-in managed Chrome session. Originally framed as an auth-detection bug.
- Probing showed the user IS logged in: `/api/auth/session` returns a fresh `accessToken`, `__Secure-next-auth.session-token` and `cf_clearance` are present.

**Key discovery:**
- `POST /backend-api/f/conversation` is gated by an `OpenAI-Sentinel-Chat-Requirements-Token` (per-send) **plus** a SHA3-512 proof-of-work bound to the browser fingerprint. `chat-requirements` returns `{ persona: "chatgpt-paid", proofofwork: { required: true, seed, difficulty } }`. Direct HTTP — even `page.evaluate(fetch)` from a real chatgpt.com tab — returns `403 {"detail":"Unusual activity has been detected from your device."}`.
- `getHttpFailure(403)` in `src/lib/errors.ts` maps every 403 to `failureClass: 'needs_login'`, so the runtime entered the login cascade (`handleLoginRequired` → poll with backoff) until verify killed it. Suggested runtime improvement: a body-content classifier that recognizes Sentinel / Cloudflare / PerimeterX block payloads and routes them to a `bot_blocked` failure class instead of looping `handleLoginRequired`.

**Changes (commit bda0d62):**
- New `src/sites/chatgpt/adapters/chatgpt-web.ts` — drives the SPA composer with synthesized keyboard events (no DOM clicks), lets the page solve Sentinel + PoW, intercepts the SSE response via `page.on('response', …)`.
- `src/sites/chatgpt/openapi.yaml` — `sendMessage` switched from `POST /f/conversation` (Bearer-only) to logical path `/internal/sendMessage` with `transport: page` + `adapter: { name: chatgpt-web }` + `page_plan: { entry_url: https://chatgpt.com/, ready: '#prompt-textarea' }`. Request body simplified to `{ prompt }`; response schema is `{ conversation_id, response_text, sse_event_count }`.
- Fixture `examples/sendMessage.example.json` — replaced the multi-field body with `{ "prompt": "verify ping ${now}" }`.
- DOC.md — added Adapter pattern section, expanded Auth (Bearer + cookie layers), expanded Known Issues with the Sentinel/PoW gate and the 403→needs_login misclassification.
- SKILL.md — Operations table updated to show `sendMessage` takes only `prompt`; added Known Limitations (empty `response_text`, managed browser required).

**Verification:** `pnpm dev verify chatgpt --ops sendMessage --browser --write` → `✓ chatgpt: PASS (1/1 ops)` in ~10s. `conversation_id` reliable; `response_text` typically empty (see Pitfalls).

**Pitfalls:**
- The composer is a ProseMirror `contenteditable` `<div>`, not an `<input>`. `el.value = …` is a no-op; ProseMirror only updates on real `keydown` / `beforeinput` / `input` event sequences — must use `page.keyboard.type` instead of any value-assignment shortcut.
- "No DOM clicks" constraint excludes `page.locator(...).click()` for focusing. Equivalent without dispatching a synthetic mouse event: `page.evaluate(el => el.focus())`.
- Playwright's `Response.text()` resolves before the SSE stream finishes on chatgpt's `text/event-stream`. Adapter ends up with 4–6 frames and an empty assembled reply. Fixture passes because the schema only requires `string`. Future fix: CDP `Network.dataReceived` listener that buffers until `Network.loadingFinished`.
- The response listener regex must exclude `/prepare` (the SPA hits `/backend-api/f/conversation/prepare` first to mint a `conduit_token` before the streaming endpoint). A naïve prefix match captures the prepare response and misses the real SSE.
