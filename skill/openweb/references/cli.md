# CLI Reference

Full command reference for the openweb CLI.

## Core Commands

### `sites` — List available sites

```bash
openweb sites                    # text table
openweb sites --json             # [{name, transport, operationCount, permission}]
```

### `<site>` — Show site info

```bash
openweb <site>                   # text: transport, auth, operations
openweb <site> --json            # {name, operations: [{id, method, path, permission}]}
```

### `<site> <operation>` — Show operation details

```bash
openweb <site> <op>              # text: method, path, params, response shape
openweb <site> <op> --json       # {id, method, path, permission, parameters}
openweb <site> <op> --full       # extended details (includes AsyncAPI info)
openweb <site> <op> --example    # real example params from fixtures
```

### `<site> exec <operation> '<params>'` — Execute

```bash
openweb <site> exec <op> '{"key":"value"}'
openweb <site> exec <op> '{}' --cdp-endpoint http://localhost:9222
openweb <site> exec <op> '{}' --output file
```

**Shorthand:** `openweb <site> <op> '{"key":"value"}'` (passing a JSON argument as the third positional arg triggers exec automatically).

- **stdout**: JSON result (success)
- **stderr**: JSON error with `failureClass` (failure)
- Exit 0 = success, 1 = failure
- Auto-spill: responses over `--max-response` (default 4096 bytes) write to temp file; stdout returns `{status, output, size, truncated}`

**Configuration (`~/.openweb/config.json`):**
```json
{
  "debug": true,                // verbose debug output (request/response details)
  "timeout": 30000,             // operation timeout in ms (default 30000)
  "recordingTimeout": 120000,   // compile --script timeout in ms (default 120000)
  "userAgent": "...",           // custom User-Agent
  "browser": {
    "port": 9222,               // CDP port (default 9222)
    "headless": true,           // headless mode (default true)
    "profile": "/path/to/dir"   // Chrome profile directory
  }
}
```

## Browser Management

The CLI auto-starts a managed headless browser when an operation requires one. No manual setup needed — `exec` launches Chrome on demand and connects automatically.

For manual control, these commands are available as optional overrides:

```bash
openweb browser start [--headless] [--port 9222] [--profile <dir>]
openweb browser stop
openweb browser restart        # re-copy profile + clear token cache
openweb browser status
```

**How it works:** When a browser is needed, the CLI copies auth-relevant files from your default Chrome profile (or `--profile <dir>`) to a temp directory, then launches Chrome with `--remote-debugging-port=9222`. `exec` auto-detects the running instance — no `--cdp-endpoint` needed. `browser start` is only needed if you want to pre-launch with specific options (e.g., a custom profile or port).

**Token caching:** Successful auth requests cache cookies in `$OPENWEB_HOME/tokens/<site>/` (default `~/.openweb/tokens/<site>/`). Cache auto-expires by TTL (1h default or JWT exp). `browser restart` clears the cache.

**Limitation:** Browser/capture orchestration is singleton. One managed browser instance at a time.

## Login

```bash
openweb login <site>             # open site in default browser for login
```

After login: `openweb verify <site>` to confirm auth works.

## Capture

```bash
openweb capture start                       # auto-starts browser if not running
openweb capture start --cdp-endpoint http://localhost:9222  # explicit CDP endpoint
openweb capture start --isolate --url https://example.com   # isolated tab capture
openweb capture stop
openweb capture stop --session <id>
```

Records browser traffic for later compilation. Prints a session ID to stdout.

| Flag | Purpose |
|------|---------|
| `--cdp-endpoint <url>` | Chrome DevTools Protocol endpoint (optional — auto-detected from managed browser) |
| `--output <dir>` | Output directory (default: `./capture/` or `./capture-<session>/` with `--isolate`) |
| `--isolate` | Isolate capture to a single new tab (for multi-worker) |
| `--url <url>` | URL to navigate (required with `--isolate`) |
| `--session <id>` | Stop a specific session (required if multiple active) |

## Compile

```bash
openweb compile <site-url> --capture-dir <dir>
openweb compile <site-url> --script ./record.ts
openweb compile <site-url> --capture-dir <dir> --curation <file>
```

Transforms captured traffic into a site package. Requires `--capture-dir` (manual capture) or `--script` (scripted recording).

| Flag | Purpose |
|------|---------|
| `--capture-dir <dir>` | Load from an existing capture bundle |
| `--script <file>` | Scripted recording — child process killed after 120s. See `references/capture-guide.md` for templates |
| `--curation <file>` | Apply manual curation overrides (CSRF type, excluded ops, etc.) |

## Verify

```bash
openweb verify <site>                        # single site (node-transport, read ops only)
openweb verify <site> --browser              # include page-transport ops (auto-starts browser)
openweb verify <site> --write                # include write/delete ops (transact excluded)
openweb verify <site> --browser --write      # full verify: all transports + write ops
openweb verify --all                         # all sites sequentially
openweb verify --all --browser               # all sites with browser support
openweb verify --all --report json           # machine-readable drift report
openweb verify --all --report markdown       # reviewable markdown report
```

Site-level status vocabulary: `PASS` | `DRIFT` | `FAIL` | `auth_expired`

`--browser` auto-starts the managed browser if not already running.
`--write` replays write/delete operations (use with caution — transact ops always excluded).
`--report` is only valid with `--all`.

## Registry

```bash
openweb registry list            # registered sites with versions
openweb registry install <site>  # archive site package to registry
openweb registry rollback <site> # revert to previous version
openweb registry show <site>     # version history
```

## Permission System

| Permission | HTTP Methods | Default Policy |
|---|---|---|
| `read` | GET, HEAD | **allow** — executes without prompt |
| `write` | POST, PUT, PATCH | **prompt** — returns structured error for relay |
| `delete` | DELETE | **prompt** — returns structured error for relay |
| `transact` | checkout/purchase/payment | **deny** — blocked by default |

Users customize in `$OPENWEB_HOME/permissions.yaml` (default `~/.openweb/permissions.yaml`).

## Transports

Configured per-site, not chosen by the agent:

- **node**: HTTP from Node.js — with or without browser auth
- **page**: HTTP via `page.evaluate()` in the browser
- **adapter**: Arbitrary JS in the browser page via page.evaluate (Telegram, WhatsApp)

---

## Related References

- [site-doc.md](site-doc.md) — Per-site documentation standards (DOC.md, PROGRESS.md)
- [discover.md](discover.md) — Discovery workflow
- [compile.md](compile.md) — Compilation workflow
- [troubleshooting.md](troubleshooting.md) — Debugging site issues

---

*For development, use `pnpm --silent dev` instead of `openweb`.*
