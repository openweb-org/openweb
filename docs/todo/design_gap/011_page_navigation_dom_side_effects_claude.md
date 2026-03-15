# Design Gap: Page Navigation and DOM Side Effects

## Severity: MEDIUM

## Problem

Many plugins include tools that perform client-side actions (navigation, DOM
manipulation, state broadcasting) without making any API calls. These actions change
the browser's visible state but produce no HTTP traffic for HAR to capture.

## Affected Sites

**Navigation tools (window.location):**
- Netflix — `playTitle`: sets `window.location.href` to start playback
- Panda Express — `navigateToCheckout`: writes localStorage state, then navigates
- Priceline — `navigateToSearch`, `navigateToHotel`: constructs URLs and navigates
- Costco — `navigateToProduct`: builds product URL and navigates

**DOM manipulation:**
- WhatsApp — Message sending requires finding Lexical editor, dispatching keyboard
  events, pressing Enter (see gap #007)
- Figma — Some tools manipulate canvas state via internal APIs

**BroadcastChannel / multi-tab sync:**
- Dominos — After creating a cart via API, must call `syncCartUI()` which
  broadcasts `SYNC_CART` event via BroadcastChannel so the MFE re-fetches cart
- Also must call `setFrontendCartCookies(cartId, storeId, ...)` to write cookies
  that the UI reads as source-of-truth

## Why OpenWeb Can't Handle It

1. Navigation tools don't make HTTP requests — nothing appears in HAR
2. DOM manipulation is client-side JavaScript, not HTTP traffic
3. BroadcastChannel events are inter-tab, not network
4. Cookie writing (Dominos) is a side effect that other tools depend on
5. OpenWeb's spec format (OpenAPI) can only describe HTTP endpoints
6. The executor's `direct_http` and `session_http` modes cannot navigate or
   manipulate DOM

## Potential Mitigations

- **Tool type annotation**: Extend the spec to distinguish between "API tools"
  (HTTP replay) and "browser tools" (require live browser context)
- **Browser action primitives**: Add `navigate(url)`, `click(selector)`,
  `type(selector, text)` as primitive operations in the executor
- **Accept as out of scope**: Navigation and DOM tools may be better served by
  browser automation (Playwright) than API compilation
- **Hybrid spec**: Generate a spec that includes both HTTP endpoints and browser
  actions, letting the runtime choose the appropriate executor
