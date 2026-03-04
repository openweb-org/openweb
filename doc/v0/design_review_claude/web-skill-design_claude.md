# Review: web-skill-design.md

**Reviewer:** Claude (system architect perspective)
**Date:** 2026-02-27
**Verdict:** The strongest document in the set. Clear problem statement, honest evidence, reasonable scope. A few areas of over-design and some missing rigor.

---

## What's Excellent

### 1. Problem Statement is First-Principles Perfect

Section 1 nails it:

> Every modern web app is an API client. The buttons and forms are just wrappers around `fetch()` / `XMLHttpRequest` calls that send and receive structured JSON. **The actual action space is already structured — it's just hidden behind the GUI.**

This is the entire project justification in two sentences. The evidence table (browser-only 14.8% → hybrid 38.9%) provides quantitative backing. The gap identification ("that paper relied on manually curated API docs") positions the project precisely.

**No changes needed.** This is how you open a design doc.

### 2. The Compiler Metaphor Holds

The website-to-API compiler metaphor is not just marketing — it's architecturally accurate:

```
Source     = Network traffic + UI behavior recording
Compiler   = web-use-skill pipeline
Target     = Per-website skill package
Runtime    = Browser session execution engine
```

This metaphor usefully constrains the design. A compiler should be stateless per-invocation (given the same input, produce the same output). A compiler evolves its optimization database, not its core passes. The metaphor guides the self-evolution architecture correctly.

### 3. WebMCP Positioning is Strategic

The table:

```
Website implements WebMCP → Use native tools
Website has public API    → Use official API
Website has no public API → web-skill mines it
```

This positions web-skill as a bridge, not a competitor. It gives the project a clear long-term narrative: useful now, graceful sunset later. This is honest positioning that builds trust.

### 4. MVPs are Correctly Scoped

MVP-1 (read-only, single site) is achievable and validates the core thesis. The success criterion is concrete:

> An agent can call `search_flights("SFO", "JFK", "2025-04-01")` and receive accurate, structured flight data — without any browser click/type operations.

This is testable. Ship it.

### 5. Key Design Decisions are Well-Reasoned

D1 (Tiered execution with empirical classification) — Correct. The observation paradox justifies probing.
D2 (Dual execution path) — Correct. Graceful degradation is essential.
D3 (Causal recording) — Correct. C-HAR is the non-obvious insight.
D4 (LLM-in-the-loop for annotation) — Correct. Heuristics alone have limited recall.
D5 (Skill as software package) — Correct. Testable and versionable.
D6 (Self-evolving meta-skill) — Correct in principle, risky in execution.

---

## What Needs Improvement

### 6. The Architecture Diagram Has a Missing Phase

The ASCII diagram shows:

```
Phase 1 → Phase 1.5 → Phase 2 → Phase 3 → Phase 4
```

But there's a missing **Phase 0: Site Assessment** — before you start recording, you should assess whether the site is even a good candidate:

- Does it already have a public API? (Use that instead.)
- Does it implement WebMCP? (Use that instead.)
- Is it behind a hard paywall or enterprise SSO? (May not be automatable.)
- Does its ToS explicitly prohibit automation? (Legal risk.)

Currently, the pipeline starts recording immediately. A 5-minute assessment phase could save hours of wasted recording on unsuitable sites. This is especially important for the self-evolution loop — you don't want the knowledge base polluted with "attempted but failed" sites that were never viable.

### 7. The Document Map Creates a Maintenance Problem

```
architecture-pipeline.md — Pipeline phases
security-taxonomy.md     — Security model
skill-package-format.md  — Package format
self-evolution.md        — Evolution + hard problems
```

Four sub-documents that cross-reference each other. The current state already has content duplication (Phase 1.5 appears in both architecture-pipeline.md and security-taxonomy.md, execution modes appear in three documents).

**The KISS question:** Do you need 5 documents (this one + 4 sub-docs)?

**Alternative: 2 documents.**

1. `web-skill-design.md` — The complete design (expand this doc to absorb the sub-docs). One document, one source of truth. ~30 pages.
2. `security-reference.md` — The 6-layer taxonomy tables as an appendix. Reference only, not architectural.

A single 30-page document with a table of contents is easier to maintain, easier to search, and eliminates cross-reference drift. The sub-document approach made sense when each section was co-authored by different people, but for a single-author project, it adds overhead without value.

### 8. Open Questions Are Mostly Answerable

Of the 8 open questions:

