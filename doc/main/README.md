# OpenWeb Documentation

> Entry point and navigation guide for the internals.
> Last updated: 2026-04-21 (647c20c)

## Quick Start

| Task | Command |
|------|---------|
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| List sites | `pnpm dev sites` |
| Inspect a site | `pnpm dev <site>` |
| Execute an operation | `pnpm dev <site> <op> '{...}'` |

## Documentation Map

| Path | Purpose |
|------|---------|
| [architecture.md](architecture.md) | System model, component boundaries, site-package lifecycle |
| [runtime.md](runtime.md) | Operation dispatch, browser lifecycle, auth cascade, request construction |
| [primitives/README.md](primitives/README.md) | Auth, CSRF, signing, extraction, pagination, page-plan primitives |
| [adapters.md](adapters.md) | `CustomRunner` contract, lifecycle, and when to keep code instead of config |
| [meta-spec.md](meta-spec.md) | `x-openweb` fields, type system, validation, package format |
| [compiler.md](compiler.md) | Capture -> analyze -> curate -> generate -> verify pipeline |
| [browser-capture.md](browser-capture.md) | CDP recording bundle and capture-session behavior |
| [security.md](security.md) | SSRF, redirects, error model, adapter trust boundary |
| [../dev/development.md](../dev/development.md) | Practical dev workflow and commands |
| [../dev/adding-sites.md](../dev/adding-sites.md) | Repo-local add-site workflow companion |
| [../../skills/openweb/SKILL.md](../../skills/openweb/SKILL.md) | Shipped operator skill: use, add-site, troubleshoot |

## Code Structure

```text
src/
├── cli.ts
├── commands/
│   ├── exec.ts, show.ts, sites.ts, test.ts, verify.ts
│   ├── browser.ts, capture.ts, compile.ts, registry.ts
├── runtime/
│   ├── executor.ts              # public barrel
│   ├── http-executor.ts         # HTTP dispatcher + protocol router entry
│   ├── browser-fetch-executor.ts
│   ├── extraction-executor.ts
│   ├── node-ssr-executor.ts
│   ├── adapter-executor.ts
│   ├── browser-lifecycle.ts, page-plan.ts, warm-session.ts
│   ├── request-builder.ts, redirect.ts, response-unwrap.ts
│   ├── operation-context.ts, session-executor.ts, cache-manager.ts, token-cache.ts
│   ├── ws-cli-executor.ts, ws-executor.ts, ws-runtime.ts, ws-pool.ts, ws-router.ts, ws-connection.ts
│   └── primitives/
├── compiler/
│   ├── analyzer/, curation/, generator/, ws-analyzer/
│   ├── recorder.ts, types.ts, types-v2.ts
├── capture/
│   ├── session.ts, har-capture.ts, ws-capture.ts
│   ├── state-capture.ts, dom-capture.ts, bundle.ts, connection.ts
├── lifecycle/
│   ├── verify.ts, shape-diff.ts, registry.ts
├── lib/
│   ├── site-resolver.ts, site-package.ts, spec-loader.ts
│   ├── param-validator.ts, url-builder.ts, template-resolver.ts
│   ├── permissions.ts, permission-derive.ts, response-parser.ts
│   ├── openapi.ts, asyncapi.ts, adapter-helpers.ts
│   ├── config.ts, manifest.ts, errors.ts, ssrf.ts
│   └── config/*.json
├── types/
│   ├── extensions.ts, primitives.ts, ws-primitives.ts
│   ├── adapter.ts, manifest.ts, schema.ts, validator.ts
└── sites/                       # source site packages + per-site docs
```

## Reading Order

### New to the codebase

1. [architecture.md](architecture.md)
2. [runtime.md](runtime.md)
3. [meta-spec.md](meta-spec.md)
4. [primitives/README.md](primitives/README.md)

### Working in a specific area

| Area | Start here |
|------|------------|
| Runtime dispatch or browser behavior | [runtime.md](runtime.md), [security.md](security.md) |
| New auth / CSRF / extraction primitive | [primitives/README.md](primitives/README.md), [meta-spec.md](meta-spec.md) |
| Custom site code | [adapters.md](adapters.md) |
| Compiler or capture | [compiler.md](compiler.md), [browser-capture.md](browser-capture.md) |
| Developer workflow | [../dev/development.md](../dev/development.md) |
| Adding or expanding a site | [../dev/adding-sites.md](../dev/adding-sites.md), [../../skills/openweb/add-site/guide.md](../../skills/openweb/add-site/guide.md) |

