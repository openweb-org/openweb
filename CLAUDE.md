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
    types.ts          # Core types (RecordedRequestSample, SampleResponse)
    types-v2.ts       # Pipeline v2 contracts (5-phase type definitions)
    recorder.ts       # HAR parsing + scripted recording
    analyzer/         # Phase 2: label → normalize → cluster → schema → auth
      analyze.ts      # Orchestrator: analyzeCapture() → AnalysisReport
      labeler.ts      # Sample categorization (api/static/tracking/off_domain)
      path-normalize.ts  # Path template normalization
      graphql-cluster.ts # GraphQL sub-clustering
      auth-candidates.ts # Ranked auth bundling with evidence + CSRF options
      schema-v2.ts    # Schema inference with enum/format controls
      example-select.ts # Tiered example value selection with PII scrub
      classify.ts     # Extraction signals (ssr_next_data, script_json, page_global)
      auth-detect.ts, csrf-detect.ts, signing-detect.ts  # Primitive detection
    curation/         # Phase 3: apply-curation.ts, scrub.ts (PII)
    generator/        # Phase 4: generate-v2.ts (OpenAPI + AsyncAPI emission)
    ws-analyzer/      # WS capture → classify → cluster → schema
  runtime/
    executor.ts     # Main dispatch (HTTP + WS)
    http-executor.ts, browser-fetch-executor.ts, node-ssr-executor.ts
    ws-executor.ts, ws-connection.ts, ws-router.ts, ws-runtime.ts
    cache-manager.ts, token-cache.ts
    navigator.ts    # CLI navigation helper (render site/operation info)
    primitives/     # Auth/CSRF/signing resolvers
  lifecycle/        # Verify, registry, fingerprint (site drift detection)
  capture/          # CDP browser recording (body-size-gate, no content filtering)
  commands/         # CLI command handlers
  types/            # Meta-spec type system
  sites/            # Site packages (openapi.yaml, DOC.md, adapters/)
  lib/
    site-resolver.ts, spec-loader.ts, site-package.ts
    param-validator.ts, permissions.ts, permission-derive.ts
    logger.ts, config.ts, cookies.ts, adapter-params.ts
    errors.ts, ssrf.ts, openapi.ts, asyncapi.ts
    manifest.ts, url-builder.ts, response-parser.ts, csrf-scope.ts
    config/             # Config files: blocked-domains, blocked-paths, tracking-cookies, static-extensions
skill/openweb/      # The shipped skill (references, knowledge)
```