| # | Question | My Answer |
|---|----------|-----------|
| 1 | Use GraphQL introspection? | **Yes, when available.** It's free information. If introspection is disabled, fall back to traffic mining. Don't overthink "stealth" — introspection queries are normal developer tools usage. |
| 2 | Rate limit hints in tools? | **Yes, trivially.** Extract `X-RateLimit-*` headers during probing. Store as metadata. Agent uses them for self-throttling. ~10 lines of code. |
| 3 | Multi-tab flows? | **Defer to MVP-3.** Multi-tab is rare and hard. Most sites that use auth popups also support redirect-based OAuth. Handle the common case first. |
| 4 | Skill sharing/marketplace? | **No.** Not for v1, probably not ever. Legal risk is too high. Focus on per-user, per-device extraction. |
| 5 | Cache canonical API map? | **Yes.** The API map (endpoint schemas) is site-specific, not user-specific. Cache it. Only the execution context (cookies, sessions) is user-specific. |
| 6 | Knowledge base curation? | **Generalization test:** Require a pattern to match ≥2 sites before adding to knowledge base. One-site patterns are site-specific metadata, not knowledge. |
| 7 | Evolution safety? | **Human approval for procedural changes. Auto-commit for declarative changes.** Plus regression tests against recent builds. |
| 8 | Probing side effects? | **Skip write endpoints during probing. Default them to headless_browser.** This is already stated in security-taxonomy.md but should be elevated to a design decision. |

These should be resolved and moved to "Design Decisions," not left as open questions. Open questions in a design doc signal that the design is incomplete. Close them.

### 9. Technology Stack Table is Missing Key Decisions

The table lists Playwright, CDP, Node.js, etc. — all reasonable choices. But it's missing:

- **State storage:** Where do session cookies, CSRF tokens, and per-user execution state live? In-memory? File system? SQLite?
- **Concurrency model:** Can the MCP server handle multiple simultaneous tool calls? Is the browser a singleton or a pool?
- **Deployment:** Local only? Docker? Cloud?

For MVP, the answers are probably "file system," "singleton browser, serial execution," and "local only." State these explicitly.

### 10. Glossary is Good but Overweight

14 terms defined. Some are obvious ("Tool," "Workflow") and some are project-specific ("C-HAR," "Observation Paradox," "WebMCP"). Keep the non-obvious ones, drop the obvious ones.

---

## Cross-Document Consistency Issues

Having read all 6 documents, there are consistency problems:

### 11. Execution Modes: 6 vs. 4 vs. "tiered"

- `security-taxonomy.md` defines 6 modes (direct_http, session_replay, session_replay_with_csrf, headless_browser, headed_browser, headed_browser_with_human)
- `architecture-pipeline.md` repeats the same 6
- This doc says "tiered execution" without specifying the tiers

**Fix:** Define the canonical mode list in ONE place (this doc, since it's the root). Other docs reference it.

### 12. Skill Package Structure: Different in Each Doc

- `skill-package-format.md` shows 8 subdirectories
- `desgin_doc_codex_claude.md` (the Chinese companion) shows a different layout
- This doc mentions the package but doesn't specify structure

**Fix:** Define the canonical structure in ONE place (skill-package-format.md). This doc references it.

### 13. Self-Evolution Scope

- `self-evolution.md` Section 8 covers evolution in detail
- This doc's D6 design decision covers it briefly
- `qi_note.md` has the original insight

Three documents discussing the same concept. **Consolidate.**

---

## The Biggest Risk This Document Doesn't Address

### 14. The "First Site" Problem

The design assumes a working pipeline. But building the first per-website skill is a bootstrapping problem:

- No knowledge base yet → every site is novel
- No probe heuristics → probing is blind
- No extractor templates → every CSRF pattern must be figured out from scratch
- No test infrastructure → no regression safety net

The MVP plan says "Target site: Google Flights." But Google Flights uses protobuf encoding, TLS fingerprinting, and complex session management. This is a **hard** first site.

**Recommendation:** The first site should be the simplest possible:
- A site with a public REST API that returns JSON
- No anti-bot, no CSRF, no auth required for read operations
- Something like a weather API, data.gov, or a basic SaaS tool

Use the easy first site to validate the pipeline end-to-end. Then escalate to Google Flights as site #2 or #3 once the basic machinery works.

---

## Summary

| Aspect | Rating | Action |
|--------|--------|--------|
| Problem statement | ★★★★★ | Keep as-is |
| Compiler metaphor | ★★★★★ | Keep as-is |
| WebMCP positioning | ★★★★★ | Keep as-is |
| Architecture diagram | ★★★★☆ | Add Phase 0 (Site Assessment) |
| MVP scope | ★★★★☆ | Reconsider first target site |
| Design decisions (D1–D6) | ★★★★☆ | Good, well-reasoned |
| Open questions | ★★★☆☆ | Close them — most are answerable now |
| Document map / cross-refs | ★★☆☆☆ | Consolidate to 2 docs |
| Technology stack | ★★★☆☆ | Add missing decisions |
| Cross-doc consistency | ★★☆☆☆ | Define canonical sources for shared concepts |

**Bottom line:** This is a solid design document for a genuinely novel system. The core insight (websites are API clients in disguise) is profound and well-supported. The main risks are: (1) over-engineering the early implementation (8-directory skill packages, 6-dimensional probing), (2) starting with too hard a first site, and (3) document sprawl across 5 files that will inevitably drift out of sync. The design is 80% right. The remaining 20% is mostly about **doing less, sooner**.
