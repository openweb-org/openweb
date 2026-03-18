# Development Guide

> Build, test, run, and debug OpenWeb.
> Last updated: 2026-03-18 (commit: M22)

## Prerequisites

- Node.js 20+
- pnpm
- Google Chrome (for browser-dependent features)

---

## Quick Start

```bash
pnpm install        # Install dependencies
pnpm build          # Build (tsup → dist/ + compile adapters)
pnpm test           # Run tests (362 pass)
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
pnpm dev sites --json                          # Machine-readable JSON

# List operations for a site (shows Notes hint if notes.md exists)
pnpm dev instagram-fixture
pnpm dev instagram-fixture --json              # Machine-readable JSON (includes hasNotes)

# Show operation details (params + response schema)
pnpm dev instagram-fixture getTimeline
pnpm dev instagram-fixture getTimeline --json   # Machine-readable JSON
pnpm dev instagram-fixture getTimeline --example # Generate example params

# Execute an operation (auto-exec: JSON arg triggers exec mode)
pnpm dev instagram-fixture getTimeline '{}'

# Execute with explicit exec keyword (still supported)
pnpm dev instagram-fixture exec getTimeline '{}'

# Execute with explicit CDP endpoint
pnpm dev instagram-fixture getTimeline '{}' --cdp-endpoint http://localhost:9222

# Auto-spill: responses > --max-response (default 4096) written to temp file
pnpm dev instagram-fixture getTimeline '{}' --max-response 8192

# Always write response to file
pnpm dev instagram-fixture getTimeline '{}' --output file
```

### Browser Management

```bash
# Managed Chrome — auto-copies default Chrome profile, launches with CDP
pnpm dev browser start
pnpm dev browser start --headless              # No window
pnpm dev browser stop                          # Stop, preserve token cache
pnpm dev browser restart                       # Re-copy profile + clear token cache
pnpm dev browser status                        # Check if running

# Open site in default browser for login
pnpm dev login instagram-fixture
```

### Compile a Site

```bash
# Compile from URL (interactive)
pnpm dev compile https://api.example.com

# Compile with scripted recording
pnpm dev compile https://api.example.com --script ./scripts/record.ts

# Compile with probing (validates classify heuristics via real GET requests)
pnpm dev compile https://api.example.com --probe
pnpm dev compile https://api.example.com --probe --cdp-endpoint http://localhost:9222
```

### Run Site Tests

```bash
pnpm dev instagram-fixture test
```

### Verify Sites (Drift Detection)

```bash
# Verify a single site
pnpm dev verify catfact-fixture

# Batch verify all sites
pnpm dev verify --all

# Drift report (JSON or markdown)
pnpm dev verify --all --report
pnpm dev verify --all --report markdown
```

### Registry (Version Management)

```bash
pnpm dev registry list                    # List registered sites
pnpm dev registry install catfact-fixture # Archive fixture to registry
pnpm dev registry rollback catfact-fixture # Revert to previous version
pnpm dev registry show catfact-fixture    # Show version history
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
# Start managed browser
pnpm dev browser start

# Log in if needed
pnpm dev login instagram-fixture
# → log in in Chrome, then:
pnpm dev browser restart

# Execute an operation (auto-detects managed browser)
pnpm dev instagram-fixture getTimeline '{}'
```

---

## Project Structure

