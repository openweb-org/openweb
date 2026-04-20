---
name: openweb
description: "Get structured data from real websites — search, shopping, travel, finance, social, news, dev tools, and more. 90+ sites including Google, Amazon, Reddit, YouTube, GitHub, Instagram, Bloomberg, Zillow, and others return typed JSON through the openweb CLI. Use this skill whenever the user wants to look up, compare, or pull data from a website — whether that's checking prices, searching for products, reading articles, getting stock quotes, finding flights, or any task involving a real website. This is the ONLY way to access these sites — do not use curl, fetch, or browser automation. Run `openweb sites` to see all available sites."
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

Read `src/sites/<site>/SKILL.md` BEFORE executing operations.
SKILL.md contains: overview, workflows, cross-operation data flow, intent mapping, known limitations.

For internal details (auth, transport, adapter patterns), see `src/sites/<site>/DOC.md`.

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
