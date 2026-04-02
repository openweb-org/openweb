# Site Documentation Guide

## Purpose

Standards for per-site documentation. Every site package should have DOC.md
(current state) and PROGRESS.md (history trace).

**DOC.md is a per-site skill doc.** Its first audience is the agent (or human)
using the site through openweb — not the developer who compiled it. It answers:
"what can I do here, and how do operations connect?" Detail params and schemas
live in `openapi.yaml` (accessible via `openweb <site> <op>`); DOC.md carries
only what the spec cannot express: intent, workflows, cross-operation data flow,
and gotchas.

## When to Use

- `compile.md` Step 3 (Curate) — write DOC.md alongside spec curation
- After any site update (new operations, auth fix, transport change)
- When onboarding a new site package

---

## File Layout

```
src/sites/<site>/
├── openapi.yaml
├── manifest.json
├── DOC.md          ← Per-site skill doc: intent, workflows, data flow
├── PROGRESS.md     ← History: what happened and when
├── adapters/       (optional)
└── examples/       (optional)
```

---

## DOC.md — Per-Site Skill Doc

Always reflects current best understanding. Update on every discover/compile/fix
cycle. The structure is user-first: workflows and operations before site internals.

### Layering with openapi.yaml

DOC.md and `openapi.yaml` serve different roles — avoid duplication:

| Layer | Carries | Format |
|---|---|---|
| **openapi.yaml** | Structural truth — params, types, schemas, endpoints | Machine-readable |
| **DOC.md** | Semantic truth — intent, workflows, cross-op data flow, gotchas | Agent-readable |

DOC.md should only cover what `openapi.yaml` cannot express:
1. **Cross-operation data flow** — `channelId ← listGuildChannels` (OpenAPI has no concept of this)
2. **Intent mapping** — what this operation is for, when to use it
3. **Workflows** — multi-step sequences connecting operations
4. **Non-obvious behavior** — rate limits, required login, response quirks

For full param lists, types, and response schemas, the agent uses
`openweb <site> <op>`.

### Structure

```markdown
# <Site Name>

## Overview
One-liner: what this site is, what archetype (e-commerce, travel, social, etc.)

## Workflows

Common multi-step flows showing cross-operation data flow:

### [Workflow name, e.g., "Find and read messages"]
1. `listGuilds` → pick guild → `guildId`
2. `listGuildChannels(guildId)` → pick channel → `channelId`
3. `getChannelMessages(channelId, limit)` → messages

### [Another workflow]
1. `searchProducts(query)` → results with `productId`
2. `getProductDetail(productId)` → full product info

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| listGuilds | list my servers | — | id, name, icon | entry point |
| listGuildChannels | channels in server | guildId ← listGuilds | id, name, type | |
| getChannelMessages | read messages | channelId ← listGuildChannels | id, content, author, timestamp | paginated (limit, before) |

The `← source` annotations are the soul of this table — they turn a flat
operation list into a directed graph so the agent knows where to get each param.

**Column guide:**
- **Operation**: operationId from openapi.yaml
- **Intent**: what this achieves (short phrase)
- **Key Input**: main params + where to get them (`← source_operation`). Omit trivial params — full list is in `openweb <site> <op>`
- **Key Output**: key response fields the user cares about (not full schema)
- **Notes**: pagination, rate limits, gotchas. Mark entry points (ops with no input dependencies)

## Quick Start

Copy-paste commands for common intents (ordered by workflow):

\```bash
# [Intent 1 description]
openweb <site> exec <op> '<full JSON params>'

# [Intent 2 description]
openweb <site> exec <op> '<full JSON params>'
\```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.
Not needed for basic site usage.

## API Architecture
How the site's API works — the non-obvious parts:
- REST / GraphQL / SSR / hybrid?
- What domain(s) does the API live on?
- Any unusual patterns (persisted queries, protobuf, JSONP, etc.)

## Auth
- Auth type (cookie_session, page_global, etc.)
- How tokens are obtained
- Any CSRF/signing requirements

## Transport
- node, page, or adapter? Why?
- If mixed transport (common): which ops use node, which use adapter? Why the split?
  Example: "Reference data APIs (getCities, getIndustries) use node — public endpoints
  that bypass bot detection. Core ops (searchJobs, getJobDetail) use page adapter for
  DOM extraction."
- If adapter: name the adapter file (`adapters/<site>.ts`)

## Extraction
- How data is extracted (direct JSON response, ssr_next_data, html_selector, page_global, adapter DOM extraction)
- If adapter: briefly describe the extraction strategy (LD+JSON, CSS selectors, page.evaluate fetch)
- Any parsing quirks

## Known Issues
- Bot detection? (DataDome, PerimeterX, etc.)
- Rate limiting?
- Dynamic fields that cause verify DRIFT?
```

**Required sections:** Overview, Workflows, Operations, Quick Start, Auth,
Transport, Known Issues. The rest (API Architecture, Extraction) are optional —
include them when they capture something non-obvious. If a required section has
nothing interesting (e.g., Auth for a public API), a one-liner is enough:
`No auth required.`

---

## PROGRESS.md — History Trace

Append-only log. Same format as project-level `doc/PROGRESS.md`.

### Entry format

```markdown
## YYYY-MM-DD: [Short title]

**What changed:**
- [Key changes]

**Why:**
- [Motivation]

**Verification:** [what was verified — API-level, content-level, build]
**Commit:** [short hash]
```

### When to write

- After initial discover/compile → first PROGRESS entry
- After any site update (new operations, auth fix, etc.)
- After knowledge learned during troubleshooting

---

## Relationship to references/knowledge/

- **references/knowledge/*.md** = general patterns that apply across many sites (auth patterns, archetypes, bot detection strategies)
- **DOC.md** = site-specific knowledge (this site's exact API, this site's auth flow, this site's quirks)

If you learn something during discover/compile:
- Site-specific → write to that site's DOC.md
- General pattern → write to references/knowledge/ (per update-knowledge.md)
- Both → write to both

---

## Related References

- [cli.md](cli.md) — CLI commands including `verify` and `compile`
- [discover.md](discover.md) — Discovery workflow that produces initial DOC.md
- [compile.md](compile.md) — Compilation workflow (DOC.md written at Step 3 Curate)
- [verify.md](verify.md) — Verification process (Doc Verify checks DOC.md against this template)
- [update-knowledge.md](update-knowledge.md) — When to write to references/knowledge/ vs DOC.md
- [troubleshooting.md](troubleshooting.md) — Debugging site issues