```
src/
├── cli.ts                    # Entry point, yargs routing
├── commands/                 # CLI commands
│   ├── exec.ts               # Execute operation (auto-spill, --output file)
│   ├── init.ts               # Seed fixtures to ~/.openweb/sites/
│   ├── show.ts               # Show site/operation info (--json, --example)
│   ├── browser.ts            # Browser lifecycle (start/stop/restart/status/login)
│   ├── compile.ts            # Compile site → skill package
│   ├── capture.ts            # CDP browser capture
│   ├── test.ts               # Run site tests
│   ├── sites.ts              # List available sites (--json)
│   ├── verify.ts             # Verify sites and detect drift
│   └── registry.ts           # Registry management (install/rollback)
├── runtime/                  # Operation execution (3 modes + L3)
├── types/                    # Meta-spec type system
├── compiler/                 # Site compilation pipeline
├── capture/                  # Browser CDP recording
├── lifecycle/                # Drift detection, verification, registry
│   ├── fingerprint.ts        # Response shape fingerprinting
│   ├── verify.ts             # Site verification engine
│   └── registry.ts           # Version management + install/rollback
├── knowledge/                # Runtime knowledge data (heuristics, failure recording)
│   ├── heuristics.ts         # Probe success rate tracking + staleness decay (30d), decayedScore() exported
│   └── failures.ts           # Auto-records verify DRIFT/FAIL to ~/.openweb/knowledge/
├── lib/                      # Shared utilities (SSRF, errors, OpenAPI, manifest, permissions)
└── fixtures/                 # 51 verified site packages

.claude/skills/openweb/
├── SKILL.md                  # Agent skill (Draft→Curate→Verify workflow)
└── references/               # Agent knowledge docs (M19)
    ├── archetypes.md         # Site archetype patterns
    ├── auth-patterns.md      # Auth primitive selection guide
    ├── compile-review.md     # Compile output review checklist
    └── troubleshooting.md    # Common failure modes and fixes
```

-> See: [doc/main/README.md](../main/README.md) — full code structure with per-file annotations

---

## Site Resolution

The runtime searches for skill packages in this order:

1. `~/.openweb/sites/<site>/openapi.yaml` — User-installed sites (primary, seeded by `openweb init`)
2. `./src/fixtures/<site>/openapi.yaml` — Development fixtures (dev fallback)
3. `~/.openweb/registry/<site>/current` → `~/.openweb/registry/<site>/<version>/openapi.yaml` — Registry (versioned)

`openweb init` copies bundled fixtures from `src/fixtures/` to `~/.openweb/sites/` (idempotent, skip-if-exists).

Site names must match `/^[a-z0-9][a-z0-9_-]*$/`.

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
src/                                          # Unit tests (pnpm test)
├── types/validator.test.ts
├── runtime/primitives/primitives.test.ts
├── lib/response-parser.test.ts
└── ...

tests/integration/                            # Integration tests (separate from pnpm test)
├── phase2-fixtures.test.ts
├── instagram-integration.test.ts
└── runner.ts                                 # Live site runner (requires CDP)

src/fixtures/*/tests/*.test.json              # Per-site fixture tests
```

Test JSON format:

```json
{
  "operation_id": "search_location",
  "cases": [
    {
      "input": {
        "name": "Berlin",
        "count": 1
      },
      "assertions": {
        "status": 200,
        "response_schema_valid": true
      }
    }
  ]
}
```

---

## Benchmark Suite

Agent validation benchmarks live in `tests/benchmark/`. Each benchmark is a scripted task that an agent must complete end-to-end. 10 tasks cover the original 4 execution modes plus the new extraction and MSAL auth paths:

| # | Task | Mode |
|---|------|------|
| 01 | direct_http (Open-Meteo) | direct_http |
| 02 | session_http (Instagram) | session_http |
| 03 | session_http (GitHub) | session_http |
| 04 | session_http (YouTube) | session_http |
| 05 | browser_fetch (Discord) | browser_fetch |
| 06 | L3 adapter (Telegram) | L3 adapter |
| 07 | Auth failure handling | error recovery |
| 08 | DOM extraction (Hacker News) | extraction + `html_selector` |
| 09 | Next.js SSR extraction (Walmart) | extraction + `ssr_next_data` |
| 10 | MSAL auth (Microsoft Word) | `sessionStorage_msal` |

Use these to validate that agent skill changes do not break the end-to-end flow.

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
| CDP connection refused | Run `pnpm dev browser start` |
| Auth fails on exec | Run `pnpm dev login <site>` then `pnpm dev browser restart` |
| Permission denied/required | Update `~/.openweb/permissions.yaml` or confirm the operation |
| SSRF validation error | Target URL must be HTTPS + public IP |
| "Site not found" | Check fixture exists in `src/fixtures/` or `~/.openweb/sites/` |

---

## Detailed Documentation

- [doc/main/](../main/README.md) — Architecture and component docs
- [Adding Sites](adding-sites.md) — How to add a new site fixture
