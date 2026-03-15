# Discussion: Best of Both Worlds — Layered Spec + Code Escape Hatch

## The Fundamental Tension

```
Structure = Constraints = Less Expressiveness = Less Coverage
Code      = Freedom     = Full Expressiveness = Full Coverage
```

But computer science has many precedents for having both:

| Domain | Structure | Code Escape Hatch |
|---|---|---|
| SQL | Declarative queries | Stored procedures |
| React | JSX declarative UI | `{expression}` arbitrary JS |
| CSS | Declarative styles | `calc()`, CSS-in-JS |
| LLVM | Structured IR | Can express any computation |
| Terraform | Declarative infra | `provisioner "local-exec"` |

**Common pattern: declarative covers 80% of cases, code handles the 20% exceptions.**

## The Hidden Pattern in OpenTabs Plugins

Despite per-site custom code, most plugins use the same patterns:

```
~40% — fetch(url, { headers: { Authorization: 'Bearer ' + token } })
~20% — token = getCookie('csrftoken') → inject to X-CSRFToken header
~15% — token = getLocalStorage(key) → JSON.parse → extract field
~10% — GraphQL persisted query + hash extraction
~5%  — gapi.client.request() proxy
~5%  — DOM parsing HTML
~5%  — Internal module invocation (WhatsApp/Telegram)
```

The first 85% are **parameterizable patterns**. Only the last 15% truly need
free-form code.

## Proposed Architecture: Three-Layer Spec

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Structural Spec (declarative)          │
│  Covers: URLs, methods, params, response schema  │
│  ≈ OpenAPI 3.1                                    │
├─────────────────────────────────────────────────┤
│  Layer 2: Interaction Primitives (pattern DSL)    │
│  Covers: auth, CSRF, signing, retry, pagination  │
│  ≈ Parameterized common patterns                  │
├─────────────────────────────────────────────────┤
│  Layer 3: Code Adapters (escape hatch)           │
│  Covers: WhatsApp require(), OnlyFans signing    │
│  ≈ Arbitrary JS, runs in browser                  │
└─────────────────────────────────────────────────┘
```

### Layer 1 — Structural Endpoints

```yaml
endpoints:
  list_channels:
    method: GET
    path: /api/v9/guilds/{guild_id}/channels
    params:
      guild_id: { in: path, type: string }
    response: { type: array, items: { $ref: '#/schemas/Channel' } }
```

### Layer 2 — Interaction Primitives (Key Innovation)

Declarative composition of known patterns:

```yaml
auth:
  strategy: localStorage_jwt
  key: "BSKY_STORAGE"
  path: "session.accessJwt"
  inject: { header: Authorization, prefix: "Bearer " }
  on_expire: clear_and_retry

csrf:
  strategy: cookie_to_header
  cookie: csrftoken
  header: X-CSRFToken

pagination:
  strategy: cursor
  cursor_field: response.data.after
  cursor_param: after
```

Benefits:
- **Analyzable**: know which sites use localStorage JWT, batch-update strategy
- **Composable**: one site can combine localStorage_jwt + cookie_to_header
- **Validatable**: strategy params have schema, can lint
- **Generalizable**: new site with same pattern = just fill params

### The Pattern Library Grows Over Time

```
patterns/
├── auth/
│   ├── cookie_session          # Pure cookie auth
│   ├── localStorage_jwt        # JWT from localStorage
│   ├── sessionStorage_msal     # MSAL token extraction
│   ├── page_global             # window.xxx.token
│   ├── oauth_refresh           # OAuth refresh_token flow
│   ├── gapi_proxy              # Google gapi.client.request()
│   └── webpack_module_walk     # Extract token from webpack
├── csrf/
│   ├── cookie_to_header        # cookie → X-CSRFToken
│   ├── meta_tag                # <meta name="csrf-token">
│   └── page_global             # window.initData.csrfToken
├── signing/
│   ├── sapisidhash             # Google SAPISIDHASH
│   └── aws_sigv4               # AWS SigV4
├── pagination/
│   ├── cursor
│   ├── offset_limit
│   └── link_header             # RFC 8288
└── extraction/
    ├── ssr_next_data            # __NEXT_DATA__
    ├── ssr_nuxt                 # __NUXT__
    └── apollo_cache             # __APOLLO_STATE__
```

### Layer 3 — Code Escape Hatch

```yaml
endpoints:
  send_message:
    method: CUSTOM
    execution: browser_only
    adapter: |
      const WAWeb = require('WAWebChatCollection');
      const chat = WAWeb.models.find(c => c.id === params.chat_id);
      await chat.sendMessage(params.text);
      return { success: true };
```

Constraints on escape hatch:
- Explicitly marked as "needs browser"
- Input/output still have Zod schema (structured interface)
- Can call Layer 2 primitives (`auth.getToken()`, `csrf.extract()`)

## What This Looks Like Per Site

```yaml
# discord.yaml — fully structural (Layer 1+2)
site: discord.com
auth: { strategy: webpack_module_walk, pattern: "getToken" }
csrf: { strategy: cookie_to_header, cookie: __dcfduid }
execution: direct_http

endpoints:
  send_message: { method: POST, path: /api/v9/channels/{id}/messages }
  list_guilds:  { method: GET,  path: /api/v9/users/@me/guilds }
```

```yaml
# whatsapp.yaml — needs code escape hatch (Layer 3)
site: web.whatsapp.com
auth: { strategy: page_ready_check }
execution: browser_only

endpoints:
  send_message:
    method: CUSTOM
    adapter: "./adapters/whatsapp-send.js"
```

## Compiler Pipeline

```
Phase 1: Record (HAR + browser state snapshot)
    ↓
Phase 2: Analyze → AST (structured intermediate representation)
    ↓
Phase 3: Pattern Match (match AST nodes to pattern library)
    ↓
Phase 4: Emit
    ├── Layer 1: OpenAPI spec (pure HTTP endpoints)
    ├── Layer 2: Interaction primitives (auth/csrf/pagination config)
    └── Layer 3: Code adapters (unmatched patterns)
```

Phase 3 is the key: compiler sees `localStorage['BSKY_STORAGE'] → JSON.parse
→ .session.accessJwt → Authorization header`, matches to `localStorage_jwt`
pattern, parameterizes as `{ key, path, inject }`.

Richer pattern library → fewer Layer 3 escape hatches.

**Goal: 95% of sites fully in Layer 1+2, only WhatsApp/Telegram need Layer 3.**

## The Structural Beauty

**Structure is the default, code is the exception.**

The spec becomes an "X-ray" of each website:
- Analyzable: diff auth strategies across sites
- Composable: reuse pagination patterns
- Evolvable: add new pattern, all matching sites upgrade
- Debuggable: structural parts are inspectable without reading code
