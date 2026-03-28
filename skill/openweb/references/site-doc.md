# Site Documentation Guide

## Purpose

Standards for per-site documentation. Every site package should have DOC.md (current state) and PROGRESS.md (history trace) so the next agent or human can understand the site without re-discovering it.

## When to Use

- After initial discover/compile — create first DOC.md and PROGRESS.md
- After any site update (new operations, auth fix, transport change)
- When onboarding a new site package

---

## File Layout

```
src/sites/<site>/
├── openapi.yaml
├── manifest.json
├── DOC.md          ← SOTA: what this site is and how it works
├── PROGRESS.md     ← History: what happened and when
├── adapters/       (optional)
└── examples/       (optional)
```

---

## DOC.md — SOTA Memory

Always reflects current best understanding. Update on every discover/compile/fix cycle.

### Structure

```markdown
# <Site Name>

## Overview
One-liner: what this site is, what archetype (e-commerce, travel, social, etc.)

## Quick Start

Copy-paste commands for common intents:

\```bash
# [Intent 1 description]
openweb <site> exec <op> '<full JSON params>'

# [Intent 2 description]
openweb <site> exec <op> '<full JSON params>'
\```

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchProducts | search by keyword | GET /search?q= | returns title, price, image |
| ... | ... | ... | ... |

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
- node or page? Why?
- If page: what page URL must be open?

## Extraction
- How data is extracted (direct JSON response, ssr_next_data, html_selector, page_global, etc.)
- Any parsing quirks

## Known Issues
- Bot detection? (DataDome, PerimeterX, etc.)
- Rate limiting?
- Dynamic fields that cause verify DRIFT?
```

**Required sections:** Overview, Quick Start, Operations. The rest are optional — if a section has nothing interesting, skip it. The point is to capture **what's non-obvious** about this site — things the next agent (or human) needs to know.

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
- [compile.md](compile.md) — Compilation workflow
- [update-knowledge.md](update-knowledge.md) — When to write to references/knowledge/ vs DOC.md
- [troubleshooting.md](troubleshooting.md) — Debugging site issues