## Key Concepts

| Concept | Meaning | Doc |
|---------|---------|-----|
| **3-layer model** | L1 package/spec, L2 declarative runtime config, L3 `CustomRunner` escape hatch | [architecture.md](architecture.md) |
| **Execution path** | `node`, `page`, `extraction`, `adapter`, or `ws` depending on the operation entry and `x-openweb` | [runtime.md](runtime.md) |
| **`x-openweb`** | OpenAPI/AsyncAPI extension carrying transport, auth, CSRF, signing, extraction, page-plan, and adapter config | [meta-spec.md](meta-spec.md) |
| **`PagePlan`** | Runtime-owned page acquisition: reuse, navigate, ready selector, settle, warm | [primitives/page-plan.md](primitives/page-plan.md) |
| **`auth_check`** | Body-shape rules that synthesize `needs_login` even on HTTP 200 responses | [primitives/auth.md](primitives/auth.md) |
| **Templated params** | Parameter-level `x-openweb.template` for derived wire values | [meta-spec.md](meta-spec.md) |
| **`dispatchOperation()`** | Top-level protocol router used by CLI exec | [runtime.md](runtime.md) |
| **Capture bundle** | HAR, WS frames, browser state, and DOM snapshots recorded via CDP | [browser-capture.md](browser-capture.md) |

## Source Docs vs Shipped Docs

There are three different documentation surfaces in this repo:

1. `doc/main/` explains the internals and architecture.
2. `skills/openweb/` is the shipped operator skill. It must stay self-contained and workflow-oriented.
3. `src/sites/<site>/{SKILL.md,DOC.md,PROGRESS.md}` are source-side site notes used during development.

The runtime contract is narrower than the source tree. At execution time, site loading depends on the site package files (`openapi.yaml`, `manifest.json`, `examples/`, optional `asyncapi.yaml`, optional compiled `adapters/`, and `DOC.md` for notes). The source-side per-site `SKILL.md` and `PROGRESS.md` are authoring artifacts, not runtime-required files.

## Documentation Hygiene

- Prefer stable descriptions over volatile counts.
- When runtime/auth/transport behavior changes, update both `doc/main/` and `skills/openweb/`.
- When a source-site workflow changes, update the relevant `src/sites/<site>/` docs in the same pass.

## Development Workflow

Use [../dev/development.md](../dev/development.md) for commands, build/test flow, and repo-local conventions.

normalize-adapter collapsed per-site page/extraction/capture lifecycle into shared runtime primitives (PagePlan, `script_json`/`ssr_next_data`/`html_selector`/`page_global_data`, `response_capture`, CustomRunner). To keep future site work from re-introducing low-level page primitives, a CI guardrail tracks their usage per site:

```bash
pnpm tsx scripts/adapter-pattern-report.ts              # human-readable report
pnpm tsx scripts/adapter-pattern-report.ts --check      # exit 1 on regression vs baseline
pnpm tsx scripts/adapter-pattern-report.ts --write-baseline  # refresh after legitimate reductions
```

The report counts `page.goto(`, `page.evaluate(fetch(...))`, `page.on('response', ...)`, `querySelector*`, and `__NEXT_DATA__` in `src/sites/*/adapters/*.ts`. The permanent custom bucket (see `doc/todo/normalize-adapter/final/design.md`) is declared in the script. Baseline counts live in `scripts/adapter-pattern-baseline.json`; a vitest guard (`src/lib/adapter-patterns.test.ts`) fails CI when any site exceeds its baseline, so normalization ratchets downward only.

Replacements:

| Low-level pattern | Use instead |
|---|---|
| `page.goto(` / `page.waitForSelector(...)` | `x-openweb.page_plan` — `entry_url`, `ready`, `wait_until`, `settle_ms`, `warm` |
| `page.evaluate(fetch(...))` | `transport: page` with declared `auth` / `csrf` / `signing`, or `helpers.pageFetch` inside a CustomRunner |
| `page.on('response', ...)` | `extraction.type: response_capture` with `match_url` + `unwrap` |
| `querySelector(...)` + `textContent` | `extraction.type: html_selector` (trivial) or `page_global_data` (anything with nesting or logic) |
| `__NEXT_DATA__` parsing | `extraction.type: ssr_next_data` or `script_json` with `#__NEXT_DATA__` selector |
