# OpenWeb

Reverse-engineer any website into a typed API skill package.

## Quick Start

```bash
pnpm install && pnpm build
pnpm test              # run all tests
pnpm lint              # biome lint
pnpm dev sites         # list available sites
pnpm dev <site> exec <op> '{...}'   # execute an operation
```

## Documentation

- **Architecture & system docs:** `-> See: doc/main/README.md`
- **Dev workflow & guides:** `-> See: doc/dev/development.md`
- **Progress history:** `-> See: doc/PROGRESS.md`
- **Active work:** `-> See: doc/todo/`

## Project Structure

```
src/
  runtime/      # Operation execution, primitive resolvers
  compiler/     # Capture → analyze → classify → emit
  capture/      # CDP browser recording
  types/        # Meta-spec type system
  sites/        # Site packages
  commands/     # CLI commands
  lib/          # Shared utilities (SSRF, errors, OpenAPI)
skill/openweb/  # The shipped skill (references, knowledge)
```
