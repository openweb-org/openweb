# Curate Schemas

Response schema enrichment, example review, and replay safety. Loaded during
the Curate step when response shapes or examples need work.

> Naming, noise removal, permissions: `add-site/curate-operations.md`
> Auth, transport, extraction config: `add-site/curate-runtime.md`

## When to Load

Load this file when any of:
- A read operation has `type: object` with no `properties` in its 200 response
- Captured responses contained empty arrays for list endpoints
- The site uses SSR extraction (LD+JSON, `__NEXT_DATA__`, DOM) where schemas
  are hand-written
- You need to review examples for PII before install

---

## Bare Object Schemas

`type: object` with no `properties` in a 200 response means the schema carries
zero information — agents cannot know what fields the response contains. The
compiler infers schemas from captured responses, but under-sampled or
hand-crafted specs often produce bare schemas.

### How to Enrich

1. For each read op with a bare `type: object` response, execute it:
   ```bash
   openweb <site> exec <op> '{"param":"value"}'
   ```
2. From the actual JSON response, infer a schema (properties, types, nested
   objects).
3. Replace the bare schema in `openapi.yaml`.

### Schema Depth Rules

- **Recommended max 2-3 levels deep** (curation guideline; the compiler enforces
  `maxDepth: 10` in `schema-v2.ts`). Use `type: object` for deeply nested
  sub-objects that agents rarely need to inspect.
- **Arrays:** Describe the item schema. Don't leave `items: { type: object }`
  bare — at minimum include the key fields.
- **Nullable fields:** Mark with `nullable: true` when the field may be absent
  or null. Common nullable fields: user bio, profile image, optional metadata,
  pagination cursors (null on last page).

### Acceptable Bare Schemas

Not every bare schema needs enrichment:
- Operations that return truly opaque objects (e.g., raw API proxy responses)
- Empty 204 responses (no body)

---

## Empty-Array Fallback

When a captured response contains an empty array (e.g., `{"items": []}`), the
compiler infers `items: { type: object }` with no properties — the same bare
schema problem. There is no compiler warning for this case.

### Fix

Execute the operation with parameters that return a non-empty list, then enrich
the item schema from the actual response:

```bash
# Use a popular/common query to get non-empty results
openweb <site> exec <op> '{"q":"popular-term","limit":5}'
```

If no non-empty response is available (the list is genuinely always empty for
the operation), document the bare schema in `DOC.md` Known Issues and move on.

---

## Nullable Fields in Adapter Packages

Adapter-only packages (no compiled spec) have hand-written schemas. Mark fields
as nullable when the adapter may return `null` for optional data:

```yaml
properties:
  bio:
    type: string
    nullable: true
  avatar_url:
    type: string
    nullable: true
```

> Note: OpenAPI 3.1 prefers `type: [T, 'null']` (or `oneOf: [{type: T}, {type: 'null'}]`)
> over the legacy 3.0 `nullable: true`. Both parse correctly. This repo uses both:
> 3.0-style `nullable: true` (e.g. GitHub) and 3.1-style `type: [T, 'null']`
> (e.g. Yahoo Finance). Choose consistently within a site.

If the adapter extracts from DOM and an element is missing, the field should be
`nullable: true` rather than omitted — this gives agents a stable schema
contract. Common nullable fields: user bio, profile image, optional metadata,
pagination cursors (null on last page).

---

## LD+JSON Schema Caveat

Sites using LD+JSON extraction (`<script type="application/ld+json">`) embed
schema.org-vocabulary data (Hotel, Product, Recipe, etc.). This affects schema
curation in two ways:

**Schema shape follows schema.org, not the site's internal API.** The response
schema must match what the LD+JSON block actually contains — `@type`, `name`,
`aggregateRating`, etc. — not what the site's internal REST/GraphQL API would
return. Do not copy field names from the site's API docs if the extraction
source is LD+JSON.

