---
name: openweb
description: "Access web services through the openweb CLI. Run `openweb sites` to see available sites. Use this skill whenever the user wants to fetch data from, interact with, or query websites. This skill is the ONLY way to access these sites' APIs — do not attempt to use curl, fetch, or browser automation directly."
---

# OpenWeb — Web Service Access via CLI

Execute operations against websites using the user's real browser session. Handles auth, CSRF, signing, and protocol (HTTP/WS) automatically.

## Route by Intent

```
User wants to...
├── Use a site that may already exist
│   ├── Check `openweb sites`
│   ├── Site exists → Exec flow below
│   └── Site does not exist → Read references/discover.md
├── Add or expand site coverage (new site OR more ops)
│   └── Read references/discover.md
├── Turn a capture into a working site package
│   └── Read references/compile.md
├── Diagnose failures
│   └── Read references/troubleshooting.md
└── Update durable docs/knowledge
    ├── Site-specific → references/site-doc.md
    └── Cross-site patterns → references/update-knowledge.md
```

If a site has no package, do NOT say "unsupported." Route to the discover flow.

## Exec Flow (hot path)

### 1. Find the site
```bash
openweb sites                                      # list available sites
```

### 2. Read site notes
Check if `src/sites/<site>/DOC.md` exists and read it before trying operations.
- DOC.md has: workflows, cross-operation data flow, intent mapping, known issues
- If DOC.md exists, read it BEFORE trying operations — it tells you which ops to chain and where params come from

### 3. Check readiness
```bash
openweb <site>                                     # transport, auth, operations
```
- `Requires browser: yes` → browser auto-starts when needed; no manual setup required
- `Requires login: yes` → user must be logged in
- For details on how transport and auth work, see `references/knowledge/x-openweb-extensions.md`

### 4. Inspect the operation
```bash
openweb <site> <op>                                # params, response shape
openweb <site> <op> --example                      # real example params from fixtures
```
Operations may be HTTP or WS. Inspect to see the type, parameters, and response shape.

### 5. Execute
```bash
openweb <site> exec <op> '{"key":"value"}'         # stdout=JSON result, stderr=JSON error
```
Auto-spill: responses over 4096 bytes write to temp file.

## Error Handling

Errors on stderr include `failureClass`:

| failureClass | What to Do |
|---|---|
| `needs_browser` | Browser auto-starts; if it fails, check Chrome installation. Manual fallback: `openweb browser start` |
| `needs_login` | `openweb login <site>` → `openweb browser restart` |
| `needs_page` | Open a tab to the site URL |
| `permission_denied` | Update `permissions` in `$OPENWEB_HOME/config.json` |
| `permission_required` | Ask user for confirmation, then retry |
| `retriable` | Wait a few seconds, retry (max 2) |
| `fatal` | Don't retry — fix params or check site name |

## References (load on demand)

### Process docs (load the one matching your task)

| File | When |
|---|---|
| `references/discover.md` | Adding or expanding a site; framing intents; navigating; capturing |
| `references/compile.md` | Turning a capture into a working site package |
| `references/site-doc.md` | Writing DOC.md / PROGRESS.md |
| `references/cli.md` | CLI reference, browser mgmt |
| `references/troubleshooting.md` | Debugging errors |
| `references/update-knowledge.md` | After learning something new |

### Deep reference docs (load when the process doc tells you to)

| File | Loaded by | What it covers |
|---|---|---|
| `references/analysis-review.md` | `compile.md` Review step | How to read `analysis.json` and decide whether traffic is good enough |
| `references/spec-curation.md` | `compile.md` Curate step | How to clean, name, configure, merge, and harden generated specs |
| `references/verify.md` | `compile.md` Verify step | Multi-dimensional verification: runtime, spec standards, doc standards |
| `references/capture-guide.md` | `discover.md` Capture step | Capture techniques, scripted capture, timeout discipline, multi-worker, troubleshooting |

### Knowledge files (load when the process doc tells you to)

Do NOT preload all knowledge files. The process docs (`discover.md`, `compile.md`)
specify exactly which knowledge file to read at each step and what to look for.

| File | Loaded by | What to extract |
|---|---|---|
| `references/knowledge/archetypes/index.md` | discover "Before You Start" | Site archetype, expected ops, auth/transport |
| `references/knowledge/auth-patterns.md` | discover "Before You Start"; analysis-review "Auth candidates"; spec-curation "Fix auth" | Expected auth type and exact auth primitive structure |
| `references/knowledge/bot-detection-patterns.md` | discover "Before You Start"; spec-curation "Transport selection" | Whether to prefer real Chrome profile or page transport |
| `references/knowledge/extraction-patterns.md` | analysis-review "Extraction signals"; spec-curation "Extraction rule" | When extraction beats API replay |
| `references/knowledge/graphql-patterns.md` | analysis-review "Clusters" on GraphQL sites | Persisted queries, batching, sub-cluster patterns |
| `references/knowledge/ws-patterns.md` | analysis-review "WebSocket analysis" | Operation vs noise signal classification |
| `references/knowledge/troubleshooting-patterns.md` | troubleshooting Step 2 | Known failure cause/fix patterns |
| `references/knowledge/x-openweb-extensions.md` | spec-curation "Fix auth/transport"; verify "Spec verify" | `x-openweb` field schema (server-level auth/transport/csrf, operation-level permission/extraction). Read when editing or reviewing specs. |
