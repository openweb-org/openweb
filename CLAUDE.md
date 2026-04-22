# OpenWeb

Agent-native way to access any website. Bridging agent CLI and human GUI through API.

## Quick Start

```bash
pnpm install && pnpm build
pnpm test              # run all tests
pnpm lint              # biome lint
pnpm dev sites         # list available sites
pnpm dev <site> <op> '{...}'   # execute an operation
```

## Documentation

- **Shipped skill:** `skills/openweb/` (SKILL.md router, references, knowledge)
- **Architecture & system docs:** `doc/main/README.md`
- **Dev workflow & guides:** `doc/dev/development.md`
- **Progress history:** `doc/PROGRESS.md`
- **Project docs:** `projects/active/` (active work) and `projects/archive/` (historical docs), symlinked from the sibling openweb-projects repo, commit separately

## Documentation Sync

When running /update-doc, also check and sync `skills/openweb/` — this repo ships skill docs as a deliverable alongside code. See `doc/main/README.md` § Skill Documentation for the governing principles and structure. Priority areas: files that reference runtime behavior, CLI flags, x-openweb fields, or transport/auth semantics.

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
      constant-headers.ts # Detect constant headers across cluster samples
      schema-v2.ts    # Schema inference with enum/format controls
      example-select.ts # Tiered example value selection with PII scrub
      classify.ts     # Extraction signals (ssr_next_data, script_json, page_global)
      differentiate.ts # Query vs path param differentiation
      auth-detect.ts, csrf-detect.ts, signing-detect.ts  # Primitive detection
    curation/         # Phase 3: apply-curation.ts, scrub.ts (PII)
    generator/        # Phase 4: generate-v2.ts (OpenAPI + AsyncAPI emission)
    ws-analyzer/      # WS capture → classify → cluster → schema
  runtime/
    executor.ts     # Main dispatch (HTTP + WS)
    http-executor.ts, browser-fetch-executor.ts, node-ssr-executor.ts
    browser-lifecycle.ts  # Auto browser management (ensureBrowser, auth cascade, watchdog)
    warm-session.ts       # Anti-bot sensor warm-up (Akamai, DataDome cookie wait)
    response-unwrap.ts    # Generic response unwrap (x-openweb.unwrap dot-path extraction)
    session-executor.ts, adapter-executor.ts, extraction-executor.ts
    ws-executor.ts, ws-connection.ts, ws-router.ts, ws-runtime.ts
    cache-manager.ts, token-cache.ts
    navigator.ts    # CLI navigation helper (render site/operation info)
    page-polyfill.ts, page-candidates.ts  # Browser page utilities
    primitives/     # Auth/CSRF/signing resolvers
  lifecycle/        # Verify, registry, shape-diff (site drift detection)
  capture/          # CDP browser recording (body-size-gate, no content filtering)
  commands/         # CLI command handlers
  types/            # Meta-spec type system
  sites/            # Site packages (openapi.yaml, DOC.md, adapters/)
  lib/
    site-resolver.ts, spec-loader.ts, site-package.ts
    param-validator.ts, permissions.ts, permission-derive.ts
    logger.ts, config.ts, cookies.ts, adapter-params.ts
    errors.ts, ssrf.ts, openapi.ts, asyncapi.ts
    adapter-helpers.ts  # pageFetch, graphqlFetch — injected into adapters via runtime
    manifest.ts, url-builder.ts, response-parser.ts, csrf-scope.ts
    config/             # Config files: blocked-domains, blocked-paths, tracking-cookies, static-extensions
skills/openweb/      # The shipped skill (references, knowledge)
install-skill.sh    # Skill installer for Claude Code, Codex, OpenCode, OpenClaw
```
