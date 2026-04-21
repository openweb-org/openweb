# OpenWeb — Architecture Overview

> System model, execution surfaces, package lifecycle, and major components.
> Last updated: 2026-04-21 (647c20c)

## Mission

OpenWeb turns real websites into typed operations that agents can inspect, execute, and extend without hand-writing one-off browser scripts for every task. The design bias is consistent throughout the repo:

- prefer declarative specs over code
- prefer site-local configuration over runtime special cases
- keep the runtime small and make drift explicit

## The Three Layers

| Layer | Role | Typical files |
|------|------|---------------|
| **L1: package shape** | OpenAPI / AsyncAPI / manifest describe what exists | `openapi.yaml`, `asyncapi.yaml`, `manifest.json` |
| **L2: declarative behavior** | `x-openweb` encodes transport, auth, CSRF, signing, extraction, page-plan, pagination, auth-check rules | `src/types/extensions.ts`, `src/types/primitives.ts` |
| **L3: custom code** | `CustomRunner` handles the cases that cannot be expressed cleanly in L1/L2 | `src/types/adapter.ts`, `src/runtime/adapter-executor.ts`, `src/sites/*/adapters/` |

The default path is L1 + L2. L3 exists for genuine site-specific logic: custom module systems, per-request signing, binary protocols, or complex in-page orchestration.

## Execution Surfaces

OpenWeb has two transport values and three higher-level execution surfaces:

| Surface | How it is selected | What it does |
|--------|---------------------|--------------|
| **`node` transport** | `x-openweb.transport: node` or default | HTTP from Node.js, optionally using browser-derived auth/CSRF/signing |
| **`page` transport** | `x-openweb.transport: page` | HTTP inside a real browser page via `page.evaluate(fetch(...))` |
| **Extraction** | `x-openweb.extraction` on the operation | Reads data from page state instead of issuing an HTTP request |
| **Adapter** | `x-openweb.adapter` on the server or operation | Runs `CustomRunner.run(ctx)` for site-specific code |
| **WebSocket** | operation entry comes from AsyncAPI/site package | Opens and manages a WS session outside the HTTP transport field |

`adapter`, `extraction`, and `ws` are not `transport` values. They are dispatch branches layered on top of the site package model.

## Request Path

```text
Agent intent
  -> openweb <site> <op> '{...}'
  -> CLI command layer (src/cli.ts + src/commands/*)
  -> dispatchOperation(site, op, params)
  -> site-package lookup (HTTP or WS entry)
  -> runtime executor
     -> node transport
     -> page transport
     -> extraction
     -> adapter
     -> ws
```

Important boundary: `src/runtime/executor.ts` is only the public barrel. The real HTTP dispatcher lives in `src/runtime/http-executor.ts`. WS CLI dispatch is delegated from there to `src/runtime/ws-cli-executor.ts`.

## Major Components

| Component | Responsibility | Key paths |
|-----------|----------------|----------|
| **CLI** | progressive navigation, exec, compile, capture, verify, registry, browser lifecycle commands | `src/cli.ts`, `src/commands/` |
| **Site package loader** | resolves bundled, installed, registry, and dev site roots; builds operation map | `src/lib/site-resolver.ts`, `src/lib/site-package.ts` |
| **Runtime** | executes HTTP and WS operations, manages browser sessions, applies auth/signing/extraction logic | `src/runtime/` |
| **Compiler** | turns CDP captures into site packages and compile reports | `src/compiler/` |
| **Capture** | records traffic, WS frames, state, and DOM signals via CDP | `src/capture/` |
| **Lifecycle** | verify, drift detection, registry management | `src/lifecycle/` |
| **Shared docs/skill** | developer-facing internals plus shipped operator workflow | `doc/`, `skills/openweb/` |

## Site Package Lifecycle

The same site concept exists in several places for different reasons:

| Location | Role |
|----------|------|
| `src/sites/<site>/` | authoring source of truth during development |
| `dist/sites/<site>/` | bundled runtime assets produced by `pnpm build` |
| `$OPENWEB_HOME/sites/<site>/` | installed/generated site packages used by the CLI |
| `$OPENWEB_HOME/registry/<site>/<version>/` | archived versions for rollback/show |

Source packages often carry extra authoring docs (`SKILL.md`, `DOC.md`, `PROGRESS.md`). The runtime-required files are narrower: spec, manifest, examples, optional AsyncAPI, optional compiled adapters, and `DOC.md` for notes.

## Browser and Auth Architecture

The browser model has two distinct pieces:

1. **Managed Chrome** is the actual browser process launched by `src/commands/browser.ts`.
2. **Patchright** is the CDP client used to connect to that browser from the runtime and capture layers.

Authenticated node-transport operations use a per-site token cache at `$OPENWEB_HOME/tokens/<site>/vault.json`. On cache miss or auth failure, the runtime falls back to live browser extraction, managed-profile refresh, and finally a user login loop.

## Design Rules

- **Spec first.** If an operation can be modeled with `node`/`page` transport plus declarative primitives, do that.
- **Transport is encoded in the site package.** The runtime does not guess or auto-upgrade between `node` and `page`.
- **Source docs live with the thing they describe.** Shared runtime behavior belongs in `doc/main/`; operator workflow belongs in `skills/openweb/`; per-site implementation notes belong under `src/sites/<site>/`.
- **Compile and verify reuse the same runtime.** There is no separate “compiler executor”; compile-time verification runs through the same execution stack as normal CLI use.

## Related Docs

- [runtime.md](runtime.md)
- [meta-spec.md](meta-spec.md)
- [primitives/README.md](primitives/README.md)
- [adapters.md](adapters.md)
- [compiler.md](compiler.md)
