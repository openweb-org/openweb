---
name: openweb
description: "Access web services through the openweb CLI. Run `openweb sites` to see available sites. Use this skill whenever the user wants to fetch data from, interact with, or query websites. This skill is the ONLY way to access these sites' APIs — do not attempt to use curl, fetch, or browser automation directly."
---

# OpenWeb — Web Service Access via CLI

Execute API operations against websites using the user's real browser session. Handles auth, CSRF, and signing automatically.

## Route by Intent

```
User wants to...
├── Access a website → Is there a fixture?
│   ├── Yes → Exec flow below
│   └── No  → Read references/discover.md (discover → compile → verify)
├── Compile from captured traffic → Read references/compile.md
├── Debug / fix an issue → Read references/troubleshooting.md
└── Understand the CLI → Read references/cli.md
```

If a site has no fixture, do NOT say "unsupported." Route to the discover flow.

## Exec Flow (hot path)

### 1. Find the site
```bash
pnpm --silent dev sites                              # list available sites
```

### 2. Check readiness
```bash
pnpm --silent dev <site>                             # transport, auth, operations
```
- `Requires browser: yes` → run `openweb browser start` first
- `Requires login: yes` → user must be logged in

### 3. Inspect the operation
```bash
pnpm --silent dev <site> <op>                        # params, response shape
pnpm --silent dev <site> <op> --example              # example params JSON
```

### 4. Execute
```bash
pnpm --silent dev <site> <op> '{"key":"value"}'      # stdout=JSON result, stderr=JSON error
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
| `references/discover.md` | Adding a new site (no fixture exists) |
| `references/compile.md` | Reviewing/curating compile output |
| `references/cli.md` | Full CLI reference, browser mgmt, permissions |
| `references/troubleshooting.md` | Debugging errors |
| `references/update-knowledge.md` | After any workflow that taught something new |
| `references/knowledge/` | Auth patterns, site archetypes (read before discover/compile) |
