# Review: architecture-pipeline.md

**Reviewer:** Claude (system architect perspective)
**Date:** 2026-02-27
**Verdict:** Strong foundation, but over-specified in parts. Needs simplification pass.

---

## What's Right (Keep These)

### 1. The Two-Layer Architecture is Elegant

```
Layer 1: Navigation Agent (perception + action)
Layer 2: Traffic Recorder (CDP, passive, transparent)
```

This is clean separation of concerns. The recorder doesn't care who's driving — agent or human. The agent doesn't care that it's being recorded. This is the right abstraction boundary. **Don't touch this.**

### 2. C-HAR (Causal HAR) is a Genuine Insight

Standard HAR captures *what* was requested. C-HAR captures *why* — mapping UI events to the network requests they trigger. Without this, you can't distinguish "user searched for laptops → GET /api/search" from "background analytics ping → POST /collect". This is load-bearing design and the single most important data structure in the system.

### 3. Agent-First, Human-Fallback

The principle that the agent drives exploration by default and humans only intervene for auth/CAPTCHA/2FA is correct. The handoff table (login, CAPTCHA, 2FA, ambiguous choices, stuck agent) is well-scoped.

### 4. Variance Generation

Re-running flows with different parameters to enable clustering is necessary and well-motivated. Without variance, you can't distinguish constants from parameters.

---

## What's Over-Engineered (Simplify These)

### 5. Step 0: Task Planning is Premature Abstraction

The document describes a "domain intent library" that maps site categories to task lists:

> E-commerce: search for products, apply filters, view product details, add to cart...
> Travel: search for flights/hotels, apply filters...

**Problem:** This is classification before observation. You're building a taxonomy of website types before you've even loaded the page. In practice:

- The agent can look at the page and figure out what to do. That's literally what browser-use agents do.
- Maintaining a "domain intent library" is a separate project with indefinite scope.
- Most sites don't fit neatly into one category, and the interesting sites are the ones that don't.

**Simplification:** Drop the domain intent library. Instead:

```
Step 0: Load site. Read a11y tree.
Step 1: Agent identifies clickable/interactable elements.
Step 2: Agent exercises them systematically (breadth-first exploration).
Step 3: For forms, agent tries different inputs.
```

The task plan should emerge from the site's actual UI, not from a pre-built category template. This is more robust and requires zero domain-specific knowledge upfront.

### 6. Phase 1.5 Inlining Creates Document Sprawl

Phase 1.5 (Probe & Classify) is summarized in this document but fully specified in security-taxonomy.md. This creates a cross-reference dependency that makes both documents harder to maintain. Every change to the probing protocol requires updating two documents.

**Simplification:** Phase 1.5 in this document should be reduced to:

```
Phase 1.5: For each endpoint, empirically test the cheapest execution mode
that works. Try: direct HTTP → with cookies → with cookies+CSRF → headless
browser → headed browser. Stop at the first mode that succeeds.
See security-taxonomy.md for the full probing protocol.
```

That's the entire content needed here. The current ~60 lines of Phase 1.5 in this doc are redundant with security-taxonomy.md.

### 7. The "Observable Signals" Table is Taxonomic, Not Actionable

The table mapping recording signals to heuristics (`__cf_bm` → Cloudflare likely, `X-CSRF-Token` → CSRF may be enforced) is intellectually correct but operationally useless for MVP. You're going to probe anyway. The heuristics just change probe order, saving maybe 2-3 HTTP requests per endpoint.

**Simplification:** Delete the table from the pipeline doc. It belongs in the knowledge base (`probe-heuristics.json`) as runtime data, not in the architecture document as design specification. Architecture docs should describe *what* happens, not *optimization hints*.

---

## What's Missing

### 8. Error Handling During Recording

The document doesn't address:
- What happens when the site returns 500 errors during recording?
- What happens when the agent triggers a soft ban (rate limiting)?
- What if the site serves different content to different IP ranges (geo-fencing)?

These aren't edge cases — they're common. A single paragraph about "recording resilience" would fill this gap.

### 9. Recording Size Estimation

No guidance on expected recording sizes, storage format, or when to stop recording. Questions like:
- How many flows constitute "enough" for a site?
- When has variance generation captured sufficient diversity?
- What's the stopping criterion for Phase 1?

Even a rough heuristic ("3 parameter variations per flow, stop when no new endpoints are discovered for 2 consecutive flows") would be valuable.

### 10. Variance Generation + Write Endpoints = Side Effects

The document says to re-run flows with different parameters but doesn't address that re-running write flows (add to cart, post comment, create order) causes real side effects. The later Phase 1.5 section mentions "skip probing for write endpoints" but recording-phase variance generation has the same problem.

**Fix:** Explicitly note that variance generation only applies to read operations. Write flows should be recorded once (or with dry-run/preview patterns if available).

---

## Structural Critique

### 11. Phase 2 (Analyze) Packs Too Many Distinct Steps

Phase 2 contains four sub-steps (Clustering, Parameter Differentiation, Schema Induction, Dependency Graph), each of which is a meaningful algorithmic challenge. The document treats them as a monolith.

**Suggestion:** Each sub-step should have a clear input → output contract:

```
Clustering:     C-HAR recordings → endpoint groups
Differentiation: endpoint groups → parameterized templates
Schema Induction: parameterized templates → JSON Schemas
Dependency Graph: all schemas + C-HAR causality → DAG
```

This makes each step independently testable and replaceable.

### 12. Phase 3 (Generate) Has Great Tool Synthesis but the Workflow YAML is Over-Specified

The tool definition JSON is well-designed — dual execution path (API + UI fallback), security profile, fallback chain. Keep this.

The workflow YAML format, however, introduces its own DSL with `$input.origin`, `$search.output.flights`, `condition:` expressions. This is a mini programming language that needs:
- A parser
- A runtime evaluator
- Error handling for expression evaluation
- Documentation for the DSL syntax

**Question to ask:** Does the LLM agent actually need pre-built workflow DAGs? Or can it compose tool calls on its own, using tool descriptions and the dependency graph?

If the agent can plan tool sequences from descriptions (which modern LLMs can), the workflow YAML adds complexity without value. The dependency graph (`A.response.X → B.request.Y`) is sufficient guidance.

**Recommendation:** For MVP, drop workflow YAML. Provide the dependency graph and let the agent plan. Add workflows later only if agents consistently fail at multi-step sequencing.

---

## Summary

| Aspect | Rating | Action |
|--------|--------|--------|
| Two-layer architecture | ★★★★★ | Keep as-is |
| C-HAR design | ★★★★★ | Keep as-is |
| Agent-first exploration | ★★★★☆ | Keep, but simplify Task Planning |
| Phase 1.5 (Probe) | ★★★☆☆ | Reduce to 3-line summary + pointer |
| Phase 2 (Analyze) | ★★★★☆ | Good, needs clearer input/output contracts |
| Phase 3 (Generate) tools | ★★★★☆ | Good |
| Phase 3 workflows | ★★☆☆☆ | Drop YAML DSL, use dependency graph |
| Phase 4 (Execute/Heal) | ★★★★☆ | Solid, well-reasoned |

**Bottom line:** The pipeline's *structure* (4 phases) is right. The *granularity* within each phase is too fine for a design doc — it reads like an implementation spec. Separate "what" (architecture doc) from "how" (implementation guide).
