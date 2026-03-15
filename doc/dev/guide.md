# OpenWeb — Dev Guide

> **Last updated**: 2026-03-15 (commit `25e9f9d`)

## Tech Stack

| Component | Tool | Version |
|---|---|---|
| Language | TypeScript (strict, no `any`) | ES2022 |
| Runtime | Node.js | 20+ |
| Build | tsup (ESM → dist/) | 8.x |
| Test | Vitest | 3.x |
| Lint | Biome | 1.x |
| CLI | yargs | 18.x |
| Browser | Playwright | 1.52+ (not yet installed) |
| Schema | AJV | 8.x |
| Package mgr | pnpm | - |

## Project Structure

```
src/
├── cli.ts                    # Entry point, yargs routing
├── commands/                 # CLI commands (compile, exec, show, sites, test)
├── compiler/
│   ├── recorder.ts           # HAR/metadata parsing
│   ├── generator.ts          # OpenAPI + manifest emission
│   └── analyzer/             # cluster → filter → differentiate → schema → annotate
├── runtime/
│   ├── executor.ts           # Operation execution (SSRF-safe fetch)
│   └── navigator.ts          # CLI navigation helper
├── lib/
│   ├── errors.ts             # Structured error contract
│   ├── openapi.ts            # OpenAPI parsing, URL building
│   └── ssrf.ts               # SSRF validation (IPv4/v6, DNS, metadata)
└── fixtures/
    └── open-meteo-fixture/   # Test fixture (hand-written L1 spec)
```

## Commands

```bash
pnpm build          # tsup → dist/
pnpm test           # vitest (24/25 pass, 1 blocked by Playwright)
pnpm lint           # biome check
```

## Current Implementation Status

**Working (L1 only)**:
- CLI: `sites` → `show` → `exec` → `test` full flow
- Compiler phases 2-4: filter → cluster → differentiate → schema → annotate → emit
- Runtime: `direct_http` mode with SSRF protection, redirect handling, schema validation
- Error contract: EXECUTION_FAILED, TOOL_NOT_FOUND, INVALID_PARAMS

**Not yet implemented (v2 additions)**:
- Playwright browser integration (capture, CDP connection)
- L2 primitive handlers (auth/csrf/signing/pagination/extraction)
- L3 code adapter execution
- `session_http` and `browser_fetch` modes
- Phase 3 Classify (primitive detection + mode probing)
- x-openweb extension support in spec parsing

-> See: [doc/note.md](../note.md) — roadmap (M0-M5)

## Code Conventions

- Max 400 lines/file
- Immutability by default
- Explicit error handling, no silent failures
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
