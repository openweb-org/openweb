# Review: security-taxonomy.md

**Reviewer:** Claude (system architect perspective)
**Date:** 2026-02-27
**Verdict:** Excellent reference material. Terrible operational architecture. Needs radical simplification for the execution path; keep the taxonomy as documentation.

---

## The Core Problem With This Document

This document confuses **understanding** with **implementation**. It provides a brilliant 6-dimensional analysis of website security — and then suggests you build a 6-dimensional probing system to match. That's like seeing that physics has 4 fundamental forces and deciding your physics engine needs 4 separate simulation subsystems.

**From first principles:** The goal of probing is to answer one question per endpoint:

> **What is the cheapest execution mode that works?**

The answer is always one of ~4 modes (direct HTTP, with cookies, headless browser, headed browser + human). The *reason* an endpoint needs a browser (TLS fingerprint? JS challenge? HMAC signing?) is interesting for debugging but irrelevant for the execution decision.

---

## What's Right (Keep These)

### 1. The 6-Layer Taxonomy as Reference Documentation

The taxonomy itself is genuinely insightful:

```
Layer 1: Authentication
Layer 2: Session Protection
Layer 3: Bot Detection
Layer 4: Human Verification
Layer 5: Network Controls
Layer 6: Request Integrity
```

This is a useful mental model for anyone building web automation. It correctly identifies that security is multi-dimensional and layers are independent. **Keep this as a reference document** — it's the kind of thing engineers should read once to build intuition.

### 2. The "Common Real-World Configurations" Table

The table in §3.1.5.6 mapping site types to typical security configurations is the most operationally useful part of the document. It gives you priors: "Shopify-tier e-commerce → probably Cloudflare + CSRF, headless browser for reads."

### 3. The Observation Paradox

> You cannot determine from a set of successes which factors were *necessary* for success.

This is the document's deepest insight and the fundamental justification for probing. Beautifully stated. Keep it.

---

## What's Over-Engineered (Simplify These)

### 4. Per-Layer Probing is Over-Designed

The revised probing protocol (§3.1.5.5) tests 6 dimensions independently:

```
1. AUTH PROBE
2. CSRF PROBE
3. ORIGIN PROBE
4. TLS PROBE
5. BOT DETECTION PROBE
6. (write endpoints skipped)
```

**Why this is over-engineered:** You don't need to know *which* security layer blocks you. You need to know *what execution mode works*. These are different questions.

Consider: if direct HTTP fails and headless browser succeeds, do you care whether the failure was due to TLS fingerprinting (Layer 3) or a JS challenge (Layer 3) or HMAC signing (Layer 6)? No. You use headless browser. Done.

**The simple alternative — an escalation ladder:**

```
For each endpoint:
  1. Try direct HTTP (no cookies, no browser)     → works? mode = direct_http
  2. Try with session cookies                      → works? mode = session_replay
  3. Try with cookies + CSRF token extracted       → works? mode = session_replay_with_csrf
  4. Try in headless browser                       → works? mode = headless_browser
  5. Try in headed browser                         → works? mode = headed_browser
  6. Needs human                                   → mode = headed_browser_with_human
```

This is **6 requests per endpoint, sequential, with early termination.** It's O(1) probing cost, not O(6 dimensions × N mechanisms).

The per-layer taxonomy tells you *why* step 2 failed and step 4 worked. That's useful for the knowledge base (learning) but not for the probing decision (execution).

**Recommendation:** Implement the escalation ladder for probing. Log the full taxonomy classification for learning. Don't conflate the two.

### 5. The Security Profile JSON is Too Granular

The per-endpoint security profile stores 6 nested objects:

```json
{
  "auth": { "mechanism": "cookie_session", "required_cookies": ["session_id"] },
  "session_protection": { "mechanism": "none" },
  "bot_detection": { "mechanism": "none" },
  "human_verification": { "mechanism": "none" },
  "network": { "rate_limit": "100/min", "ip_bound": false },
  "request_integrity": { "mechanism": "none" }
}
```

For the execution engine, all that matters is:

```json
{
  "mode": "session_replay",
  "probed_at": "2025-02-26T12:05:00Z"
}
```

