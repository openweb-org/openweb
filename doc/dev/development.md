# Development Guide

> Build, test, run, and debug OpenWeb.
> Last updated: 2026-03-16 (commit: `dd2b17e`)

## Prerequisites

- Node.js 20+
- pnpm
- Google Chrome (for browser-dependent features)

---

## Quick Start

```bash
pnpm install        # Install dependencies
pnpm build          # Build (tsup → dist/ + compile adapters)
pnpm test           # Run tests (167/167 pass)
pnpm lint           # Biome lint check
```

---

## Tech Stack

| Component | Tool | Version |
|-----------|------|---------|
| Language | TypeScript (strict, no `any`) | ES2022 |
| Runtime | Node.js | 20+ |
| Build | tsup (ESM → dist/) | 8.x |
| Test | Vitest | 3.x |
| Lint | Biome | 1.x |
| CLI | yargs | 18.x |
| Browser | Playwright | 1.52+ |
| Schema | AJV | 8.x |
| Package mgr | pnpm | — |

---

## CLI Usage

### Progressive Navigation

```bash
# List all compiled sites
pnpm dev sites

# List operations for a site
pnpm dev instagram-fixture

# Show operation details (params + response schema)
pnpm dev instagram-fixture getTimeline

# Execute an operation
pnpm dev instagram-fixture exec getTimeline '{}'

# Execute with CDP (for session_http / browser_fetch)
pnpm dev instagram-fixture exec getTimeline '{}' --cdp-endpoint http://localhost:9222
```

### Browser Capture

```bash
# 1. Start Chrome with remote debugging
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/openweb-chrome

# 2. Browse to the target site

# 3. Start capture (Ctrl+C to stop)
pnpm dev capture start --cdp-endpoint http://localhost:9222

# 4. Or stop from another terminal
pnpm dev capture stop
```

### Compile a Site

```bash
# Compile from URL (interactive)
pnpm dev compile https://api.example.com

# Compile with scripted recording
pnpm dev compile https://api.example.com --script ./scripts/record.ts
```

### Run Site Tests

```bash
pnpm dev instagram-fixture test
```

---

## Development Cycle

```
Code change → Build → Test → Verify with real site
```

### 1. Build

```bash
pnpm build
```

tsup compiles TypeScript to `dist/` (ESM). Adapter `.ts` files in fixtures are compiled to `.js`.

### 2. Test

```bash
# Full suite
pnpm test

# Single test file
pnpm test src/types/validator.test.ts

# Watch mode
pnpm test -- --watch
```

### 3. Verify with Real Site

For L2/L3 features, verify against a real browser session:

```bash
# Start Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 --no-first-run --user-data-dir=/tmp/openweb-chrome

# Log in to the target site in Chrome

# Execute an operation
pnpm dev instagram-fixture exec getTimeline '{}' --cdp-endpoint http://localhost:9222
```

---

## Project Structure

```
src/
├── cli.ts                    # Entry point, yargs routing
├── commands/                 # CLI commands
│   ├── exec.ts               # Execute operation
│   ├── show.ts               # Show site/operation info
│   ├── compile.ts            # Compile site → skill package
│   ├── capture.ts            # CDP browser capture
│   ├── test.ts               # Run site tests
│   └── sites.ts              # List available sites
├── runtime/                  # Operation execution (3 modes + L3)
├── types/                    # Meta-spec type system
├── compiler/                 # Site compilation pipeline
├── capture/                  # Browser CDP recording
├── lib/                      # Shared utilities (SSRF, errors, OpenAPI)
└── fixtures/                 # 9 test site packages
```

-> See: [doc/main/README.md](../main/README.md) — full code structure with per-file annotations

---

## Site Resolution

The runtime searches for skill packages in this order:

1. `~/.openweb/sites/<site>/openapi.yaml` — User-installed sites
2. `./sites/<site>/openapi.yaml` — Project-local sites
3. `./src/fixtures/<site>/openapi.yaml` — Development fixtures

---

## Fixture Layout

Each fixture is a complete skill package:

```
src/fixtures/instagram-fixture/
├── openapi.yaml          # OpenAPI spec with x-openweb extensions
├── manifest.json         # Package metadata
├── adapters/             # L3 code (WhatsApp, Telegram only)
│   └── whatsapp.ts
└── tests/
    └── getTimeline.test.json
```

---

## Test Structure

```
src/
├── types/validator.test.ts           # Schema validation tests
├── runtime/primitives/primitives.test.ts  # L2 primitive unit tests
└── fixtures/*/tests/*.test.json       # Per-site integration tests
```

Test JSON format:

```json
{
  "operationId": "getTimeline",
  "params": {},
  "expected": {
    "status": 200,
    "bodyContains": ["items"]
  }
}
```

---

## Code Conventions

- Max 400 lines/file — extract when larger
- Immutability by default
- Explicit error handling, no silent failures
- TypeScript strict mode, no `any`
- ESM only (import/export, no require)
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `pnpm dev` fails | Run `pnpm build` first |
| CDP connection refused | Start Chrome with `--remote-debugging-port=9222` |
| Auth fails on exec | Log in to the site in Chrome first |
| SSRF validation error | Target URL must be HTTPS + public IP |
| "Site not found" | Check fixture exists in `src/fixtures/` or `~/.openweb/sites/` |

---

## Detailed Documentation

- [doc/main/](../main/README.md) — Architecture and component docs
- [Adding Sites](adding-sites.md) — How to add a new site fixture
