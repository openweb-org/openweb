# CLI Reference

Full command reference for the openweb CLI.

## Core Commands

### `sites` — List available sites

```bash
openweb sites                    # one site per line (quarantined sites marked)
openweb sites --json             # [{name, transport, operationCount, permission}]
```

### `<site>` — Show site info

```bash
openweb <site>                   # text: site details and operations
openweb <site> --json            # JSON site summary with operations
```

### `<site> <operation>` — Show operation details

```bash
openweb <site> <op>              # text: method, path, params, response shape
openweb <site> <op> --json       # JSON operation detail
openweb <site> <op> --full       # extended details (includes WS/AsyncAPI info)
openweb <site> <op> -f           # alias for --full
openweb <site> <op> --example    # example params from fixtures
```

### `<site> exec <operation> '<params>'` — Execute

```bash
openweb <site> exec <op> '{"key":"value"}'
openweb <site> exec <op> '{}' --cdp-endpoint http://127.0.0.1:9222
openweb <site> exec <op> '{}' --output file
openweb <site> exec <op> '{}' --max-response 8192
```

**Auto-exec shorthand:** `openweb <site> <op> '{"key":"value"}'` triggers exec when the third positional arg is a JSON object and no show-mode flags (`--json`, `--full`, `-f`, `--example`) are present.

**Output contract:**

- **stdout**: JSON result body on success
- **stderr**: JSON error with `failureClass` on failure
- **Exit code**: 0 = success, 1 = failure

**Auto-spill:** Responses over `--max-response` bytes (default 4096) write to a temp file. stdout returns `{status, output, size, truncated}` pointing to the file. `--output file` forces all responses to a temp file (stdout returns `{status, output, size}`).

## Browser Management

The CLI auto-starts a managed headless Chrome when an operation requires browser access. No manual setup needed — `exec`, `verify --browser`, and `capture start` all launch Chrome on demand and connect automatically.

Auto-start copies auth-relevant files (Cookies, Local Storage, Session Storage, Web Data, Preferences) from the user's default Chrome profile to a temp directory, then launches Chrome with `--remote-debugging-port`. Concurrent auto-start calls are serialized via a filesystem lock. A background watchdog kills idle browsers after 5 minutes.

For manual control:

```bash
openweb browser start [--headless] [--port 9222] [--profile <dir>]
openweb browser stop
openweb browser restart
openweb browser status
```

- **`start`** — Pre-launch with specific options. Reports existing instance if already running
- **`stop`** — Kill managed Chrome, clean up temp profile and watchdog
- **`restart`** — Saves open tabs, stops, re-copies profile, starts, restores tabs. Use after `openweb login <site>` to pick up fresh cookies
- **`status`** — Report whether managed Chrome is running and CDP is responding

Override profile source with `--profile <dir>` or `browser.profile` in config. Default port: 9222. One managed browser at a time.

**Headed mode:** The managed browser is headless by default. Use `--no-headless` when the user needs to interact with it (CAPTCHA solving, debugging). Set `"browser": {"headless": false}` in config for persistent headed mode. Example: `openweb browser restart --no-headless`.

## Login

```bash
openweb login <site>
```

Opens the site URL in the managed browser (via CDP new-tab) if running, otherwise falls back to the system default browser. After logging in, run `openweb browser restart` to re-copy auth cookies.

## Capture

```bash
openweb capture start
openweb capture start --cdp-endpoint http://127.0.0.1:9222
openweb capture start --isolate --url https://example.com
openweb capture stop
openweb capture stop --session <id>
```

Records browser traffic via CDP for later compilation. Prints a session ID to stdout. Auto-starts managed browser if no `--cdp-endpoint` is provided. Runs until `Ctrl+C` or `capture stop`.

| Flag | Purpose |
|------|---------|
| `--cdp-endpoint <url>` | Explicit CDP endpoint (auto-starts managed browser if omitted) |
| `--output <dir>` | Output directory (default: `./capture/`, or `./capture-<session>/` with `--isolate`) |
| `--isolate` | Isolate capture to a single new tab |
| `--url <url>` | URL to navigate (required with `--isolate`) |
| `--session <id>` | Stop a specific session (required if multiple active) |

## Compile

```bash
openweb compile <site-url> --capture-dir <dir>
openweb compile <site-url> --script ./record.ts
```

Transforms captured traffic into a site package. Requires either `--capture-dir` or `--script`. Analysis artifacts written to `$OPENWEB_HOME/compile/<site>/`.

| Flag | Purpose |
|------|---------|
| `--capture-dir <dir>` | Load from an existing capture bundle |
| `--script <file>` | Scripted recording (killed after recording timeout, default 120s) |

## Verify

```bash
openweb verify <site>                        # single site (node-transport, read ops only)
openweb verify <site> --ops op1,op2          # only verify specific operations
openweb verify <site> --browser              # include page-transport ops (auto-starts browser)
openweb verify <site> --write                # include write/delete ops (transact always excluded)
openweb verify <site> --browser --write      # full verify: all transports + write ops
openweb verify --all                         # all sites
openweb verify --all --report json           # machine-readable drift report
openweb verify --all --report markdown       # reviewable markdown report
```

**Status vocabulary:** `PASS` | `DRIFT` | `FAIL` | `auth_expired`

- `--write` replays write/delete operations (transact always excluded, warning printed to stderr)
- `--report` only valid with `--all`
- Exit code 1 if any site has non-PASS status

## Registry

```bash
openweb registry list              # registered sites with current versions
openweb registry install <site>    # archive site package to registry
openweb registry rollback <site>   # revert to previous version
openweb registry show <site>       # version history
```

## Permission System

| Permission | Derived From | Default Policy |
|---|---|---|
| `read` | GET, HEAD, and any unlisted method | **allow** — executes without prompt |
| `write` | POST, PUT, PATCH | **prompt** — returns structured error for relay |
| `delete` | DELETE | **prompt** — returns structured error for relay |
| `transact` | paths matching `/checkout\|purchase\|payment\|order\|subscribe/` | **deny** — blocked |

Transact is path-based and takes precedence over HTTP method. Customizable via config:

```json
{
  "permissions": {
    "defaults": { "write": "allow" },
    "sites": { "github": { "write": "allow", "delete": "prompt" } }
  }
}
```

Site-specific overrides take precedence over defaults.

## Configuration

All config from `$OPENWEB_HOME/config.json` (`OPENWEB_HOME` defaults to `~/.openweb`):

```json
{
  "debug": false,                 // verbose debug output
  "timeout": 30000,               // operation timeout (ms)
  "recordingTimeout": 120000,     // compile --script timeout (ms)
  "userAgent": "...",             // auto-detected from local Chrome; fallback Mac Chrome/134
  "browser": {
    "port": 9222,                 // CDP port
    "headless": true,             // headless mode
    "profile": "/path/to/dir"     // source Chrome profile for auth file copy
  },
  "permissions": { "..." }        // see Permission System above
}
```

## Transports

Configured per-site in the OpenAPI spec, not chosen at runtime:

- **node** — HTTP from Node.js (with or without browser-extracted auth)
- **page** — HTTP via `page.evaluate()` in the browser context
- **adapter** — Arbitrary JS in the browser page via `page.evaluate()`

---

## Related References

- [troubleshooting.md](troubleshooting.md) — Debugging failures
- [x-openweb.md](x-openweb.md) — Extension field reference

---

*For development, use `pnpm --silent dev` instead of `openweb`.*
