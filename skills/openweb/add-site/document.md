# Document

Write per-site documentation and update knowledge after any add-site workflow.

Three outputs per site:

| File | Audience | Purpose | Update mode |
|------|----------|---------|-------------|
| **SKILL.md** | Users / agents | How to use — overview, operations, workflows, quick start, known limitations | In-place, follows /skill-creator format |
| **DOC.md** | Developers / maintainers | How it works internally — architecture, transport decisions, probe evidence, adapter patterns, pitfalls | In-place, always reflects current implementation |
| **PROGRESS.md** | Developers / maintainers | What happened — chronological entries, discovery journey, verification results | Append-only |

Optionally update **knowledge/** if you learned something general.

---

## SKILL.md — Per-Site User Doc

SKILL.md is for the agent (or human) *using* the site. It answers: "what can I
do here, and how do operations connect?"

### Layering with openapi.yaml

SKILL.md and `openapi.yaml` serve different roles — avoid duplication:

| Layer | Carries |
|---|---|
| **openapi.yaml** | Structural truth — params, types, schemas, endpoints (machine-readable) |
| **SKILL.md** | Semantic truth — intent, workflows, cross-op data flow, gotchas (agent-readable) |

SKILL.md covers only what `openapi.yaml` cannot express:

1. **Cross-operation data flow** — `channelId <- listGuildChannels` (OpenAPI has no concept of this)
2. **Intent mapping** — what each operation is for, when to use it
3. **Workflows** — multi-step sequences connecting operations
4. **Non-obvious behavior** — rate limits, required login, response quirks

For full param lists, types, and response schemas: `openweb <site> <op>`.

### Template

```markdown
# <Site Name>

## Overview
One-liner: what this site is, what archetype (e-commerce, social, etc.)

## Workflows

Common multi-step flows showing cross-operation data flow:

### [Workflow name, e.g., "Find and read messages"]
1. `listGuilds` -> pick guild -> `guildId`
2. `listGuildChannels(guildId)` -> pick channel -> `channelId`
3. `getChannelMessages(channelId, limit)` -> messages

### [Another workflow]
1. `searchProducts(query)` -> results with `productId`
2. `getProductDetail(productId)` -> full product info

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| listGuilds | list my servers | — | id, name, icon | entry point |
| listGuildChannels | channels in server | guildId <- listGuilds | id, name, type | |
| getChannelMessages | read messages | channelId <- listGuildChannels | id, content, author | paginated |

## Quick Start

\```bash
# [Intent description]
openweb <site> exec <op> '<full JSON params>'

# [Another intent]
openweb <site> exec <op> '<full JSON params>'
\```

## Known Limitations
- [User-facing limitations: rate limits, missing operations, auth requirements]
```

### Workflow Completeness Standard

**Every write/mutation operation must have a documented read→write chain** showing
which read operation provides the required IDs and params, with explicit
`→ fieldName` arrows tracing each value to its source.

A workflow is **incomplete** if a write op appears without a preceding read op
that supplies its required parameters.

**Canonical example — Uber Eats `addToCart`:**

```markdown
### Add item with customizations
1. `getRestaurantMenu(storeUuid)` → find item → `itemUuid`, `sectionUuid`, `subsectionUuid`
2. `getItemDetails(storeUuid, sectionUuid, subsectionUuid, menuItemUuid)` → `customizationsList` with groups
3. `addToCart(storeUuid, itemUuid, customizations)` → `customizations = {groupUuid: [{uuid: optionUuid, quantity: 1}]}`
```

Key properties of a complete write workflow:
- Every param in the write op traces back to a specific read op's output field
- Field names are explicit (`→ itemUuid`, not just "get the item")
- Multi-hop chains show each intermediate step (read → read → write)
- Constraints are noted inline (`minPermitted`, `maxPermitted`)

**Anti-pattern** — vague workflow missing data flow:
```markdown
### Add comment
1. Get the item ID
2. `addComment(parent, text)`
```

**Correct** — explicit field tracing:
```markdown
### Add comment
1. `getStoryDetail(id)` → `item.id`
2. `addComment(parent=item.id, text)`
```

#### Self-creating chained fixtures

When a write op needs an ID that isn't externally stable (e.g. a tweet you
own, a cart-item generated server-side), don't hand-pin a fixture — chain
the op behind a create op in the same example file using
`${prev.<opId>.<jsonpath>}`. For text fields that the upstream rejects on
duplicates, use the `${now}` template helper for per-run uniqueness. See
`src/lib/template-resolver.ts` for both helpers.

Canonical example — **x write-op cascade**:

1. `createTweet` (order:1) — text uses `${now}` so Twitter's
   duplicate-status (187) check never fires across runs.
2. `likeTweet`, `createBookmark`, `createRetweet`, `reply` (order:2-9) —
   each `tweetId` is `${prev.createTweet.create_tweet.tweet_results.result.rest_id}`.
3. `deleteTweet` (order:20) — cleans up the parent.

Result: every run is hermetic. No fixture rot, no manual ID refresh, no
shared-state pollution. Apply this pattern whenever the create op's
permission is `write` and the inverse op exists in the same site.

### Column guide for Operations table

- **Operation**: operationId from openapi.yaml
- **Intent**: what this achieves (short phrase)
- **Key Input**: main params + source (`<- source_operation`). Omit trivial params
- **Key Output**: key response fields the user cares about (not full schema)
- **Notes**: pagination, rate limits, gotchas. Mark entry points (no input dependencies)

The `<- source` annotations are the soul of this table — they turn a flat list
into a directed graph so the agent knows where to get each param.

### Required vs optional sections

**Required:** Overview, Workflows, Operations, Quick Start. If a required
section has nothing interesting (e.g., single-operation site), a one-liner is
enough.

**Optional:** Known Limitations — include when there are user-visible
constraints worth documenting.

### Documenting skipped ops

If an op ships with `examples/<op>.example.json.skip` (renamed from
`.example.json`), it is intentionally excluded from `verify` and won't
appear in PASS/FAIL counts. Document each one in **Known Limitations**
with the reason and the unblocker. Common reasons:

- Upstream renamed an internal mutation/queryId — needs a fresh capture
  from the live page (e.g. x `deleteDM`: `DMMessageDeleteMutation` no
  longer in Twitter's bundles).
- Op needs externally-produced state we can't synthesize in a chain
  (e.g. x `hideReply`/`unhideReply`: Twitter blocks hiding self-replies,
  so the op needs a 2nd account replying to our test tweet).
- Op produces side-effects on shared state with no rollback path
  (e.g. ops that consume one-shot tokens or post to public channels).

Format:

```markdown
## Known Limitations
- `deleteDM` — skipped (`.example.json.skip`); Twitter renamed
  `DMMessageDeleteMutation`. Unblock: capture new queryId + opName from
  a live DM-delete in managed Chrome, update the adapter map.
- `hideReply` / `unhideReply` — skipped; Twitter blocks hiding own
  replies on own thread. Unblock: have a 2nd account reply to a test
  tweet, then point fixture at that reply ID.
```

---

## DOC.md — Per-Site Developer Doc

DOC.md is for the developer or maintainer working on the site package. It
answers: "how does this site work internally, and what should I know before
changing it?"

This file consolidates what was previously split across old DOC.md internals
and summary.md.

### Template

```markdown
# <Site Name> — Internals

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
- Key decisions and evidence (from probe)

## Extraction
- How data is extracted (direct JSON, ssr_next_data, html_selector, page_global, adapter)
- Parsing quirks

## Adapter Patterns
- [If applicable] Key patterns used in adapter code
- Helper functions, data transformations

## Known Issues
- Bot detection? (DataDome, PerimeterX, etc.)
- Rate limiting?
- Dynamic fields causing verify DRIFT?
- Pitfalls encountered during implementation

## Probe Results
- [Settled conclusions only — not the raw probe matrix]
- Transport hypothesis and final outcome per family
```

### Required vs optional sections

**Required:** Auth, Transport, Known Issues. If a section has nothing
interesting, a one-liner is enough: `No auth required.`

**Optional:** API Architecture, Extraction, Adapter Patterns, Probe Results —
include when non-obvious.

---

## PROGRESS.md — History Trace

Append-only log. Each entry records what happened, why, and what was verified.

### Entry template

```markdown
## YYYY-MM-DD — [Activity Type]

**Context:** [Why this work was done]
**Changes:** [What changed]
**Verification:** [Results]
**Key discovery:** [Optional — non-obvious finding worth preserving]
**Pitfalls encountered:** [Optional — mistakes or dead ends worth documenting]
```

Example:

```markdown
## 2026-04-11 — Transport Upgrade

**Context:** Probe discovered open GraphQL API at api.graphql.imdb.com
**Changes:** 3/4 ops migrated from SSR __NEXT_DATA__ to node GraphQL
**Verification:** 4/4 PASS
**Key discovery:** Introspection disabled, but error messages expose schema
**Pitfalls encountered:** ratings histogram only in __NEXT_DATA__, not GraphQL
```

Fixture-refresh example (chained write ops):

```markdown
## 2026-04-19 — Fixture Chain Rewrite

**Context:** 10 of 19 write ops failing in aggregate verify due to dead
fixture IDs (deleted upstream tweets, renamed mutations, duplicate-status
on createTweet).
**Changes:** Rewrote 9 example.json files to chain via
`${prev.createTweet.create_tweet.tweet_results.result.rest_id}`. Each run
creates a fresh parent tweet (text uses new `${now}` template helper for
uniqueness), then like/bookmark/retweet/reply reuse that ID; deleteTweet
cleans up at order:20. 3 ops moved to `.example.json.skip` (see
SKILL.md Known Limitations).
**Verification:** 16/16 PASS in scope (was 9/19).
**Key discovery:** Twitter's duplicate-status (187) check has a multi-day
rolling window — static text in createTweet eventually collides; `${now}`
sidesteps it cleanly.
```

### When to write

- After initial add-site workflow -> first entry
- After any site update (new operations, auth fix, transport change)
- After knowledge learned during troubleshooting

---

## Migration from Existing Files

New sites use the three-file model directly. Old sites migrate on next touch —
no bulk migration.

### Migration mapping

| Existing content | New home |
|------------------|----------|
| DOC.md: Overview, Workflows, Operations table, Quick Start | -> SKILL.md |
| DOC.md: Site Internals, Probe Results, Known Issues (dev) | -> DOC.md (keep) |
| summary.md: Architecture, Decision, Key Patterns, Pitfalls | -> DOC.md |
| summary.md: Discovery Journey, Verification results | -> PROGRESS.md |

### Steps

1. Create `SKILL.md` from DOC.md above-the-divider content
2. Keep DOC.md below-the-divider content, merge in summary.md architecture/patterns
3. Create or extend `PROGRESS.md` with summary.md discovery/verification entries
4. Delete `summary.md` after migration
5. Remove the `---` divider convention from DOC.md (no longer needed — the split is file-level)

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

1. **Will this still be true in 6 months?** If no -> site-specific DOC.md only
2. **Is this already captured by the code?** If yes -> don't save
3. **Does this change how an agent should behave?** If no -> not worth saving

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
| `knowledge/archetypes.md` | Expected operations by site category |
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

- [ ] SKILL.md written with all required sections (Overview, Workflows, Operations, Quick Start)
- [ ] Operations table has `<- source` annotations for cross-op data flow
- [ ] Workflows section covers common multi-step intents
- [ ] Every write/mutation op has a read→write chain with explicit `→ fieldName` arrows (see Workflow Completeness Standard)
- [ ] Quick Start has copy-paste commands
- [ ] DOC.md written with all required sections (Auth, Transport, Known Issues)
- [ ] PROGRESS.md has at least one entry using the entry template
- [ ] Skipped ops (any `examples/*.example.json.skip`) are documented in SKILL.md Known Limitations with reason + unblocker
- [ ] Knowledge update: scope decision made (site-specific / general / both / nothing new)
- [ ] If general knowledge: persistence test passed, written to correct knowledge file
