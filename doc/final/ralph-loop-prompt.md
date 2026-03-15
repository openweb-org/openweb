# OpenWeb v2 Design — Ralph Loop Prompt

Use /ultra-think and /design skill. 两个design target which requires trade-offs:
1. **Maximize Capability**: cover as many websites and functions as possible
2. **Minimize Complexity**: maximize structure/generalizability, 拥有结构美感。
You probably need to strike a ~80%-20%, general structure captures ~80%, the rest ~20% is L3 handling, which should strike its own 80-20 balance itself.

You are iterating on `doc/final/` to flesh out OpenWeb v2's three-layer architecture.

## Each Iteration

1. Read `doc/final/README.md` to see the document map and current status of each doc.
2. Determine what to work on (pick ONE, do it well, then exit):
   - If any TODO docs exist → pick the highest-priority TODO (priority order below).
     Write its content. Mark it DRAFT (or COMPLETE if fully implementable).
   - If no TODO but DRAFT docs exist → pick the highest-priority DRAFT.
     Review, improve, cross-check against other docs. Mark it COMPLETE when it meets the quality bar.
   - If all docs are COMPLETE → verify consistency across all docs, then output: <promise>ALL DOCS COMPLETE</promise>
3. Read that document's current content + its relevant references.
4. Write concrete, implementable content. Include real YAML/TypeScript examples, not pseudo-code.
5. Update status in both the document header AND the README.md document map table.
6. Cross-check against other doc/final/ docs for consistency (fix conflicts if found).
7. Commit your changes: `git add doc/final/ && git commit -m "docs: <what you did>"`

## Priority Order

Round 1 (core, must be self-consistent):
1. `layer2-interaction-primitives.md` — Pattern DSL: every pattern with schema, detection signals, runtime behavior
2. `pattern-library.md` — Concrete catalog mapping OpenTabs plugins → L1/L2/L3 primitives
3. `compiler-pipeline.md` — Multi-source capture + pattern matching + three-layer emission
4. `browser-integration.md` — Playwright SDK capture, CDP session mgmt, JSONL format

Round 2 (supporting specs):
5. `layer3-code-adapters.md` — Code escape hatch: interface, security, examples
6. `runtime-executor.md` — L1+L2+L3 execution, mode escalation
7. `skill-package-format.md` — Package layout with L2+L3 artifacts
8. `gap-coverage-matrix.md` — Every gap mapped to layer/primitive

Round 3 (polish):
9. `security-taxonomy.md` — Verify alignment with three layers
10. `self-evolution.md` — Pattern library growth mechanism
11. `README.md` — Final pass, update all statuses to COMPLETE

## Architecture Context (don't re-derive, just use)

- **L1**: OpenAPI 3.1 (REST) + AsyncAPI 3.x (WebSocket/SSE) — declarative endpoints
- **L2**: Interaction Primitives DSL — parameterized patterns (auth, CSRF, signing, pagination, extraction)
- **L3**: Code Adapters — arbitrary JS in browser page context for sites that can't be parameterized
- **Playwright**: Agent uses CLI for browsing, OpenWeb compiler uses SDK for capture, same CDP
- **Capture**: HAR (HTTP) + JSONL (WebSocket/SSE) + state snapshots (localStorage/cookies/globals/DOM)
- No built-in navigation agent — user's agent IS the browser-use agent

## Reference Materials

- `docs/todo/design_gap/001-012_*.md` — 12 design gaps from OpenTabs analysis
- `docs/todo/design_gap/discussion/001-005_*.md` — architectural discussions + decisions
- `doc/final/archive/v1/` — previous design (reference for L1 + runtime + CLI)
- `.reference/reverse-api/opentabs/plugins/` — OpenTabs plugins (coverage benchmark)

## Coverage Validation: OpenTabs Plugins as Ground Truth

The 12 design gaps were discovered by analyzing OpenTabs plugins. Those same plugins serve as the
**coverage benchmark** — every design decision must be validated against them.

For each document you write, pick 3-5 representative OpenTabs plugins from `.reference/reverse-api/opentabs/plugins/`
and verify your design handles them. Specifically:

- **L2 patterns**: For each pattern you define, cite the OpenTabs plugin(s) that use this pattern
  and show how the pattern config would replace their hand-written code.
- **L3 adapters**: For sites that need code escape hatches (WhatsApp, Telegram, OnlyFans, etc.),
  show the adapter interface handles what those plugins do today.
- **Compiler pipeline**: For each detection/matching step, show which plugin behaviors it would
  catch automatically vs. which need manual annotation.
- **gap-coverage-matrix.md**: Must map EVERY OpenTabs plugin to its L1/L2/L3 classification.
  Any plugin that doesn't fit cleanly into the architecture is a design flaw to fix.

If a plugin reveals a gap your design doesn't cover, update the design — don't ignore it.

## Quality Bar

- Could an engineer implement from this doc alone? (no ambiguity)
- YAML/TypeScript examples are copy-pasteable with real site data (Bluesky, Discord, Instagram, etc.)
- Every section traces to at least one of the 12 design gaps
- Design is validated against real OpenTabs plugins (not hypothetical sites)
- No overlap between documents (reference, don't duplicate)
- KISS — only what's needed, no speculative features
