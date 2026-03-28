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
├── Curate and verify a compiled site package
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

### 2. Check readiness
```bash
openweb <site>                                     # transport, auth, operations
```
- `Requires browser: yes` → run `openweb browser start` first
- `Requires login: yes` → user must be logged in

### 3. Inspect the operation
```bash
openweb <site> <op>                                # params, response shape
openweb <site> <op> --example                      # example params JSON
```
Operations may be HTTP or WS. Inspect to see the type, parameters, and response shape.

### 4. Execute
```bash
openweb <site> exec <op> '{"key":"value"}'         # stdout=JSON result, stderr=JSON error
```
Auto-spill: responses over 4096 bytes write to temp file.

## Error Handling

Errors on stderr include `failureClass`:

| failureClass | What to Do |
|---|---|
| `needs_browser` | Run `openweb browser start` |
| `needs_login` | `openweb login <site>` → `openweb browser restart` |
| `needs_page` | Open a tab to the site URL |
| `permission_denied` | Update `~/.openweb/permissions.yaml` |
| `permission_required` | Ask user for confirmation, then retry |
| `retriable` | Wait a few seconds, retry (max 2) |
| `fatal` | Don't retry — fix params or check site name |

## References (load on demand)

### Process docs (load the one matching your task)

| File | When |
|---|---|
| `references/discover.md` | Adding or expanding a site |
| `references/compile.md` | Curating, generating, and verifying a site package |
| `references/site-doc.md` | Writing DOC.md / PROGRESS.md |
| `references/cli.md` | CLI reference, browser mgmt |
| `references/troubleshooting.md` | Debugging errors |
| `references/update-knowledge.md` | After learning something new |

### Knowledge files (load when the process doc tells you to)

Do NOT preload all knowledge files. The process docs (`discover.md`, `compile.md`)
specify exactly which knowledge file to read at each step and what to look for.

| File | Loaded by | What to extract |
|---|---|---|
| `references/knowledge/archetypes/index.md` | discover "Before You Start" | Site archetype, expected ops, auth/transport |
| `references/knowledge/auth-patterns.md` | discover "Before You Start", compile Step 2a | Expected auth type for this site category |
| `references/knowledge/bot-detection-patterns.md` | discover "Before You Start" | Whether to use real Chrome profile, session length |
| `references/knowledge/extraction-patterns.md` | compile Step 2c | When extraction beats API replay |
| `references/knowledge/graphql-patterns.md` | compile Step 2b (GraphQL sites only) | Persisted queries, batching, sub-cluster patterns |
| `references/knowledge/ws-patterns.md` | compile Step 2d (WS sites only) | Operation vs noise signal classification |
| `references/knowledge/troubleshooting-patterns.md` | troubleshooting Step 2 | Known failure cause/fix patterns |
