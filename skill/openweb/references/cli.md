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
openweb <site> <op> --example    # generate example params JSON
```

### `<site> <operation> '<params>'` — Execute

```bash
openweb <site> <op> '{"key":"value"}'
openweb <site> <op> '{}' --cdp-endpoint http://localhost:9222
openweb <site> <op> '{}' --output file
```

- **stdout**: JSON result (success)
- **stderr**: JSON error with `failureClass` (failure)
- Exit 0 = success, 1 = failure
- Auto-spill: responses over `--max-response` (default 4096 bytes) write to temp file; stdout returns `{status, output, size, truncated}`

## Browser Management

```bash
openweb browser start [--headless] [--port 9222]
openweb browser stop
openweb browser restart        # re-copy profile + clear token cache
openweb browser status
```

**How it works:** `browser start` copies auth-relevant files from your default Chrome profile to a temp directory, then launches Chrome with `--remote-debugging-port=9222`. When running, `exec` auto-detects it — no `--cdp-endpoint` needed.

**Token caching:** Successful auth requests cache cookies in `~/.openweb/tokens/<site>/`. Cache auto-expires by TTL (1h default or JWT exp). `browser restart` clears the cache.

**Limitation:** Browser/capture orchestration is singleton. One managed browser instance at a time.

## Login

```bash
openweb login <site>             # open site in default browser for login
```

After login: `openweb verify <site>` to confirm auth works.

## Capture

```bash
openweb capture start --cdp-endpoint http://localhost:9222
openweb capture stop
```

Records all browser traffic for later compilation. One capture session at a time.

## Compile

```bash
openweb compile <site-url> [--probe] [--capture-dir <dir>]
```

Transforms captured traffic into a site package. `--probe` tests endpoints during compile. `--capture-dir` loads from an existing capture bundle instead of launching a new recording.

## Verify

```bash
openweb verify <site>            # single site: PASS/DRIFT/AUTH_FAIL/ERROR per op
openweb verify --all             # all sites sequentially
openweb verify --all --report    # JSON drift report
```

Status vocabulary: `PASS` | `DRIFT` | `AUTH_FAIL` | `ERROR`

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

Users customize in `~/.openweb/permissions.yaml`.

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
