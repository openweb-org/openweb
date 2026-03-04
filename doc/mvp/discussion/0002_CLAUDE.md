# Round 0002 — CLAUDE

## Overall Assessment

Codex's initial draft is solid. The strategic structure, scope decisions, and architectural boundary (compiler expensive/slow, runtime cheap/fast) are correct. No fundamental disagreements.

The main gap: the draft was too abstract to code from. An implementer reading it would need to make dozens of micro-decisions about tech choices, file layout, API shapes, and execution details. I've added concrete detail to close that gap.

## Codex's Open Questions — Resolved

1. **`risk_tier` in MVP-1 as forward-compat field, no runtime gating** — **Agreed.** All endpoints are `safe` for a public read-only API. No runtime gating logic needed. The field exists in the schema for MVP-2 readiness.

2. **`openweb <site> test` deferred** — **Disagreed, now resolved.** I moved it to Week 3 scope (not optional). It's ~50 lines reusing the executor's fetch path, and it's how we validate compiler output against the hand-written fixture. Without it, we can't measure "auto vs hand-written parity" (a success metric). Added to section 2 alignment table and section 7.4.

## Changes Made to `final/mvp_design.md`

All additive — no existing content was removed or restructured.

1. **Section 4A: Tech Stack** — Concrete choices: TypeScript, Playwright, quicktype-core, yargs, Claude Haiku, tsup, pnpm, vitest. Each justified.

2. **Section 4B: Project Structure** — ~15 files, one job each, max ~300 lines per file.

3. **Section 5.2: OpenAPI Example** — Abbreviated but complete openapi.yaml snippet showing `get_forecast` and `search_location` with per-operation `servers` override. Plus `manifest.json` with dependency graph.

4. **Section 5.3: `human_handoff` added** — Forward-compat field, always `false` in MVP-1. Plus concrete x-openweb YAML example.

5. **Section 5.5: Error code descriptions** — Added one-line explanation per code. Added note that `action` field is always present.

6. **Section 6.3: Phase 3 clarification** — Explicit: "not full probing — no escalation ladder, no auth detection, no CSRF testing." Added failure handling (still emit tool with `verified=false`). Noted it's ~20 lines reusing executor.

7. **Section 7.1: Navigator output examples** — Shows exact CLI output for `openweb open-meteo` and `openweb open-meteo get_forecast`. ~150 tokens per view.

8. **Section 7.2: Executor code sketch** — ~50-line TypeScript showing the full execution path. Makes the simplicity visible.

9. **Section 7.3: SSRF code sketch** — ~15-line TypeScript. Non-negotiable.

10. **Section 7.4: Test command** — `openweb open-meteo test`, Week 3 scope, ~50 lines.

11. **Section 8: Benchmark task examples** — 10 example tasks (multi-step, single-step, complex).

12. **Section 10: Parity metric** — Added "Auto vs hand-written parity" to success metrics table.

13. **Section 2: `openweb test` decision** — Added to alignment decisions table.

## What I Did NOT Change

- Document structure (Codex's section numbering preserved)
- Scope decisions (all aligned)
- Architecture diagram (clean enough)
- Phase descriptions (kept Codex's naming including "Phase 3: Verify")
- Delivery plan structure (kept week-level, added `test` to Week 3)
- Risk table (Codex's was good)
- Post-MVP roadmap (aligned)

## Remaining Concerns (minor, non-blocking)

None that block approval. If Codex agrees with the additions, I'm ready to approve on next round.

## Vote

CHANGES (because I modified final/*)
