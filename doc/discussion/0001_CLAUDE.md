# 0001_CLAUDE.md — Initial Aligned Draft

**Author:** Claude
**Date:** 2026-02-27
**Vote:** CHANGES (created initial draft in final/)

---

## What I Did

Created 5 aligned design documents in `final/` — mirroring the `initial_design/` structure — synthesizing all initial designs, both Claude and Codex review feedback, and web research:

- `web-skill-design.md` — Main overview (mission, problem, vision, goals, design decisions, MVP, tech stack, metrics, open questions)
- `architecture-pipeline.md` — Pipeline phases (Explore & Record, Analyze & Extract, Probe, Generate & Test) + execution runtime + self-healing
- `security-taxonomy.md` — Escalation ladder probing protocol + 6-layer security reference taxonomy
- `skill-package-format.md` — Minimal package structure + manifest + tool definition format + MCP runtime
- `self-evolution.md` — Hard problems & mitigations + knowledge base structure + evolution loop

## Key Decisions Made in This Draft

### 1. Three External Execution Modes (not 6, not 4)

Merged Claude's 4-mode and Codex's 3-mode proposals. From the agent's perspective, there are only 3 modes:
- `direct_http` — no browser needed
- `in_page` — browser needed, tool executed via in-page fetch()
- `human_required` — human must intervene

The internal escalation ladder (try cheap first, escalate on failure) handles all granularity. This collapses the 6-mode taxonomy into implementation detail invisible to the consumer.

**Rationale:** The mission says "any agent, easy to use." The agent shouldn't think about CSRF vs TLS fingerprint vs JS challenge. It calls a tool and gets a result.

### 2. Escalation Ladder Probing (not per-layer taxonomy)

Adopted Claude's escalation ladder approach with Codex's additions of "unknown" state and probe budget. Per-layer probing (testing auth, CSRF, origin, TLS, bot detection independently) is intellectually elegant but operationally unnecessary. The escalation ladder gives the same answer in fewer requests.

The 6-layer security taxonomy is retained as **reference documentation** in §8 — useful for building intuition, not for driving implementation.

### 3. No Workflow YAML DSL for MVP

Dropped pre-built workflow DAGs. Modern LLMs can compose tool sequences from descriptions + dependency graph. The dependency graph (`A.response.X → B.request.Y`) provides sufficient multi-step guidance.

**Why this matters:** A workflow YAML DSL requires a parser, evaluator, expression language, error handling. That's a mini programming language. For MVP, the dependency graph + tool descriptions is sufficient. Add workflows later only if agents consistently fail at sequencing.

### 4. Minimal Skill Package (5 items, not 10)

```
site-web-skill/
├── SKILL.md
├── manifest.json
├── tools/*.json (self-contained)
├── extractors/ (optional, for complex CSRF)
└── tests/*.json
```

Eliminated: templates/, verifiers/, workflows/, fingerprints/, bridge/.
Reasons in document §5.

### 5. First Site = Easiest Possible (NOT Google Flights)

Google Flights uses protobuf encoding, TLS fingerprinting, and complex session management. Terrible first site. Start with a dead simple REST-over-JSON site. Escalate difficulty as the knowledge base grows.

**Curriculum learning:** Easy → moderate → hard sites, so the compiler learns incrementally.

### 6. Multi-Document Structure (Mirrors initial_design/)

Split the aligned design into 5 documents matching the `initial_design/` structure: `web-skill-design.md`, `architecture-pipeline.md`, `security-taxonomy.md`, `skill-package-format.md`, `self-evolution.md`. Cross-references use relative links. Each document is self-contained for its domain.

### 7. Self-Healing Publish Policy: Write Ops Need Human Approval

Read-only tool auto-patches can auto-publish if tests pass. Write operation changes **always require human approval** before publishing. This is Codex's more conservative position and it's correct for safety.

### 8. Knowledge Base: 3 Files, Grow Organically

Start with `patterns.md`, `heuristics.json`, `failures.md`. Don't pre-build a taxonomy with zero data points. Add structure when real data demands it.

### 9. Agent-Agnostic Runtime

Mission says "any agent." The runtime exposes tools through:
- MCP (for Claude Code) — MVP
- HTTP API (for any agent) — MVP+1
- OpenAPI export — Future

### 10. Leverage Existing Tools

- browser-use for Phase 1 navigation (evaluate, don't build from scratch)
- mitmproxy2swagger for Phase 2 clustering (evaluate, adapt rather than rewrite)
- Both need evaluation for fit, but starting from existing tools beats rebuilding

## Significant Areas Where Claude and Codex Reviews Converged

Both reviews strongly agreed on:
- MVP scope is too wide; narrow aggressively
- Execution modes are over-specified; simplify
- Package structure is over-engineered; minimize
- Knowledge base structure is premature; start minimal
- Document sprawl is a problem; consolidate
- Self-heal auto-publish is dangerous for writes
- The core insight and compiler metaphor are correct

## Areas I Expect Codex To Push Back On

1. **3 vs 2 external modes:** Codex might argue even `direct_http` vs `in_page` is an internal distinction the agent doesn't need. Possibly just `auto` + `human_required`?

2. **No workflow YAML at all:** Codex's review didn't strongly advocate for workflows, but the original design had them. Worth debating whether dependency graph alone is sufficient.

3. **browser-use dependency:** Python dependency in a Node.js stack. Codex may prefer a thin Playwright wrapper.

4. **mitmproxy2swagger:** Codex may have opinions on whether to adopt vs build.

5. **Document consolidation approach:** Codex may prefer a different document structure.

## Open Questions Requiring User Decision

Flagged 4 questions in §13 of the design doc that need the project owner's judgment. Neither Claude nor Codex can resolve these — they're product/strategy decisions.

---

**Next:** Codex to review the draft, propose changes or approve.
