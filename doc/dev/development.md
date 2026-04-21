# Development Guide

> Build, run, verify, and debug OpenWeb from the repo.
> Last updated: 2026-04-21 (647c20c)

## Prerequisites

- Node.js 20+
- pnpm
- Google Chrome

## Core Scripts

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm test:integration   # optional, needs a real browser session
```

`pnpm dev` runs the source CLI through `tsx`. The packaged `openweb` binary runs from `dist/`.

## Day-to-Day CLI Usage

### Inspect and execute

```bash
pnpm dev sites
pnpm dev <site>
pnpm dev <site> <op>
pnpm dev <site> <op> --json
pnpm dev <site> <op> --example

pnpm dev <site> <op> '{}'
pnpm dev <site> exec <op> '{}'
pnpm dev <site> <op> '{}' --cdp-endpoint http://127.0.0.1:9222
pnpm dev <site> <op> '{}' --max-response 8192
pnpm dev <site> <op> '{}' --output file
```

Auto-exec triggers when the third positional arg is a JSON object and no show-mode flags are present.

### Browser lifecycle

```bash
pnpm dev browser start
pnpm dev browser start --no-headless
pnpm dev browser stop
pnpm dev browser restart
pnpm dev browser status
pnpm dev login <site>
```

Notes:

- most runtime paths auto-start a managed browser when needed
- `login` opens the managed browser if one is running, otherwise the system browser
- `browser restart` re-copies the Chrome profile; it does not directly clear the per-site token cache

### Capture and compile

```bash
pnpm dev capture start
pnpm dev capture start --isolate --url https://example.com
pnpm dev capture stop
pnpm dev capture stop --session <id>

pnpm dev compile https://example.com --capture-dir ./capture
pnpm dev compile https://example.com --script ./scripts/record-site.ts
```

`compile` requires either `--capture-dir` or `--script`.

Compile artifacts land in:

- `$OPENWEB_HOME/compile/<site>/` for reports
- `$OPENWEB_HOME/sites/<site>/` for the generated package

### Verify and registry

```bash
pnpm dev <site> test

pnpm dev verify <site>
pnpm dev verify <site> --ops op1,op2
pnpm dev verify <site> --write
pnpm dev verify <site> --browser
pnpm dev verify --all --report json

pnpm dev registry list
pnpm dev registry show <site>
pnpm dev registry install <site>
pnpm dev registry rollback <site>
```

`--browser` pre-starts and keeps the managed browser alive during long verify runs. Page/adapters can still auto-start a browser even without that flag.

## Recommended Loop

```text
edit -> pnpm test -> pnpm build -> narrow real-site verify
```

For runtime or site-package work, end with a real CLI execution or `verify` run against the touched site.

## Repo Layout

```text
src/
├── cli.ts
├── commands/
├── runtime/
├── compiler/
├── capture/
├── lifecycle/
├── lib/
├── types/
└── sites/
tests/
├── integration/
└── benchmark/
```

See [../main/README.md](../main/README.md) for the full annotated tree.

## Site Resolution Order

At runtime, a site is resolved in this order:

1. `$OPENWEB_HOME/sites/<site>/`
2. `$OPENWEB_HOME/registry/<site>/current`
3. `dist/sites/<site>/`
4. `src/sites/<site>/` (dev fallback)

Site names must match `/^[a-z0-9][a-z0-9_-]*$/`.

## Source Site Package Layout

```text
src/sites/<site>/
├── openapi.yaml
├── asyncapi.yaml            # optional
├── manifest.json
├── DOC.md
├── SKILL.md                 # source-side site guide
├── PROGRESS.md              # source-side history
├── adapters/                # optional .ts source, bundled to .js on build
└── examples/
    └── <operation>.example.json
```

Bundled runtime packages are slimmer. `pnpm build` copies the runtime-required subset into `dist/sites/`.

## Example Fixtures

Example fixtures drive `--example` and `verify`:

```json
{
  "operation_id": "searchProducts",
  "order": 1,
  "cases": [
    {
      "input": { "query": "laptop" },
      "assertions": { "status": 200, "response_schema_valid": true }
    }
  ]
}
```

Useful fields:

- `order`: execution order for dependent workflows
- `replay_safety`: `safe_read` or `unsafe_mutation`

## Build and Packaging

`pnpm build` does three things:

1. bundles the CLI with `tsup`
2. bundles adapter `.ts` source files into per-site `.js`
3. syncs bundled site assets into `dist/sites/` and `~/.openweb/sites/`

For final QA against the packaged binary:

```bash
pnpm build
pnpm pack:check
npm install -g ./openweb-org-openweb-*.tgz

openweb sites
openweb <site> <op> '{}'
```

## Troubleshooting

| Issue | Check |
|-------|-------|
| Browser-dependent op fails | `pnpm dev browser status` |
| Login still not picked up | `pnpm dev login <site>`, then `pnpm dev browser restart` |
| Stale auth cache suspicion | remove `$OPENWEB_HOME/tokens/<site>/`, then retry |
| Site not found | resolution order above; check `src/sites/` and `$OPENWEB_HOME/sites/` |
| Compile produced weak output | inspect `$OPENWEB_HOME/compile/<site>/analysis-summary.json` first |

## Related Docs

- [../main/README.md](../main/README.md)
- [adding-sites.md](adding-sites.md)
- [../../skills/openweb/add-site/guide.md](../../skills/openweb/add-site/guide.md)
