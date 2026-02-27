# Review: self-evolution.md

**Reviewer:** Claude (system architect perspective)
**Date:** 2026-02-27
**Verdict:** Section 7 (Hard Problems) is tight and honest. Section 8 (Self-Evolution) has the right intuition but under-specifies the hard parts and over-specifies the easy parts.

---

## Section 7: Hard Problems — Mostly Excellent

### 7.1–7.4: Clean Problem/Mitigation Pairs

Each subsection follows a crisp pattern: state the problem, explain why it's fundamental (not just an engineering gap), give the mitigation strategy. This is how hard-problem sections should read.

**Specific praise:**

- §7.2 (Signed Payloads): The insight that you can **call the site's own signing functions** via `page.evaluate()` rather than reverse-engineering them is the pragmatic shortcut that makes the whole system viable. This is the kind of "make the hard case simple by changing the frame" thinking that good architects do.

- §7.3 (Multi-Request State Machines): Correctly identifies that "place an order" is a DAG, not a single call. The mitigation (dependency graph + workflow DAG + per-step verification) is appropriate.

- §7.4 (GraphQL/WebSocket/SSE): The key decision — cluster GraphQL by `operationName` instead of URL — is correct and non-obvious.

### 7.5: Legal & Compliance — Necessary but Soft

The legal section is the weakest of the five. The argument "it's equivalent to the user clicking buttons — just faster" is true but legally untested. Most ToS prohibit automated access regardless of mechanism.

**What's missing:** A clear statement of the legal risk gradient:

```
Low risk:  User automates their own internal tools
Medium:    User automates a third-party SaaS they pay for
High:      User automates a free consumer service (Google, Amazon)
Very high: Distributing extracted API specs for others to use
```

The current framing ("for compliance-sensitive deployments, configure...") buries this risk gradient in a mitigation clause. Be more honest about where the legal uncertainty lies.

---

## Section 8: Self-Evolution — Right Direction, Wrong Emphasis

### 8.1: Two-Layer Knowledge Split ✅

```
Procedural (SKILL.md) — the algorithm, changes rarely
Declarative (knowledge/) — patterns + heuristics, grows with each site
```

This is a clean separation. It mirrors the compiler analogy well: core passes vs. optimization rules. **Keep this.**

### 8.2: Knowledge Base Structure — Over-Specified

The proposed directory tree has:

```
knowledge/
├── patterns/          (14 files after 47 sites)
├── anti-bot/          (5 files)
├── extractors/        (11 files)
├── probe-heuristics.json
└── failure-playbook.md
history/               (1 file per site)
meta-stats.json
```

**Problem:** This structure is designed as if we know what knowledge categories exist. We don't — we haven't built a single site yet.

**The KISS alternative:**

```
knowledge/
├── patterns.md        # append-only log of discovered patterns
├── heuristics.json    # empirical probe stats, updated per build
└── failures.md        # append-only log of failure modes + fixes
history/               # one file per site build
```

Start with 3 files. If `patterns.md` grows to 50+ patterns and needs sub-categorization, split it then. Don't pre-build a taxonomy of knowledge when you have zero data points.

**Linus principle:** "Don't design for problems you don't have yet."

### 8.3: The Evolution Loop — Missing the Hard Part

The evolution loop is well-described at a high level:

```
1. Load meta-skill
2. Run pipeline on target site
3. During build, encounter something new? → Write to knowledge/
4. After build, write history/ log
5. Update meta-stats
```

This describes the **happy path**. What's missing is the **conflict resolution** path:

- **Pattern conflict:** Site A teaches "Cloudflare sites always need headless browser." Site B (also Cloudflare) works with direct HTTP. Which pattern wins?
- **Overfitting:** The meta-skill learns a pattern from amazon.com that only applies to amazon.com. How do you detect site-specific patterns vs. generalizable patterns?
- **Knowledge decay:** A pattern learned from site #5 becomes obsolete as that site updates. How do you expire stale knowledge?
- **Rollback:** A new pattern breaks an existing site's skill. How do you test that knowledge base changes don't regress?

