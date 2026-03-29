# Development Guide

> Build, test, run, and debug OpenWeb.
> Last updated: 2026-03-29 (v1+v5 site merge)

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
pnpm dev sites
pnpm dev instagram
pnpm dev instagram getTimeline
pnpm dev instagram getTimeline --json     # Machine-readable
pnpm dev instagram getTimeline --example  # Show example params from fixtures

# Execute (auto-exec: JSON arg triggers exec mode)
pnpm dev instagram getTimeline '{}'
pnpm dev instagram getTimeline '{}' --cdp-endpoint http://localhost:9222
pnpm dev instagram getTimeline '{}' --max-response 8192  # Auto-spill
pnpm dev instagram getTimeline '{}' --output file        # Always file
```

### Browser Management

```bash
pnpm dev browser start                            # Auto-copies Chrome profile, CDP
pnpm dev browser start --headless                 # No window
pnpm dev browser stop                             # Stop, preserve token cache
pnpm dev browser restart                          # Re-copy profile + clear token cache
pnpm dev browser status                           # Check if running
pnpm dev login instagram                          # Open site in default browser
```

### Compile a Site

```bash
pnpm dev compile https://api.example.com
pnpm dev compile https://api.example.com --script ./scripts/record.ts
pnpm dev compile https://api.example.com --probe --cdp-endpoint http://localhost:9222
pnpm dev compile https://api.example.com --capture-dir ./captures/my-site  # Use existing capture
```

### Run Site Tests / Verify / Registry

```bash
pnpm dev instagram test
pnpm dev verify walmart                           # Single site
pnpm dev verify --all --report markdown           # Batch verify
pnpm dev registry list                            # List registered
pnpm dev registry install walmart                 # Archive
pnpm dev registry rollback walmart                # Revert
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
pnpm dev login instagram               # Log in in Chrome, then:
pnpm dev browser restart
pnpm dev instagram getTimeline '{}'
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
└── sites/                    # Site packages (68 sites)
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
└── examples/              # Per-operation example params (PII-scrubbed)
```

## Test Structure

```
src/**/*.test.ts                      # Unit tests (pnpm test)
tests/integration/                    # Integration tests (requires CDP)
src/sites/*/examples/*.example.json  # Per-site example fixtures
```

Example fixture format (used by `--example` and `verify`):

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

## Build → Install → Final QA

During development use `pnpm dev` — it runs source directly via tsx. The final deliverable is the `openweb` binary (installed via npm).

```bash
# 1. Build distributable
pnpm build                          # tsup → dist/ (ESM), adapters compiled

# 2. Pack and inspect
pnpm pack:check                     # dry-run, verify tarball contents (~284kB)
pnpm pack                           # produces openweb-org-openweb-*.tgz

# 3. Global install for final QA
npm install -g ./openweb-org-openweb-*.tgz

# 4. Final QA — use openweb (not pnpm dev)
openweb sites                       # verify bundled site resolution
openweb instagram getTimeline '{}'  # verify execution end-to-end
openweb verify --all                # batch verify all sites
```

When testing the installed binary, replace all `pnpm dev` with `openweb`. The binary resolves sites from `dist/sites/` (bundled read-only) or `~/.openweb/sites/` (user-installed).

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
