# Review: qi_note.md

**Reviewer:** Claude (system architect perspective)
**Date:** 2026-02-27
**Verdict:** Raw but contains two high-signal ideas buried in noise. Extract the gold, discard the rest.

---

## Context

This is an informal notes file — brainstorming scratchpad, not design doc. Reviewing it for signal, not polish.

---

## Idea 1: Self-Evolution Through Per-Website Builds ✅ HIGH VALUE

> 先挑一百个网站，然后在构建per-website-skill的过程中,每一个其实都是一个例子,搞出来的过程中有些知识是meta skill里没有的，搞完了之后再去update这个meta skill。

This is the single most important architectural insight in the entire project, and it's buried in a notes file.

**Why it matters from first principles:** Every compiler gets better by compiling more programs. GCC's optimization passes evolved from real-world code patterns. LLVM's middle-end was shaped by diverse frontends. The meta-skill should follow the same path — each website build is a training example that exposes gaps.

**What self-evolution.md gets right:** It already formalizes this as the "evolution loop" with procedural/declarative knowledge layers. Good — this note has been absorbed into the design.

**What's still missing:** The note says "先挑一百个网站" but the design docs don't have a **site selection strategy**. Which 100 sites? Random? By category? By anti-bot difficulty? The ordering matters enormously for the learning curve — you want to start with easy sites (public APIs, minimal anti-bot) and escalate to hard sites (Amazon, banking) as the knowledge base grows. This is **curriculum learning** applied to compiler evolution.

**Recommendation:** Add a "Site Curriculum" section to self-evolution.md:

```
Difficulty 1: Public API sites (weather.gov, open data portals)
Difficulty 2: Simple REST + cookies (internal tools, basic SaaS)
Difficulty 3: REST + CSRF + Cloudflare (e-commerce mid-tier)
Difficulty 4: GraphQL + anti-bot (social media, travel)
Difficulty 5: Signed payloads + behavioral detection (Amazon, banking)
```

This gives the meta-skill a gradient to learn on, rather than throwing it at Amazon on day 1.

---

## Idea 2: Agent-First Exploration ✅ ALREADY CAPTURED

> 最好在这个最初的explore&record阶段，最好也先不需要人，先直接用agent自己的browser-use capability

This is already the design in architecture-pipeline.md ("Agent-first, human-fallback"). The note predates the formalization. No action needed — the insight has been properly elevated.

---

## Idea 3: API-Key-Skill ⚠️ TANGENTIAL BUT INTERESTING

> 可以做一个open-api-key，或者叫api-key-skill，专门让agent去注册和获得api key的

**First principles analysis:** This is an interesting meta-capability — an agent that can sign up for API services and obtain keys. But:

1. **It's a different project.** Registering for API keys involves email verification, ToS acceptance, sometimes credit card entry. This is a full autonomous agent task, not a sub-feature of web-skill.
2. **It's ethically murky.** Auto-registering accounts raises ToS and identity verification concerns that web-skill specifically tries to avoid.
3. **It's not on the critical path.** The web-skill project's value proposition is mining APIs from sites that *don't* have public APIs. If a site has an API key signup flow, just use the official API.

**Recommendation:** Log this as a "future exploration" idea, but do NOT let it pollute the web-skill scope. If pursued, it should be a separate skill entirely.

---

## Idea 4: Free Model Bootstrap ⚠️ INFRASTRUCTURE, NOT DESIGN

> 默认可以用固定script获得openrouter上的免费model

This is a deployment/cost concern, not an architectural decision. Useful operationally but doesn't belong in the design document.

**Recommendation:** Move to a deployment/ops guide if one exists. Don't let infrastructure bootstrapping concerns leak into the design architecture.

---

## Meta-Review: This File's Role

This file serves as a brainstorming scratchpad. That's fine — but it should be clearly labeled as such, and ideas should be migrated to the relevant design docs once formalized. Currently, Idea 1 has been captured in self-evolution.md, Idea 2 in architecture-pipeline.md, and Ideas 3-4 are still orphaned here.

**Recommendation:** Either:
- (A) Rename to `brainstorm-notes.md` and add a header "Raw ideas — see design docs for formalized versions" and keep the file growing.
- (B) Delete the file once all ideas have been triaged — absorbed into design docs or explicitly rejected.

Option (B) is KISS. Dead notes files accumulate and confuse future readers.

---

## Summary

| Idea | Value | Status | Action |
|------|-------|--------|--------|
| Self-evolution through builds | ★★★★★ | Captured in self-evolution.md | Add "site curriculum" strategy |
| Agent-first exploration | ★★★★☆ | Captured in architecture-pipeline.md | None |
| API-key-skill | ★★☆☆☆ | Orphaned | Log as future idea, keep out of scope |
| Free model bootstrap | ★☆☆☆☆ | Orphaned | Move to ops guide or delete |
