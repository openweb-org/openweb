# Development Guide

> Build, test, run, and debug OpenWeb.
> Last updated: 2026-03-26 (M38)

## Prerequisites

- Node.js 20+
- pnpm
- Google Chrome (for browser-dependent features)

## Quick Start

```bash
pnpm install        # Install dependencies
pnpm build          # Build (tsup -> dist/ + compile adapters)
pnpm test           # Run tests (560 pass)
pnpm lint           # Biome lint check
```

## Tech Stack

| Component | Tool | Version |
|-----------|------|---------|
| Language | TypeScript (strict, no `any`) | ES2022 |
| Runtime | Node.js | 20+ |
| Build | tsup (ESM -> dist/) | 8.x |
| Test | Vitest | 3.x |
| Lint | Biome | 1.x |
| CLI | yargs | 18.x |
| Browser | Playwright | 1.52+ |
| Schema | AJV | 8.x |
| Package mgr | pnpm | -- |

## CLI Usage

### Progressive Navigation

```bash
# List sites / show operations / show operation details
openweb sites
openweb instagram
openweb instagram getTimeline
openweb instagram getTimeline --json     # Machine-readable
openweb instagram getTimeline --example  # Generate example params

# Execute (auto-exec: JSON arg triggers exec mode)
openweb instagram getTimeline '{}'
openweb instagram getTimeline '{}' --cdp-endpoint http://localhost:9222
openweb instagram getTimeline '{}' --max-response 8192  # Auto-spill
openweb instagram getTimeline '{}' --output file        # Always file
```

### Browser Management

```bash
openweb browser start                            # Auto-copies Chrome profile, CDP
openweb browser start --headless                 # No window
openweb browser stop                             # Stop, preserve token cache
openweb browser restart                          # Re-copy profile + clear token cache
openweb browser status                           # Check if running
openweb login instagram                          # Open site in default browser
```

### Compile a Site

```bash
openweb compile https://api.example.com
openweb compile https://api.example.com --script ./scripts/record.ts
openweb compile https://api.example.com --probe --cdp-endpoint http://localhost:9222
openweb compile https://api.example.com --capture-dir ./captures/my-site  # Use existing capture
```

### Run Site Tests / Verify / Registry

```bash
openweb instagram test
openweb verify walmart                           # Single site
openweb verify --all --report markdown           # Batch verify
openweb registry list                            # List registered
openweb registry install walmart                 # Archive
openweb registry rollback walmart                # Revert
```

## Development Cycle

```
Code change -> Build -> Test -> Verify with real site
```

### 1. Build

```bash
pnpm build
```

tsup compiles TypeScript to `dist/` (ESM). Adapter `.ts` files in sites are compiled to `.js`.

### 2. Test

```bash
pnpm test                             # Full suite
pnpm test src/types/validator.test.ts # Single file
pnpm test -- --watch                  # Watch mode
```

### 3. Verify with Real Site

```bash
pnpm dev browser start
openweb login instagram               # Log in in Chrome, then:
pnpm dev browser restart
openweb instagram getTimeline '{}'
```

## Project Structure

```
src/
├── cli.ts                    # Entry point, yargs routing
├── commands/                 # CLI commands (exec, show, browser, compile, capture, test, sites, verify, registry)
├── runtime/                  # Operation execution (HTTP + WS modes)
├── types/                    # Meta-spec type system
├── compiler/                 # Site compilation pipeline
│   ├── analyzer/             #   filter → cluster → differentiate → classify → schema
│   ├── generator/            #   openapi.ts, asyncapi.ts, package.ts
│   └── ws-analyzer/          #   WS capture → classify → cluster → schema
├── capture/                  # Browser CDP recording
├── lib/                      # Shared utilities (SSRF, errors, OpenAPI, AsyncAPI, permissions, logger)
└── sites/                    # Site packages (67 sites)
```

-> See: [doc/main/README.md](../main/README.md) -- full code structure with per-file annotations

## Site Resolution

1. `~/.openweb/sites/<site>/openapi.yaml` -- User-installed (primary, seeded by `openweb init`)
2. `./src/sites/<site>/openapi.yaml` -- Development fixtures (dev fallback)
3. `~/.openweb/registry/<site>/current` -> versioned -- Registry

`openweb init` copies bundled sites to `~/.openweb/sites/` (idempotent). Site names: `/^[a-z0-9][a-z0-9_-]*$/`.

## Fixture Layout

```
src/sites/instagram/
├── openapi.yaml          # OpenAPI spec with x-openweb extensions
├── manifest.json         # Package metadata
├── adapters/             # L3 code (WhatsApp, Telegram only)
└── tests/                # Per-operation test JSON
```

## Test Structure

```
src/**/*.test.ts                      # Unit tests (pnpm test)
tests/integration/                    # Integration tests (requires CDP)
src/sites/*/tests/*.test.json      # Per-site tests
```

Test JSON format:

```json
{
  "operation_id": "search_location",
  "cases": [{ "input": { "name": "Berlin" }, "assertions": { "status": 200, "response_schema_valid": true } }]
}
```

## Benchmark Suite

Agent validation benchmarks in `tests/benchmark/` -- 10 tasks covering all execution modes:

| # | Task | Mode |
|---|------|------|
| 01 | direct_http (Open-Meteo) | direct_http |
| 02-04 | session_http (Instagram/GitHub/YouTube) | session_http |
| 05 | browser_fetch (Discord) | browser_fetch |
| 06 | L3 adapter (Telegram) | L3 adapter |
| 07 | Auth failure handling | error recovery |
| 08-09 | DOM/SSR extraction (HN/Walmart) | extraction |
| 10 | MSAL auth (Microsoft Word) | sessionStorage_msal |

## Code Conventions

- Max 400 lines/file -- extract when larger
- Immutability by default
- Explicit error handling, no silent failures
- TypeScript strict mode, no `any`
- ESM only (import/export, no require)
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `pnpm dev` fails | Run `pnpm build` first |
| CDP connection refused | Run `pnpm dev browser start` |
| Auth fails on exec | Run `pnpm dev login <site>` then `pnpm dev browser restart` |
| Permission denied | Update `~/.openweb/permissions.yaml` or confirm the operation |
| SSRF validation error | Target URL must be HTTPS + public IP |
| "Site not found" | Check `src/sites/` or `~/.openweb/sites/` |

## Detailed Documentation

- [doc/main/](../main/README.md) -- Architecture and component docs
- [Adding Sites](adding-sites.md) -- How to add a new site
