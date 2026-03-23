# CLI Reference

Full command reference for the openweb CLI. All commands run from the project root via `pnpm --silent dev`.

## Core Commands

### `sites` — List available sites

```bash
pnpm --silent dev sites                    # text table
pnpm --silent dev sites --json             # [{name, transport, operationCount, permission}]
```

### `<site>` — Show site info

```bash
pnpm --silent dev <site>                   # text: transport, auth, operations
pnpm --silent dev <site> --json            # {name, operations: [{id, method, path, permission}]}
```

### `<site> <operation>` — Show operation details

```bash
pnpm --silent dev <site> <op>              # text: method, path, params, response shape
pnpm --silent dev <site> <op> --json       # {id, method, path, permission, parameters}
pnpm --silent dev <site> <op> --example    # generate example params JSON
```

### `<site> <operation> '<params>'` — Execute

```bash
pnpm --silent dev <site> <op> '{"key":"value"}'
pnpm --silent dev <site> <op> '{}' --cdp-endpoint http://localhost:9222
pnpm --silent dev <site> <op> '{}' --output file
```

- **stdout**: JSON result (success)
- **stderr**: JSON error with `failureClass` (failure)
- Exit 0 = success, 1 = failure
- Auto-spill: responses over `--max-response` (default 4096 bytes) write to temp file; stdout returns `{status, output, size, truncated}`

## Browser Management

```bash
pnpm --silent dev browser start [--headless] [--port 9222]
pnpm --silent dev browser stop
pnpm --silent dev browser restart        # re-copy profile + clear token cache
pnpm --silent dev browser status
```

**How it works:** `browser start` copies auth-relevant files from your default Chrome profile to a temp directory, then launches Chrome with `--remote-debugging-port=9222`. When running, `exec` auto-detects it — no `--cdp-endpoint` needed.

**Token caching:** Successful auth requests cache cookies in `~/.openweb/tokens/<site>/`. Cache auto-expires by TTL (1h default or JWT exp). `browser restart` clears the cache.

**Limitation:** Browser/capture orchestration is singleton in M25. One managed browser instance at a time.

## Login

```bash
pnpm --silent dev login <site>             # open site in default browser for login
```

After login: `openweb verify <site>` to confirm auth works.

## Capture

```bash
pnpm --silent dev capture start --cdp-endpoint http://localhost:9222
pnpm --silent dev capture stop
```

Records all browser traffic for later compilation. One capture session at a time (singleton in M25).

## Compile

```bash
pnpm --silent dev compile <site-url> [--probe] [--capture-dir <dir>]
```

Transforms captured traffic into a fixture. `--probe` tests endpoints during compile. `--capture-dir` loads from an existing capture bundle instead of launching a new recording.

## Verify

```bash
pnpm --silent dev verify <site>            # single site: PASS/DRIFT/AUTH_FAIL/ERROR per op
pnpm --silent dev verify --all             # all sites sequentially
pnpm --silent dev verify --all --report    # JSON drift report
```

Status vocabulary: `PASS` | `DRIFT` | `AUTH_FAIL` | `ERROR`

## Registry

```bash
pnpm --silent dev registry list            # registered sites with versions
pnpm --silent dev registry install <site>  # archive fixture to registry
pnpm --silent dev registry rollback <site> # revert to previous version
pnpm --silent dev registry show <site>     # version history
```

## Permission System

| Permission | HTTP Methods | Default Policy |
|---|---|---|
| `read` | GET, HEAD | **allow** — executes without prompt |
| `write` | POST, PUT, PATCH | **prompt** — returns structured error for relay |
| `delete` | DELETE | **prompt** — returns structured error for relay |
| `transact` | checkout/purchase/payment | **deny** — blocked by default |

Users customize in `~/.openweb/permissions.yaml`.

## Transports

Configured per-site, not chosen by the agent:

- **node**: HTTP from Node.js — with or without browser auth
- **page**: HTTP via `page.evaluate()` in the browser
- **adapter (L3)**: Arbitrary JS in the browser page (Telegram, WhatsApp)