> Filter LD+JSON for data-only fields; exclude `@context`, `@id`, `@type`,
> `@graph` metadata from the response schema unless meaningful to users.

**Multiple LD+JSON blocks per page.** A single page may embed several blocks
with different `@type` values. The adapter or extraction expression must filter
by `@type` to get the right block. The response schema should reflect only the
fields from the target `@type`, not a union of all blocks.

**Official docs are misleading here.** Sites with public APIs document their
*official* API shapes, which use the site's own field names and auth. LD+JSON
extraction bypasses the API entirely — the schema follows schema.org vocabulary.
Do not mix the two.

---

## Official-Doc Fallback Caveat

When enriching schemas (whether from API responses or extraction), you may find
official API documentation for the site. Be cautious:

- Official docs describe the *official* API with its own auth (API keys, OAuth
  apps), which differs from openweb's browser-session auth.
- Schema shapes may differ between official and internal APIs — different field
  names, nesting, or available fields.
- Use official docs as a *hint* for field names and types, but always verify
  against actual `exec` output.
- Do not copy official schemas verbatim — the internal API openweb targets may
  return different fields or structures.

---

## Review Examples for PII

Check parameter examples in the spec and example fixtures
(`examples/*.example.json`):

- **Real usernames, emails, phone numbers, addresses?** Replace with generic
  values (`"user123"`, `"user@example.com"`).
- **Auth tokens or session IDs in examples?** Remove entirely.
- **Location data, IP addresses, device IDs?** Scrub or generalize.

The auto-scrubber catches common patterns (emails, phone numbers, SSNs) and
generic long IDs (>20 chars via `LONG_ID_RE` in `src/compiler/curation/scrub.ts`),
but manually flag anything it might miss — especially:
- Site-specific user IDs that could identify real users
- Domain-specific slug/ID formats the generic regex won't catch (e.g.,
  Starbucks `53646-283069` storeNumber)
- Internal URLs or hostnames
- Timestamps that pinpoint exact user activity

---

## Replay Safety

The compiler sets `replaySafety` per operation and writes it to
`examples/*.example.json` as `replay_safety`. This controls verify behavior.

| Replay safety | Permission | Verify behavior |
|---|---|---|
| `safe_read` | `read` | Included in `openweb verify` by default |
| `unsafe_mutation` | `write` / `delete` | Skipped by default; include with `--write` flag |

### What to Check

- Auto-curation defaults are usually correct. The compiler sets `safe_read` for
  GET/HEAD and GraphQL queries, `unsafe_mutation` for POST/PUT/PATCH/DELETE and
  GraphQL mutations.
- **GraphQL queries via POST:** Verify these have `permission: read` and
  `replay_safety: safe_read`, not `write`/`unsafe_mutation`. Auto-curation
  handles this (checks `graphql.operationType === 'query'`), but double-check.
- **Idempotent writes:** Some POST endpoints are actually safe reads (e.g.,
  search via POST body). If confirmed safe, override to `safe_read` so verify
  covers them.

### Testing Write Operations

Write ops are skipped during standard verify. To test them:
```bash
# Include write/delete ops in verify
openweb verify <site> --write

# Or test manually in a safe context
openweb <site> exec likePost '{"id":"your-own-post"}'
# Then undo: openweb <site> exec unlikePost '{"id":"your-own-post"}'
```

---

## Checklist

Before moving to verify, confirm:

- [ ] No bare `type: object` responses remain (except acceptable cases)
- [ ] Empty-array item schemas enriched with actual response data
- [ ] Adapter schemas use `nullable: true` for optional DOM-extracted fields
- [ ] LD+JSON extraction schemas follow schema.org vocabulary, not API docs
- [ ] Examples scrubbed of PII (usernames, emails, tokens, addresses)
- [ ] Replay safety correct for all operations (especially GraphQL-over-POST)
- [ ] Schema depth max 2-3 levels; deeper nesting uses `type: object`
