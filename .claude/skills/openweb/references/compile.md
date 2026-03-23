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