The detailed profile is metadata for debugging and knowledge-base evolution. It should live in a separate `debug/` or `probing-log/` directory, not in the runtime execution config.

**Simplification:**

```
execution-modes.json  (runtime, minimal)  ← execution engine reads this
probing-logs/         (debug, detailed)   ← knowledge base reads this
```

This follows the principle: **the hot path should be as simple as possible.** Rich metadata belongs in cold storage.

### 6. The Execution Strategy Derivation Pseudo-Code is a Red Flag

Section §3.1.5.3 has a ~30-line pseudo-code block that derives execution strategy from the security profile. This is a **derived computation over a complex data structure** — exactly the kind of code that accumulates bugs and special cases.

**The escalation ladder makes this derivation unnecessary.** You tried direct HTTP and it failed. You tried headless browser and it worked. The execution mode is `headless_browser`. No derivation needed. The empirical result IS the answer.

### 7. Six Execution Modes is One Too Many

The document defines:

```
direct_http
session_replay
session_replay_with_csrf
headless_browser
headed_browser
headed_browser_with_human
```

`session_replay` and `session_replay_with_csrf` can be merged. CSRF extraction is just a pre-step — fetch a page, extract token, attach to request. Whether you do it or not is a boolean flag on the `session_replay` mode, not a separate mode.

**Simplified modes (4):**

```
direct_http           — bare HTTP request
session_replay        — HTTP with cookies (+ optional CSRF extraction)
headless_browser      — Playwright headless, in-page fetch()
headed_browser        — Playwright headed (+ optional human handoff)
```

This 4-mode model covers every case in the "Common Real-World Configurations" table. The human handoff is a flag on headed_browser, not a separate mode — because headed_browser is always ready for human intervention; it's just a question of whether the human needs to do anything.

---

## What's Missing

### 8. Probing Safety

The document correctly notes that write endpoints should be skipped during probing (to avoid side effects). But it doesn't address:

- **Rate limiting during probing:** If you probe 20 endpoints × 6 attempts each, that's 120 requests in rapid succession. Some sites will flag this.
- **Probe spacing:** Should probes be spaced out? What delay between probes?
- **Probe failure ambiguity:** A 403 could mean "this security layer blocked you" or "this endpoint doesn't exist" or "you've been rate-limited." How do you disambiguate?

### 9. Cache/TTL for Probe Results

Probe results become stale. The document doesn't specify:
- How long a probe result is considered valid
- What triggers re-probing (time-based? failure-based? fingerprint change?)
- Whether re-probing should be full or incremental

---

## Radical Simplification Proposal

If I were rewriting this document from scratch, it would be 1/3 the length:

**Part 1: The Observation Paradox** (keep as-is, ~10 lines)
Why probing is necessary.

**Part 2: The Escalation Ladder** (~15 lines)
Try cheap modes first, escalate on failure, stop at first success.

**Part 3: The Security Taxonomy** (keep as reference appendix)
The 6-layer model with mechanism tables. Useful for understanding, not for implementation.

**Part 4: Common Configurations** (keep as-is)
The real-world site-type table. Useful as priors.

Everything else — the per-layer probing protocol, the derivation pseudo-code, the detailed security profile JSON — belongs in implementation docs or knowledge base specs, not in the architecture document.

---

## Summary

| Aspect | Rating | Action |
|--------|--------|--------|
| 6-layer taxonomy | ★★★★★ | Keep as reference appendix |
| Observation Paradox | ★★★★★ | Keep as motivation |
| Per-layer probing protocol | ★★☆☆☆ | Replace with escalation ladder |
| Security profile JSON | ★★☆☆☆ | Simplify to mode + timestamp for runtime |
| Execution strategy derivation | ★☆☆☆☆ | Delete — escalation makes it unnecessary |
| 6 execution modes | ★★★☆☆ | Merge to 4 modes |
| Common configurations table | ★★★★☆ | Keep as-is |

**Bottom line:** This document knows too much. It has the curse of the expert — every nuance is captured, every dimension is modeled, every mechanism is cataloged. But the system that actually runs doesn't need to know all this at once. Separate the **encyclopedia** (for human understanding and knowledge-base evolution) from the **algorithm** (for runtime probing and execution). The algorithm should fit on one page.
