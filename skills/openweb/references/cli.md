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

**Param quoting:** Always wrap JSON params in single quotes — unquoted JSON (`{key:value}`) errors out with a diagnostic instead of silently falling through to the help screen.

**Output contract:**

- **stdout**: JSON result body on success
- **stderr**: JSON error with `failureClass` on failure
- **Exit code**: 0 = success, 1 = failure

**Auto-spill:** Responses over `--max-response` bytes (default 4096) write to a temp file. stdout returns `{status, output, size, truncated}` pointing to the file. `--output file` forces all responses to a temp file (stdout returns `{status, output, size}`).

## Browser Management

The CLI auto-starts a managed headless Chrome when an operation requires browser access. No manual setup needed — `exec`, browser-backed auth/transport flows, and `capture start` all launch Chrome on demand and connect automatically. `verify --browser` just pre-starts and keeps the managed browser alive for the duration of the verify run.

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

**Headed mode:** The managed browser is headless by default. Pass `--headless false` (or yargs negation `--no-headless`) when the user needs to interact with it (CAPTCHA solving, debugging). Set `"browser": {"headless": false}` in config for persistent headed mode. Example: `openweb browser restart --headless false`.

**Off-screen headed:** When auto-started (e.g., by `exec` or `verify`), headed browsers launch off-screen (`--window-position=10000,10000`) so they don't steal focus. Manual `browser start --headless false` launches on-screen for interactive use (CAPTCHA solving).

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
openweb verify <site>                        # single site (all read-safe ops)
openweb verify <site> --ops op1,op2          # only verify specific operations
openweb verify <site> --browser              # pre-start/keep alive managed browser during verify
openweb verify <site> --write                # include write/delete ops (transact always excluded)
openweb verify <site> --browser --write      # full verify: all transports + write ops
openweb verify --all                         # all sites
openweb verify --all --report                # machine-readable drift report
```

**Status vocabulary:** `PASS` | `DRIFT` | `FAIL` | `auth_expired` | `bot_blocked`

- `--write` replays write/delete operations (transact always excluded, warning printed to stderr)
- `--browser` does **not** change operation selection; browser-backed ops already auto-start Chrome on demand. It only makes the managed browser available up front and keeps it warm during verify.
- `--report` is only valid with `--all`. The parser accepts `--report json` or `--report markdown`, but the current implementation always prints JSON.
- Exit code 1 only for non-pass statuses other than `DRIFT` (`FAIL`, `auth_expired`, `bot_blocked`)

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
  "userAgent": "...",             // default UA for node-side requests; managed Chrome only gets --user-agent when explicitly set in config.json
  "browser": {
    "port": 9222,                 // CDP port
    "headless": true,             // headless mode
    "profile": "/path/to/dir"     // source Chrome profile for auth file copy
  },
  "permissions": { "..." }        // see Permission System above
}
```

## Transports

HTTP transport is configured per-site/per-operation in the OpenAPI spec, not chosen at runtime:

- **node** — HTTP from Node.js (with or without browser-extracted auth)
- **page** — HTTP via `page.evaluate(fetch(...))` in the browser context

`x-openweb.adapter` is a separate CustomRunner hook, not a third transport. Adapter ops still sit on top of the resolved `node` or `page` setup and receive `run(ctx)` with a ready page (or `null` for op-level `transport: node`).

## Trust & Boundaries

**No cryptocurrency / wallet / blockchain.** "Signing" in this skill (e.g. `auth-primitives.md`, `x-openweb.md`) refers to **HTTP request signing** — HMAC headers, `x-client-transaction-id`, `sapisidhash`, etc. used by some sites' web APIs. OpenWeb has no crypto-key, wallet, or on-chain functionality.

**Data boundary.** Cookies, localStorage, IndexedDB stay on the user's machine. Standard browser behavior sends cookies only to their originating sites. OpenWeb does not transmit any user data to openweb-org or any third party. No telemetry, no analytics.

**Comparable patterns.** Reusing the user's Chrome profile to call site APIs as the logged-in user matches the official Claude Code Playwright plugin and tools like `yt-dlp` / `browser-cookie3`.

**Two skill modes.** Most operations are **end-user** (`openweb <site> <op>`). The `add-site/` subtree is **author mode**, invoked only when explicitly asked to add or expand a site — those instructions tell the agent how to capture and curate a site's API surface (analogous to using browser DevTools).

---

## Related References

- [troubleshooting.md](troubleshooting.md) — Debugging failures
- [x-openweb.md](x-openweb.md) — Extension field reference

---

*For development, use `pnpm --silent dev` instead of `openweb`.*
