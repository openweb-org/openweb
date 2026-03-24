# Compile Process

How to compile captured traffic into an openweb fixture.

## When to Use

- After `capture stop` — turning raw traffic into a fixture
- Recompiling an existing site with new traffic

## Process

### Step 1: Draft

```bash
pnpm --silent dev compile <site-url> [--capture-dir <dir>] [--probe]
```

Read the compile summary: samples captured/filtered, operations generated, auth primitives detected, hints.

### Step 2: Curate

Review the generated `openapi.yaml`:

- **Rename** operations for clarity (e.g., `get_api_v1_users` → `getUsers`)
- **Remove** noise: analytics (`/collect`, `/track`), CDN (`/static/`, `/_next/`), tracking pixels
- **Confirm** auth/CSRF/signing detection matches expectations
- **Check** against `knowledge/archetypes.md` expectations for this site type

#### Extraction Complexity Rule

If an operation's extraction logic (the `expression` in openapi.yaml) exceeds ~5 lines, **extract it into an adapter file**:

```
src/fixtures/<site>-fixture/
├── openapi.yaml          ← references adapter, no inline JS
├── adapters/<site>.ts    ← complex DOM parsing logic lives here
```

In openapi.yaml, replace the inline expression with an adapter reference:
```yaml
x-openweb:
  adapter: ./adapters/<site>.ts
```

**Inline is OK for:** simple `ssr_next_data`, `page_global`, short `html_selector` (1-3 lines).
**Adapter is required for:** multi-line DOM queries, regex parsing, complex data transformation.

openapi.yaml should be readable as a spec, not a code dump.

#### Per-Archetype Checklist

**Social Media:**
- Auth detected correctly (cookie_session, exchange_chain, etc.)
- CSRF detected if present (cookie_to_header is common)
- Feed/timeline endpoint captured; pagination works (cursor-based typical)
- Write operations gated (write/transact permission)

**Messaging:**
- Transport correct (page or adapter for Discord/Telegram/WhatsApp)
- Token extraction correct (webpack_module_walk for Discord)
- WebSocket limitation acknowledged (no real-time streams)

**Developer Tools:**
- Pagination type correct (link_header for GitHub, cursor for others)
- Path parameters extracted properly (e.g., `/{owner}/{repo}`)
- GraphQL endpoints handled

**E-commerce:**
- Extraction type correct (ssr_next_data for Next.js sites)
- Checkout/payment paths assigned `transact` permission
- Product search and detail endpoints captured

**Public APIs (no auth):**
- Auth correctly detected as "none" (no false positive from tracking cookies)
- Response schema accurate; example parameters reasonable

### Step 3: Verify

```bash
pnpm --silent dev verify <site>
```

A spec is **Ready** when curated + verified with PASS.

### Step 4: Update Knowledge

→ Read `update-knowledge.md` — evaluate what you learned, write to `knowledge/` if novel.

## Common False Positives

- **Tracking cookies as auth**: Cloudflare, GA, Meta pixel cookies trigger cookie_session. Use `--probe` to catch.
- **Analytics as operations**: `/collect`, `/beacon`, `/pixel` — filter should catch most.
- **CDN endpoints**: `/static/`, `/_next/`, `/assets/` — should be filtered.
- **Dashboard internal endpoints**: SaaS dashboards (e.g. Stripe) generate heavy noise from internal `/ajax/*`, `/conversations/`, `/_extraction/` namespaces. Compile captures these alongside the real API — manual curation must filter ~80% of operations for typical dashboard sites.

## Common False Negatives

- **Auth not detected**: User wasn't logged in, or unsupported auth pattern.
- **CSRF not detected**: Token embedded in JavaScript (not cookie/meta tag) — identify manually.
- **Operations missing**: Key pages not visited during capture — recapture with targeted browsing.

## Transport Degradation Ladder

When deciding the transport for a compiled fixture, start at the highest (safest) level and only downgrade after confirming the lower level actually works. **Never skip levels.**

### Level 1: `page` (browser fetch via same-origin)

Default starting point. All captured traffic originates from a browser session, so `page` transport is always safe — it inherits cookies, TLS fingerprint, and bot detection clearance.

Stay here if:
- Site uses bot detection (PerimeterX, DataDome, Akamai, Cloudflare)
- Site requires cookie_session auth
- Site requires CSRF tokens from cookies or DOM

### Level 2: `node` with extraction (SSR)

Downgrade to node **only after confirming** that direct HTTP fetch returns the same SSR data the browser sees. Confirm by:
1. Opening the page in the browser (already done during capture)
2. Running `compile --probe` which tests node fetch against the captured URL
3. Checking that the probe response contains the expected data (e.g., `__NEXT_DATA__` with actual listings, not empty/error state)

If the probe returns a CAPTCHA page, bot detection block, or empty data → stay at `page`.

### Level 3: `node` without extraction (direct API)

Only for public APIs with no bot detection. Confirm by:
1. The `--probe` flag during compile shows the endpoint responds with 200 + valid JSON
2. No cookies or browser state are needed
3. The API domain is different from the site domain (e.g., `api.example.com` vs `www.example.com`) — separate API domains are less likely to have page-level bot detection

### Anti-pattern: probing with curl/fetch before capture

**NEVER** test endpoints with curl, wget, fetch, or any direct HTTP tool during discovery. This poisons IP reputation with bot detection systems and can block even real browser sessions on the same IP. See `discover.md` "Browser First" rule.

The `--probe` flag in the compile step is the **only** safe way to test node transport — it runs after capture is complete and uses controlled, minimal requests.
