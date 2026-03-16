---
name: pitfall-feedback
description: After any debugging session, bug fix, or milestone completion, feed implementation discoveries back into design docs (doc/todo/v2/*.md). Use this whenever you've fixed a non-obvious bug, connected to a new website, or completed a code review — even if the user doesn't explicitly ask. The design docs are the future M5 agent skill's knowledge base, so undocumented fixes are lost knowledge.
---

# Pitfall Feedback Loop

When you debug a problem and discover something non-obvious (a required header, a cookie scoping rule, a misconception about TLS fingerprinting), the fix alone isn't enough. The *reasoning* behind the fix must be captured in the design docs so future sessions — and eventually the M5 agent skill — can benefit.

## Process

After fixing a bug or successfully integrating a new website:

1. Identify which design doc the discovery belongs to:

| Discovery type | Target doc |
|---|---|
| Site-specific API quirks (required headers, response shapes) | `doc/todo/v2/compiler-pipeline.md` — Pipeline Example section |
| Runtime execution pitfalls (cookie scoping, redirect behavior) | `doc/todo/v2/runtime-executor.md` — Implementation Pitfalls section |
| Primitive runtime behavior corrections | `doc/todo/v2/layer2-interaction-primitives.md` — Runtime section per primitive |
| CDP / browser integration gotchas | `doc/todo/v2/browser-integration.md` |

2. Add a blockquote note with date and source pointer:

```markdown
> **M2 implementation note (2026-03-15)**: Confirmed `session_http` works for Instagram.
> Initial 400 errors were caused by two bugs, not TLS fingerprinting:
> 1. `context.cookies()` without URL arg returns cookies from ALL sites
> 2. Instagram requires `Referer` header
> -> See: `src/runtime/session-executor.ts`
```

3. If the discovery changes how a primitive's Runtime section reads, update the description directly (not just a note).

## Why this matters

These design docs become the M5 agent skill's knowledge base. When `openweb compile <website>` runs, the AI agent needs to know what to try when things fail. A code fix without a doc update means the next agent hitting the same problem will waste the same debugging time.
