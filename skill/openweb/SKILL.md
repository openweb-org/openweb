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
├── Review compile output (HTTP and/or WS)
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

| File | When |
|---|---|
| `references/discover.md` | Adding or expanding a site |
| `references/compile.md` | Reviewing compile output |
| `references/site-doc.md` | DOC.md / PROGRESS.md template |
| `references/cli.md` | CLI reference, browser mgmt |
| `references/troubleshooting.md` | Debugging errors |
| `references/update-knowledge.md` | After learning something new |
| `knowledge/archetypes/index.md` | Before discover — identify site type and expected operations |
| `knowledge/auth-patterns.md` | Before compile — auth primitive detection |
| `knowledge/bot-detection-patterns.md` | Before discover — anticipate anti-bot measures |
| `knowledge/extraction-patterns.md` | Before compile — SSR/DOM extraction techniques |
| `knowledge/graphql-patterns.md` | Before GraphQL compile — persisted queries, batching |
| `knowledge/ws-patterns.md` | Before WS compile — connection/message/heartbeat patterns |
| `knowledge/troubleshooting-patterns.md` | During debug — known failure patterns |
