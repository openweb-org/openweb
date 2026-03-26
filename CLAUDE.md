# OpenWeb

Agent-native way to access any website. Bridging agent CLI and human GUI through API.

## Quick Start

```bash
pnpm install && pnpm build
pnpm test              # run all tests
pnpm lint              # biome lint
pnpm dev sites         # list available sites
pnpm dev <site> exec <op> '{...}'   # execute an operation
```

## Documentation

- **Shipped skill:** `skill/openweb/` (SKILL.md router, references, knowledge)
- **Architecture & system docs:** `doc/main/README.md`
- **Dev workflow & guides:** `doc/dev/development.md`
- **Progress history:** `doc/PROGRESS.md`
- **Active work:** `doc/todo/`
- **Historical docs:** `doc/archive/`

## Project Structure

```
src/
  compiler/
    analyzer/       # filter → cluster → differentiate → classify → schema
    generator/      # openapi.ts, asyncapi.ts, package.ts (M36 split)
    ws-analyzer/    # WS capture → classify → cluster → schema (M35)
    recorder.ts     # CDP capture orchestration
    prober.ts       # Post-compile endpoint verification
  runtime/
    executor.ts     # Main dispatch (HTTP + WS)
    http-executor.ts, browser-fetch-executor.ts, node-ssr-executor.ts
    ws-executor.ts, ws-connection.ts, ws-router.ts, ws-runtime.ts
    cache-manager.ts, token-cache.ts
    test-runner.ts  # verify command implementation
    primitives/     # Auth/CSRF/signing resolvers
  capture/          # CDP browser recording
  commands/         # CLI command handlers
  types/            # Meta-spec type system
  sites/            # Site packages (openapi.yaml, DOC.md, adapters/)
  lib/
    site-resolver.ts, spec-loader.ts, site-package.ts
    param-validator.ts, permissions.ts, permission-derive.ts
    logger.ts, config.ts, cookies.ts, adapter-params.ts
    errors.ts, ssrf.ts, openapi.ts, asyncapi.ts
skill/openweb/      # The shipped skill (references, knowledge)
```
