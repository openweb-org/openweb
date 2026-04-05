# Document

Write per-site documentation and update knowledge after any add-site workflow.

Two outputs:
1. **DOC.md** — per-site skill doc (what can I do here, how do operations connect?)
2. **PROGRESS.md** — append-only history trace (what happened and when)

Optionally update **knowledge/** if you learned something general.

---

## DOC.md — Per-Site Skill Doc

DOC.md is for the agent (or human) *using* the site — not the developer who
compiled it. It answers: "what can I do here, and how do operations connect?"

### Layering with openapi.yaml

DOC.md and `openapi.yaml` serve different roles — avoid duplication:

| Layer | Carries |
|---|---|
| **openapi.yaml** | Structural truth — params, types, schemas, endpoints (machine-readable) |
| **DOC.md** | Semantic truth — intent, workflows, cross-op data flow, gotchas (agent-readable) |

DOC.md covers only what `openapi.yaml` cannot express:

1. **Cross-operation data flow** — `channelId ← listGuildChannels` (OpenAPI has no concept of this)
2. **Intent mapping** — what each operation is for, when to use it
3. **Workflows** — multi-step sequences connecting operations
4. **Non-obvious behavior** — rate limits, required login, response quirks

For full param lists, types, and response schemas: `openweb <site> <op>`.

### Template

The divider (`---`) separates user-facing content (above) from operator
internals (below). An agent using the site reads above the line. An agent
debugging or expanding the site reads below.

```markdown
# <Site Name>

## Overview
One-liner: what this site is, what archetype (e-commerce, social, etc.)

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
| getChannelMessages | read messages | channelId ← listGuildChannels | id, content, author | paginated |

## Quick Start

\```bash
# [Intent description]
openweb <site> exec <op> '<full JSON params>'

# [Another intent]
openweb <site> exec <op> '<full JSON params>'
\```

---

## Site Internals

Everything below is for discover/compile operators and deep debugging.

## API Architecture
- REST / GraphQL / SSR / hybrid?
- What domain(s) does the API live on?
- Unusual patterns (persisted queries, protobuf, JSONP, etc.)

## Auth
- Auth type (cookie_session, page_global, etc.)
- How tokens are obtained
- CSRF/signing requirements

## Transport
- node, page, or adapter? Why?
- If mixed: which ops use which transport and why?
- If adapter: name the file (`adapters/<site>.ts`)

## Extraction
- How data is extracted (direct JSON, ssr_next_data, html_selector, page_global, adapter)
- Parsing quirks

## Known Issues
- Bot detection? (DataDome, PerimeterX, etc.)
- Rate limiting?
- Dynamic fields causing verify DRIFT?
```

### Column guide for Operations table

- **Operation**: operationId from openapi.yaml
- **Intent**: what this achieves (short phrase)
- **Key Input**: main params + source (`← source_operation`). Omit trivial params
- **Key Output**: key response fields the user cares about (not full schema)
- **Notes**: pagination, rate limits, gotchas. Mark entry points (no input dependencies)

The `← source` annotations are the soul of this table — they turn a flat list
into a directed graph so the agent knows where to get each param.

### Required vs optional sections

**Required:** Overview, Workflows, Operations, Quick Start, Auth, Transport,
Known Issues. If a required section has nothing interesting (e.g., Auth for a
public API), a one-liner is enough: `No auth required.`

**Optional:** API Architecture, Extraction — include when non-obvious. The
divider and "Site Internals" heading are always present.

---

## PROGRESS.md — History Trace

Append-only log. Each entry records what changed, why, and what was verified.

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

- After initial add-site workflow → first entry
- After any site update (new operations, auth fix, transport change)
- After knowledge learned during troubleshooting

---

## Knowledge Update

After completing any workflow that taught you something new, decide whether to
save it and where.

### Scope decision

Is this site-specific or general?

| Scope | Where | Example |
|---|---|---|
| **Site-specific** | Site's `DOC.md` | "LinkedIn uses Voyager API with CSRF on all mutations" |
| **General pattern** | `knowledge/` files | "Next.js sites use `__NEXT_DATA__` for SSR extraction" |
| **Both** | Both, with the general version abstracted | Site DOC.md gets the specific detail; knowledge/ gets the pattern |

**Rule of thumb:** if you'd tell the next agent working on a *different* site,
it's general. If it only matters for *this* site, it's site-specific.

### Persistence test

Before saving to knowledge/, verify the learning is durable:

1. **Will this still be true in 6 months?** If no → site-specific DOC.md only
2. **Is this already captured by the code?** If yes → don't save
3. **Does this change how an agent should behave?** If no → not worth saving

### Principles

- **Novel only** — don't duplicate what's in the code or existing docs
- **Patterns, not instances** — "Next.js sites use `__NEXT_DATA__`" not "Walmart uses `__NEXT_DATA__`"
- **Deduplicate** — search existing knowledge files before adding; refine rather than restate
- **Keep files < 200 lines** — split when a file grows too large

### Classify

Which knowledge file does it belong to? Search existing files first.

| File | Scope |
|------|-------|
| `knowledge/auth-routing.md` | Auth family identification signals |
| `knowledge/auth-primitives.md` | Auth, CSRF, signing config and gotchas |
| `knowledge/archetypes/index.md` | Site categories and expected behaviors |
| `knowledge/bot-detection.md` | Detection systems, transport impact, capture strategy |
| `knowledge/extraction.md` | SSR data, DOM, page globals, adapter extraction |
| `knowledge/graphql.md` | Persisted queries, batching, introspection, schema |
| `knowledge/ws.md` | WebSocket message types, connection patterns |

Create a new `knowledge/<topic>.md` only if the pattern doesn't fit any existing
file.

### Write format

Follow the normalized entry format used in knowledge files:

```markdown
### Pattern Name

Description — what it is and when it occurs.

- **Detection signals:** how to recognize this pattern
- **Impact:** what this means for transport, auth, or site modeling
- **Action:** what to do when you encounter it
- **Example:** (optional) concrete example, generalized
```

Not every field is required — skip what's not relevant. The goal: the next agent
encountering this pattern can recognize it and know what to do.

### Size management

After writing, check file size. If a knowledge file exceeds 200 lines:

1. Identify a coherent subtopic that can split out
2. Create a new `knowledge/<subtopic>.md`
3. Move the relevant entries

---

## Checklist

Before marking the Document step complete:

- [ ] DOC.md written with all required sections
- [ ] Operations table has `← source` annotations for cross-op data flow
- [ ] Workflows section covers common multi-step intents
- [ ] Quick Start has copy-paste commands
- [ ] PROGRESS.md has at least one entry
- [ ] Knowledge update: scope decision made (site-specific / general / both / nothing new)
- [ ] If general knowledge: persistence test passed, written to correct knowledge file
