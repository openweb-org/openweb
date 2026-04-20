# ChatGPT

## Overview
ChatGPT backend API — OpenAI's conversational AI interface. Content platform archetype.

## Workflows

### Browse conversations
1. `listConversations` → pick conversation → `conversationId`
2. `getConversation(conversationId)` → full message tree

### Search and read
1. `searchConversations(query)` → results with `conversationId`
2. `getConversation(conversationId)` → full message tree

### Send a message
1. `getModels` → pick model → `modelSlug`
2. `listConversations` → pick conversation → `conversationId`
3. `getConversation(conversationId)` → get `current_node` → `parentMessageId`
4. `sendMessage(conversationId, parentMessageId, model, text)` → SSE stream

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getProfile | authenticated user info | — | id, name, email | entry point |
| listConversations | recent conversations | limit?, cursor? | items[].id, title, cursor | paginated (cursor) |
| getConversation | full conversation detail | conversationId ← listConversations | mapping (message tree), current_node | tree structure |
| searchConversations | search past conversations | query | items[].conversation_id, snippet | paginated (offset cursor) |
| getModels | available models | — | models[].slug, title | entry point |
| sendMessage | send message, get response | model ← getModels, conversationId ← listConversations, parentMessageId ← getConversation | SSE delta stream | WRITE, SSE |

## Quick Start

```bash
# Get user profile
openweb chatgpt exec getProfile '{}'

# List recent conversations
openweb chatgpt exec listConversations '{"limit": 10}'

# Get a conversation
openweb chatgpt exec getConversation '{"conversationId": "<id>"}'

# Search conversations
openweb chatgpt exec searchConversations '{"query": "python"}'

# Get available models
openweb chatgpt exec getModels '{}'
```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture
- Backend API at `chatgpt.com/backend-api/`
- Conversation detail returns a `mapping` object: tree of nodes keyed by UUID, each with `parent`, `children`, `message` fields
- Send message returns SSE (text/event-stream), not WebSocket
- Cursor pagination on listConversations; offset pagination on search

## Auth

Two layers, depending on the operation.

**Bearer (read ops)** — `exchange_chain`:
1. GET `chatgpt.com/api/auth/session` (using browser session cookies) → extract `accessToken`
2. Inject as `Authorization: Bearer <token>` on every `/backend-api/*` call

**Cookie session (write ops, via SPA)** — `sendMessage` runs inside the
chatgpt.com tab, so it relies on the browser's logged-in cookie set:
- `__Secure-next-auth.session-token.0` / `.1` (NextAuth JWT, split across two cookies)
- `cf_clearance` (Cloudflare bot-management clearance, UA-bound)
- `_puid`, `oai-did` (account / device identifiers used by Sentinel)

The User-Agent header on Node-side calls must match the UA that earned
`cf_clearance`. The default UA in `components.parameters.UserAgent`
mirrors the managed browser's UA string.

## Transport
- **Read ops** — `node`. Direct HTTP using the Bearer + browser cookies.
- **`sendMessage`** — `page` + `chatgpt-web` adapter. See § Adapter pattern below.

## Adapter pattern (chatgpt-web)

`POST /backend-api/f/conversation` is gated by **two anti-bot tokens that
are not modeled in the OpenAPI spec**:

1. `OpenAI-Sentinel-Chat-Requirements-Token` — fetched per-send from
   `POST /backend-api/sentinel/chat-requirements`.
2. **Proof-of-Work** — `chat-requirements` returns
   `{ proofofwork: { required, seed, difficulty } }`. The browser must
   compute SHA3-512 over a base64-encoded JSON array (screen size,
   timestamp, UA, language, …) prefixed by `seed` and find a counter that
   produces a hash matching `difficulty`. Persona on paid accounts is
   `chatgpt-paid` and PoW is mandatory.

A Node-side or `page.evaluate(fetch)` call with a valid Bearer + cookies
returns:

```
HTTP 403 {"detail":"Unusual activity has been detected from your device. Try again later."}
```

The chatgpt.com SPA solves both tokens on every send. Rather than
reimplement Sentinel + PoW in the adapter, `chatgpt-web` drives the SPA
and lets it do the cryptography:

1. **Page plan** — `page_plan.entry_url = https://chatgpt.com/`,
   `ready = '#prompt-textarea'`. Runtime opens the tab, warm-up waits for
   the composer to mount.
2. **Composer focus (no DOM clicks)** — `page.evaluate` calls `.focus()` on
   `#prompt-textarea`. The composer is a ProseMirror `contenteditable`
   `<div>`, so `element.value = …` does **not** work — text must be
   entered through actual input events.
3. **Type prompt** — `page.keyboard.type(prompt)` synthesizes the
   `keydown` / `beforeinput` / `input` event sequence ProseMirror expects.
   The Send button (`[data-testid="send-button"]`) un-disables once
   characters land.
4. **Trigger send** — `page.keyboard.press('Enter')`. The SPA fires
   `POST /backend-api/sentinel/chat-requirements`, solves PoW, then
   `POST /backend-api/f/conversation/prepare`, then opens the streaming
   `POST /backend-api/f/conversation`.
5. **Passive intercept** — a `page.on('response', …)` listener registered
   **before** the keypress matches `/\/backend-api\/f\/conversation(?!\/prepare)/`
   and reads `await resp.text()` to capture the SSE body.
6. **Conversation id** — once the SPA navigates the tab to
   `/c/<uuid>`, the adapter parses that path for the new conversation id.

Adapter source: `src/sites/chatgpt/adapters/chatgpt-web.ts`.
Helpers used: built-in `page.keyboard` + `page.on('response')` — no
custom `interceptResponse` because the body is SSE (text), not JSON.

## Known Issues

- **`response_text` is often empty.** Playwright's `Response.text()`
  resolves when the response *headers* finish, not when the SSE stream
  ends. The adapter usually captures only 4–6 SSE frames before the
  promise resolves, leaving `response_text = ""`. Verify still passes
  (schema only requires `string`) and `conversation_id` is correct, but
  the assembled reply must be fetched separately via `getConversation`.
  **Fix path:** switch the adapter to a CDP `Network.dataReceived`
  listener (or `page.context().newCDPSession()` + manual stream reader)
  that buffers frames until `Network.loadingFinished`.
- **Sentinel + PoW means no Node fallback for `sendMessage`.** Any future
  attempt to call `/f/conversation` directly will 403. If OpenAI ever
  exposes a stable replay API the adapter can be retired.
- **403 from Sentinel masquerades as `needs_login`.** `getHttpFailure(403)`
  in `src/lib/errors.ts` maps every 403 to `failureClass: 'needs_login'`,
  triggering the login cascade. For chatgpt this is a 45s wasted timeout
  on every accidental Node-side call. Suggested runtime improvement:
  body-content classifier ("Unusual activity" / Cloudflare challenge HTML
  / PerimeterX appId) → `bot_blocked` failure class that fails fast
  instead of looping through `handleLoginRequired`.
- UA header mismatch causes Cloudflare rejection on Node-side calls
  (read ops). Default UA in the spec must match the managed browser's UA.
- `ssrfValidator` may block some `backend-api` URLs (known bug;
  see `pipeline-gaps.md`).
- WebSocket connections in traffic are notifications, not chat.
