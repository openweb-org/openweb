# Update Knowledge

After completing any workflow (discover, compile, troubleshoot) that taught you something new.

## Principles

- Only save what's novel — don't duplicate what's in the code
- Save patterns, not instances — "Next.js sites use `__NEXT_DATA__`" not "Walmart uses `__NEXT_DATA__`"
- Keep files <200 lines — split when a file grows too large
- Deduplicate — search existing knowledge files before adding. If the pattern exists, refine it rather than re-stating it.

## Process

### 1. Scope Decision

Is this site-specific or general?

- **Site-specific** (this site's exact API, auth flow, quirks) → write to the site's `DOC.md` (see [site-doc.md](site-doc.md))
- **General pattern** (applies across many sites) → write to `references/knowledge/` (this guide)
- **Both** → write to both, with the general version abstracted

### 2. Classify

Which knowledge file does it belong to? Search existing files before creating a new one.

| File | Scope |
|------|-------|
| `references/knowledge/auth-patterns.md` | Auth, CSRF, signing, cookie/token patterns |
| `references/knowledge/archetypes/index.md` | Site categories and expected behaviors |
| `references/knowledge/ws-patterns.md` | WebSocket message types, connection patterns, curation |
| `references/knowledge/bot-detection-patterns.md` | Detection systems, transport impact, capture strategy |
| `references/knowledge/extraction-patterns.md` | SSR data, DOM, page globals, adapter extraction |
| `references/knowledge/graphql-patterns.md` | Persisted queries, batching, introspection, schema |
| `references/knowledge/troubleshooting-patterns.md` | Failure patterns organized by category |

Create a new file in `references/knowledge/` only if the pattern doesn't fit any existing file. Name it `<topic>-patterns.md`.

### 3. Write

Follow the normalized entry format:

```markdown
### Pattern Name

Description of the pattern — what it is and when it occurs.

- **Detection signals:** how to recognize this pattern in captured traffic or site behavior
- **Impact:** what this means for transport, auth, or site package modeling
- **Action:** what to do when you encounter it
- **Example:** (optional) concrete example from a real site, generalized
```

Not every field is required — skip what's not relevant. The goal is: the next agent encountering this pattern can recognize it and know what to do.

### 4. Persistence Test

Before saving, verify the knowledge is durable:

- Will this still be true in 6 months? (If no → site-specific DOC.md, not knowledge)
- Is this already captured by the code itself? (If yes → don't save)
- Does this change how an agent should behave? (If no → probably not worth saving)

### 5. Size Management

After writing, check the file size:

```bash
wc -l skill/openweb/references/knowledge/<file>.md
```

If a file exceeds 200 lines:
1. Identify a coherent subtopic that can split out
2. Create a new `references/knowledge/<subtopic>-patterns.md`
3. Move the relevant entries
4. Update this guide's file listing (Step 2 table above)

### 6. Update Process Guide (if needed)

If the learning changes the recommended process, update `references/discover.md`, `references/compile.md`, or `references/troubleshooting.md`.

## Related References

- `references/site-doc.md` — site-specific documentation (DOC.md vs references/knowledge/)
- `references/discover.md` — discovery workflow that produces knowledge
- `references/compile.md` — compile review that produces knowledge
- `references/troubleshooting.md` — debugging that produces knowledge
