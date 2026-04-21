# Adding or Expanding a Site

> Repo-local companion to the shipped add-site skill.
> Last updated: 2026-04-21 (647c20c)

The authoritative workflow lives in [../../skills/openweb/add-site/guide.md](../../skills/openweb/add-site/guide.md). This doc is the short, repo-specific version: which files to touch, which commands to run, and how the repo organizes site packages.

## Choose the Lane First

Decide the implementation lane before writing files:

| Lane | Use when |
|------|----------|
| **Replay (`node`)** | stable HTTP API works from Node.js |
| **Replay (`page`)** | request must run in a real browser page |
| **Extraction** | data lives in SSR, DOM, script tags, or page globals |
| **Adapter** | module systems, request signing, binary protocols, or complex page logic |
| **WS** | the operation is fundamentally WebSocket-based |

Do the browser-side probe first. The shipped workflow docs in `skills/openweb/add-site/` are the source of truth for that process.

## Repo Files You Usually Touch

```text
src/sites/<site>/
├── openapi.yaml
├── asyncapi.yaml            # optional
├── manifest.json
├── DOC.md
├── SKILL.md
├── PROGRESS.md
├── adapters/                # optional
└── examples/
```

Common shared files:

- `skills/openweb/` when the workflow or references need updating
- `doc/main/` or `doc/dev/` when shared runtime/dev behavior changed

## Minimal Authoring Checklist

1. Create `src/sites/<site>/`.
2. Add `openapi.yaml` (and `asyncapi.yaml` if needed).
3. Add `manifest.json`.
4. Add `examples/<operation>.example.json`.
5. Add `DOC.md`, `SKILL.md`, and `PROGRESS.md`.
6. Add `adapters/*.ts` only if the site genuinely needs a `CustomRunner`.

## Minimal Examples

### Public or browser-independent HTTP

```yaml
servers:
  - url: https://api.example.com
    x-openweb:
      transport: node
paths:
  /search:
    get:
      operationId: searchItems
      x-openweb:
        permission: read
```

### Browser-backed HTTP

```yaml
servers:
  - url: https://api.example.com
    x-openweb:
      transport: page
      auth:
        type: cookie_session
      page_plan:
        entry_url: https://www.example.com/app
        ready: "#app"
        warm: true
```

### Extraction

```yaml
paths:
  /news:
    get:
      operationId: getTopStories
      x-openweb:
        permission: read
        extraction:
          type: html_selector
          page_url: /news
          selectors:
            title: .titleline > a
          multiple: true
```

### Adapter

```yaml
x-openweb:
  adapter:
    name: example-web
    operation: getThing
```

## Adapter Rules

- put adapter source in `src/sites/<site>/adapters/*.ts`
- prefer `PagePlan` over hand-rolled `page.goto()` / `waitForSelector()` glue
- use `ctx.helpers` for injected helpers; import `nodeFetch` / `interceptResponse` directly only when needed
- run `pnpm build` after adapter changes so the bundled `.js` is refreshed

See [../main/adapters.md](../main/adapters.md) and [../../skills/openweb/add-site/curate-runtime.md](../../skills/openweb/add-site/curate-runtime.md).

## Capture and Compile

```bash
pnpm dev capture start --isolate --url https://example.com
pnpm dev capture stop --session <id>

pnpm dev compile https://example.com --capture-dir ./capture-<id>
pnpm dev compile https://example.com --script ./scripts/record-site.ts
```

Compile reports are written to `$OPENWEB_HOME/compile/<site>/`.

## Verify

```bash
pnpm build
pnpm test

pnpm dev <site> <op> '{}'
pnpm dev <site> test
pnpm dev verify <site>
pnpm dev verify <site> --write
pnpm dev verify <site> --ops op1,op2
```

Use `--browser` when you want the managed browser started and kept alive before a long verify run.

## Packaging Notes

`pnpm build` bundles adapter source and copies runtime assets into `dist/sites/`. The bundled runtime currently relies on:

- `openapi.yaml`
- optional `asyncapi.yaml`
- `manifest.json`
- `DOC.md`
- `examples/*.example.json`
- compiled `adapters/*.js`

The source-side `SKILL.md` and `PROGRESS.md` remain development artifacts in `src/sites/`.

## Related Docs

- [../../skills/openweb/add-site/guide.md](../../skills/openweb/add-site/guide.md)
- [../main/meta-spec.md](../main/meta-spec.md)
- [../main/adapters.md](../main/adapters.md)

## Checklist

- [ ] `openapi.yaml` with correct x-openweb extensions
- [ ] `manifest.json` with correct metadata
- [ ] Adapter file (L3 only)
- [ ] Example fixtures in `examples/`
- [ ] `pnpm test` passes
- [ ] Real browser E2E verification
- [ ] Validated against benchmark suite (`tests/benchmark/`) if adding a new execution mode or auth pattern
- [ ] Pitfalls documented in design docs (if applicable)

## Current Sites (Key Examples)

| Site | Layer | Auth | Key pattern |
|---------|-------|------|-------------|
| instagram | L2 | cookie_session + cookie_to_header CSRF | page transport, classic cookie auth |
| bluesky | L2 | localStorage_jwt | JWT from localStorage |
| youtube | L2 | page_global + sapisidhash signing | Window global + signing |
| github | L2 | cookie_session + meta_tag CSRF | SSR extraction |
| reddit | L1 | — (public JSON) | .json suffix endpoints |
| discord | L2 | webpack_module_walk | page transport, Webpack module cache |
| chatgpt | L2 | exchange_chain (GET) | Next-auth session |
| whatsapp | L3 | adapter | Meta require() module |
| telegram | L3 | adapter | teact global state |

Plus ~35 L1 public API sites (no auth needed). Run `pnpm dev sites` for the full list.

## Related Docs

- [doc/main/primitives/](../main/primitives/README.md) — Available L2 primitives
- [doc/main/adapters.md](../main/adapters.md) — L3 CustomRunner interface
- [doc/main/meta-spec.md](../main/meta-spec.md) — x-openweb extension schema
- [doc/main/browser-capture.md](../main/browser-capture.md) — Capture module