These aren't theoretical concerns — they're the core challenges of any self-modifying system. The document hand-waves them.

**Recommendation:** Add a "Knowledge Base Integrity" subsection that addresses:

1. **Generalization test:** Before committing a new pattern, validate it against at least 2 existing sites. If it only works for 1 site, mark it as site-specific.
2. **Regression test:** After updating the knowledge base, re-run the test suites for the 5 most recent site builds.
3. **Conflict resolution:** When patterns conflict, keep both with a confidence score. Let the meta-skill try the higher-confidence one first and fall back to the other.
4. **TTL on patterns:** Patterns not referenced by any successful build in 6 months get archived.

### 8.4: meta-stats.json — Good but Premature

The example JSON after 47 sites is a nice illustration of what the system *could* look like. But at site 0, you don't need meta-stats. At site 5, you need maybe 3 fields:

```json
{
  "sites_built": 5,
  "success_rate": 0.80,
  "most_common_failure": "csrf_extraction_failed"
}
```

Build meta-stats incrementally. Don't design the schema for 47 sites when you have 0.

### 8.5: Procedural Change Triggers — Good Judgment Calls

The table mapping signals to procedural changes (e.g., "3+ sites fail on protobuf → add content-type detection step") is good. It defines a threshold (N occurrences of the same systemic gap) before touching the core algorithm. This is the right conservatism.

**One improvement:** Make the threshold explicit and configurable, not embedded in prose. Something like:

```
Declarative change: Any single novel observation
Procedural change: Same systemic gap in ≥3 independent sites + human approval
```

### 8.6: Compounding Effect — Aspirational

The flywheel narrative (site 1 is slow, site 50 is fast) is motivating but unverified. Real compounding depends on:

1. **Pattern reuse rate:** What % of site N's challenges are solved by patterns from sites 1–(N-1)?
2. **Knowledge base noise:** Does the signal-to-noise ratio of the knowledge base improve or degrade over time?
3. **Generalization quality:** Do patterns learned on e-commerce sites help with travel sites?

These are empirical questions that can only be answered by building sites. The document should acknowledge this uncertainty.

---

## Structural Critique

### The Two Sections Don't Belong in One Document

Section 7 (Hard Problems) is a **risk register** — it lists fundamental challenges and mitigations.
Section 8 (Self-Evolution) is a **system design** — it describes the learning architecture.

These serve different audiences and change at different rates. Hard problems are stable (websites will always have auth). Self-evolution design is experimental (the knowledge base structure will change).

**Recommendation:** Split into:
- `hard-problems.md` — stable reference, rarely changes
- `self-evolution.md` — evolving design, changes as the system learns

---

## Summary

| Aspect | Rating | Action |
|--------|--------|--------|
| §7.1–7.4 Problem/Mitigation | ★★★★★ | Keep as-is |
| §7.5 Legal | ★★★☆☆ | Add explicit risk gradient |
| §8.1 Two-layer split | ★★★★★ | Keep as-is |
| §8.2 Knowledge structure | ★★★☆☆ | Simplify to 3 files, grow organically |
| §8.3 Evolution loop | ★★★☆☆ | Add conflict resolution + regression testing |
| §8.4 meta-stats | ★★★☆☆ | Start minimal, grow incrementally |
| §8.5 Procedural triggers | ★★★★☆ | Make thresholds explicit |
| §8.6 Compounding effect | ★★★☆☆ | Acknowledge it's aspirational, define metrics |

**Bottom line:** The hard-problems section demonstrates the kind of honest, first-principles thinking this project needs. The self-evolution section has the right vision but skips the hard parts (conflict resolution, overfitting, regression) and over-specifies the easy parts (directory structure, stats schema). Flip the emphasis: spend more words on what can go wrong with self-modification, fewer words on file layouts.
