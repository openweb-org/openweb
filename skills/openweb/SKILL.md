---
name: openweb
description: "Typed JSON access to 90+ real websites — Google, Amazon, Reddit, YouTube, GitHub, Instagram, Bloomberg, Zillow, and more — across search, shopping, travel, finance, social, news, and dev tools. Use to read, search, post, comment, message, or otherwise interact with these sites (prices, products, articles, stock quotes, flights, posts, comments, DMs, etc.). Run `openweb sites` for the full list."
license: MIT
compatibility: "Requires the `openweb` CLI (npm: @openweb-org/openweb). Some sites need a managed Chrome session. See references/cli.md for runtime details."
metadata:
  version: "0.1.5"
  openclaw:
    links:
      homepage: "https://getopenweb.com"
      repository: "https://github.com/openweb-org/openweb"
    requires:
      bins: [openweb]
      env: [OPENWEB_HOME]
      config: ["$OPENWEB_HOME/config.json"]
    install:
      - kind: node
        package: "@openweb-org/openweb"
        bins: [openweb]
---

# OpenWeb

Agent-native way to access any website. Bridging agent CLI and web GUI through API.

## Load Discipline

- Do not read every file in this folder.
- Start with SKILL.md. Follow one route at a time.

## Use Existing Site

### 1. Find the site

```bash
openweb sites                        # list all available sites
```

If the site has no package, do NOT say "unsupported." Route to add-site/guide.md.

### 2. Check readiness

```bash
openweb <site>                       # transport, auth, operations list
```

- `Requires browser: yes` — browser auto-starts when needed; no manual setup required
- `Requires login: yes` — user must be logged in via their browser session

### 3. Read site notes

Prefer site docs when they exist in your workspace:

- **Source repo:** read `src/sites/<site>/SKILL.md` for workflows and intent mapping, then `src/sites/<site>/DOC.md` for internals.
- **Shipped/runtime package:** only `DOC.md`, specs, manifest, examples, and adapters are guaranteed. Per-site `SKILL.md` and `PROGRESS.md` are source-tree docs and are not shipped into `$OPENWEB_HOME/sites/<site>/`.

If only the shipped package is available, rely on `openweb <site>`, `openweb <site> <op>`, examples, and `DOC.md`.

### 4. Inspect the operation

```bash
openweb <site> <op>                  # params, response shape, permission tier
openweb <site> <op> --example        # real example params from fixtures
```

Check the operation's permission tier before executing:

| Tier | Default | Behavior |
|---|---|---|
| `read` | allow | GET-like operations — execute freely |
| `write` | prompt | Creates/updates — ask user before executing |
| `delete` | prompt | Destructive — ask user before executing |
| `transact` | deny | Financial/irreversible — always skip |

### 5. Execute

```bash
openweb <site> <op> '{"key":"value"}'    # stdout=JSON, stderr=JSON error
```

Auto-spill: responses over 4096 bytes write to a temp file.

`openweb <site> exec <op> '{...}'` is equivalent — `exec` can be omitted when the third arg is JSON.

### 6. On failure

Errors on stderr include `failureClass`:

| failureClass | Action |
|---|---|
| `needs_browser` | Browser auto-starts; if it fails, check Chrome installation. Fallback: `openweb browser start` |
| `needs_login` | `openweb login <site>` then `openweb browser restart` |
| `needs_page` | Open a tab to the site URL |
| `bot_blocked` | `openweb browser restart --no-headless`, user solves CAPTCHA in visible browser, then retry. For persistent sites, set `"browser": {"headless": false}` in config |
| `permission_denied` | Update `permissions` in `$OPENWEB_HOME/config.json` |
| `permission_required` | Ask user for confirmation, then retry |
| `retriable` | Wait a few seconds, retry (max 2) |
| `fatal` | Don't retry — fix params or check site name |

If the table above doesn't resolve it, read references/troubleshooting.md.

### 7. Missing site or coverage

Site doesn't exist or lacks needed operations? Read add-site/guide.md.

## Add / Expand / Upgrade Site

Read add-site/guide.md

## Fix a Problem

Read references/troubleshooting.md

## File Map

All paths relative to `skills/openweb/`.

### add-site/ (workflow — load in sequence)

| File | Load when |
|---|---|
| `add-site/guide.md` | Entry point for add/expand workflow |
| `add-site/probe.md` | Probe step: CDP browser-side discovery |
| `add-site/capture.md` | Capture step: recording browser traffic |
| `add-site/review.md` | Review step: reading analysis-summary.json |
| `add-site/curate-operations.md` | Curate: naming, noise, params, permissions |
| `add-site/curate-runtime.md` | Curate: auth, transport, extraction |
| `add-site/curate-schemas.md` | Curate: response schemas, examples, PII |
| `add-site/verify.md` | Verify: runtime + spec + doc loop |
| `add-site/document.md` | Document: per-site SKILL.md + DOC.md + PROGRESS.md, knowledge updates |

### references/ (lookup — load independently)

| File | Load when |
|---|---|
| `references/cli.md` | CLI command syntax, flags, stdout/stderr |
| `references/x-openweb.md` | Full x-openweb field schema |
| `references/troubleshooting.md` | Something broke — classify, diagnose, fix |

### knowledge/ (patterns — load at decision points)

| File | Load when |
|---|---|
| `knowledge/archetypes.md` | Expected operations by site category |
| `knowledge/auth-routing.md` | Auth type unknown — signal-to-family lookup |
| `knowledge/auth-primitives.md` | Configuring auth — config and gotchas |
| `knowledge/bot-detection.md` | Transport/capture decisions |
| `knowledge/extraction.md` | Extraction signals — SSR/DOM patterns |
| `knowledge/graphql.md` | GraphQL — persisted queries, batching |
| `knowledge/ws.md` | WebSocket — message/connection patterns |
| `knowledge/adapter-recipes.md` | Adapter patterns, code templates, pitfalls |
| `knowledge/transport-upgrade.md` | Transport tier decisions, node feasibility, API discovery |
