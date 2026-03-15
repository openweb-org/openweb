# Hard Problems & Self-Evolution

> **Status**: COMPLETE
> **Referenced by**: [compiler-pipeline.md](compiler-pipeline.md), [security-taxonomy.md](security-taxonomy.md)
> **Mostly unchanged from v1** — added L2/L3 pattern growth mechanism.

---

## Hard Problems & Mitigations

These are not engineering gaps but fundamental properties of websites that make full automation hard. The design must account for each.

### 1. Stateful Authentication & Anti-Fraud

**Problem:** Cookies, CSRF tokens, device fingerprints, step-up verification (SMS/email/2FA), payment confirmation. Many requests can't be naively replayed.

**Mitigation (progressive):**
- **MVP-1**: No auth (public site: Open-Meteo).
- **MVP-2 capture**: Real Chrome profile — user's existing login session inherited during `openweb compile`.
- **MVP-2 runtime**: `openweb login <site>` — visible browser handoff → cookies + Bearer tokens captured on close → plaintext cookie jar at `~/.openweb/sessions/<site>/cookies.json`.
- **MVP-3**: Encrypted auth store (AES-256-GCM, machine-ID keyed key derivation, subdomain fallback). JWT `exp` parsing for proactive refresh.
- **Post-MVP**: Auto-refresh — OAuth refresh_token flow (no browser) + browser-based CSRF refresh + CAPTCHA detection (switch to visible mode).
- For step-up auth (CAPTCHA, 2FA), raise `human_handoff` with instructions and pause until the user completes the challenge.
- Never store or transmit credentials; the user's browser session is the authentication boundary.

### 2. Signed / Encrypted Payloads

**Problem:** Some sites HMAC-sign or encrypt request payloads with runtime-generated keys bound to the session or device. Observing one request doesn't mean you can construct another.

**Mitigation:**
- **L2 signing primitives** handle known algorithms: `sapisidhash`, `aws_sigv4`. See [layer2-interaction-primitives.md](layer2-interaction-primitives.md).
- **L3 code adapters** call the site's own signing functions via `page.evaluate()` for obfuscated signers (OnlyFans, TikTok). See [layer3-code-adapters.md](layer3-code-adapters.md).
- When signing logic is obfuscated beyond practical extraction, fall back to `browser_fetch` mode.

### 3. Multi-Request State Machines

**Problem:** A single user action (e.g., "place an order") may map to a chain of requests: `create_session → apply_coupon → lock_inventory → create_payment_intent → confirm`.

**Mitigation:**
- The dependency graph explicitly models these chains.
- The agent sequences tool calls using the graph.
- Verification happens at each step, not just the final one.
- **Rollback is the agent's responsibility.** Each tool call is atomic. The runtime does not manage multi-step transactions. The agent uses the dependency graph to plan sequences and handles failures at each step. This is an explicit design principle.

### 4. GraphQL / WebSocket / SSE

**Problem:** GraphQL uses a single endpoint with varying operations. WebSocket/SSE provide real-time data that doesn't follow request/response patterns.

**Mitigation:**
- GraphQL (first-class from MVP-2): detect by path + `operationName`/`query` in body. Cluster by `POST + operationName`. Variables become parameters. `query` string → fixed template. operationId: `{query|mutation}_{OperationName}`. See [compiler-pipeline.md](compiler-pipeline.md) Phase 2 Step A.
- WebSocket: captured via CDP events → JSONL. Structured APIs described via AsyncAPI 3.x. See [browser-integration.md](browser-integration.md).
- SSE: captured as HTTP responses + event JSONL sidecar.

### 5. Legal & Compliance

**Problem:** Many websites prohibit reverse engineering, automated access, or API scraping in their Terms of Service.

**Risk gradient (be honest):**

| Risk Level | Scenario |
|---|---|
| Low | Automate your own internal tools |
| Medium | Automate a third-party SaaS you pay for |
| High | Automate a free consumer service (Google, Amazon) |
| Very high | Distribute extracted API specs for others to use |

**Mitigation:**
- Operate on user's own device, in user's own browser session. Functionally equivalent to clicking buttons — just faster and structured.
- Don't circumvent access controls, break authentication, or access data the user couldn't access manually.
- Require explicit user confirmation for write operations.
- Prioritize sites with official APIs or WebMCP support. openweb is the bridge for sites that haven't adopted standards.
- Enterprise deployments: focus on internal tools and authorized integrations.

---

## Meta-Skill Self-Evolution

The meta-skill is not a static compiler. It's a compiler that **learns** as it processes more websites. Each per-website-skill build is a training example that can expose gaps in the meta-skill's knowledge.

### Two Layers of Knowledge

| Layer | What | Changes | Analogy |
|---|---|---|---|
| **Procedural** (compiler pipeline) | The algorithm: how to build an openweb skill | Rarely. Only for systemic gaps. | Compiler's core passes |
| **Declarative** (knowledge/) | Patterns, heuristics, extractors | Frequently. Grows with each site. | Compiler's optimization rules |

Most evolution happens in the declarative layer. The procedural layer only changes when you discover something like "we need entirely new handling for protobuf responses" — a structural gap, not just a new pattern.

### Minimal Knowledge Structure

```
knowledge/
├── patterns.md           # Append-only log of discovered patterns
├── heuristics.json       # Empirical probe stats, updated per build
└── failures.md           # Append-only log of failure modes + fixes
history/                  # One file per site build
```

**3 files.** Start here. If `patterns.md` grows to 50+ entries and needs sub-categorization, split it then. Don't pre-build a taxonomy of knowledge with zero data points.

Example entries after a few builds:

**patterns.md:**
```
## Next.js Data Fetching
When you see `/_next/data/{buildId}/...` URLs, these are Next.js server-side data routes.
The buildId changes on each deployment. Query params passthrough to the page's getServerSideProps.
Discovered on: site #3 (news-site), confirmed on: site #7 (saas-tool)

## Cloudflare JS Challenge
Sites behind Cloudflare set __cf_bm cookie. Direct HTTP fails in ~94% of cases.
Start probing at headless browser for these sites.
Discovered on: site #2, confirmed on: sites #5, #8, #12, #15
```

**heuristics.json:**
```json
{
  "sites_built": 5,
  "probe_stats": {
    "direct_http_sufficient": 0.32,
    "session_http_sufficient": 0.18,
    "browser_fetch_required": 0.42,
    "human_handoff_needed": 0.08
  },
  "signals": {
    "__cf_bm_cookie": { "browser_fetch_needed_rate": 0.94, "sample_size": 15 },
    "x_csrf_token_header": { "csrf_enforced_rate": 0.72, "sample_size": 11 }
  }
}
```

### The Evolution Loop

```
For each new site build:

1. LOAD current knowledge
   - Read patterns.md, heuristics.json, failures.md
   - Use heuristics to optimize probe order

2. RUN compiler pipeline on target site
   - Use patterns to recognize architecture early
   - Use heuristics to prioritize probing strategy

3. DURING build, encounter something new?
   ├─ New site architecture pattern?     → Append to patterns.md
   ├─ New failure mode + fix?            → Append to failures.md
   ├─ Probe result contradicts heuristic? → Update heuristics.json
   └─ New CSRF extraction method?         → Add to extractors/, note in patterns.md

4. AFTER build: write history/{N}-{site}.md
   - What worked, what failed, what was learned
   - Build statistics (time, tool count, coverage)

5. UPDATE heuristics.json
   - Increment sites_built
   - Update probe success rates
```

### Knowledge Integrity (The Hard Part)

### v2: L2 Pattern Library Growth

In v2, the knowledge base is structured around L2 primitives rather than
free-text notes. Growth happens via two mechanisms:

**1. New L2 primitive types** — When 3+ sites exhibit the same L3 pattern,
it can be promoted to a parameterized L2 primitive:

```
L3 observation: 3 sites extract tokens from Okta localStorage
  → Generalize: localStorage_jwt with key_pattern: "okta-token-storage"
  → New L2 type: (or parameterize existing localStorage_jwt)
  → Regression test: verify all 3 sites still work
```

**2. L3 → L2 promotion** — As obfuscated patterns become understood:

```
Site 1: OnlyFans signing → L3 (obfuscated webpack module)
Site 2: minimax-agent HMAC → L3 (obfuscated Axios interceptor)
Pattern: Both extract a signing function from webpack → call it per-request
  → If parameterizable: promote to L2 "webpack_signing" primitive
  → If each site's module is unique: keep as L3 with shared adapter skeleton
```

**L2 primitive addition criteria:**
- Pattern appears in ≥3 independent sites
- Can be expressed with ≤10 config parameters
- Runtime handler is ≤100 lines of code
- Existing L2 types don't already cover the pattern

See [layer2-interaction-primitives.md](layer2-interaction-primitives.md) for the
current 27-type catalog.

### Knowledge Integrity (The Hard Part)

Self-modifying systems are dangerous. These safeguards prevent the knowledge base from degrading:

**Generalization test:** Before promoting a pattern from a single-site observation to a reusable rule, require it to match ≥2 independent sites. One-site patterns are site-specific metadata, not knowledge.

**Regression testing:** After updating the knowledge base, re-run test suites for the 5 most recent site builds. If any regress, investigate before committing.

**Conflict resolution:** When patterns conflict (site A: "Cloudflare always needs browser," site B with Cloudflare: works with direct HTTP), keep both with confidence scores. Try higher-confidence first, fall back to other.

**Knowledge lifecycle:** Entries follow `candidate → validated → deprecated`.
- `candidate`: Observed on 1 site. Noted but not used for optimization.
- `validated`: Confirmed on ≥2 sites. Used for probe optimization and architecture recognition.
- `deprecated`: Not referenced by any successful build in 6 months. Archived, not deleted.

**Procedural change threshold:** Same systemic gap must appear in ≥3 independent sites + require human approval + pass full regression before touching the compiler pipeline.

### What Triggers Procedural Changes

| Signal | Implication | Change |
|---|---|---|
| 3+ sites fail on protobuf bodies | "Assume JSON" is broken | Add content-type detection step |
| WebSocket-heavy sites consistently incomplete | Phase 1 misses WS data | Expand recording for WS |
| Probe heuristics >90% accurate for a signal | Can skip some probes | Add fast-path based on confidence |
| New anti-bot system across 5+ sites | Knowledge entry isn't enough | Add detection pre-pass |

### The Compounding Effect (Aspirational, Unverified)

```
Site 1:   knows nothing → slow, learns many patterns
Site 5:   knows 30 patterns → faster, fewer failures
Site 20:  knows 80 patterns → most sites feel familiar
Site 50:  mature compiler → novel sites are rare, self-healing handles drift
```

This flywheel is the project's moat. Measuring its health requires tracking:
- **Pattern reuse rate:** What % of site N's challenges are solved by existing knowledge?
- **Knowledge noise:** Does signal-to-noise improve or degrade over time?
- **Cross-domain transfer:** Do e-commerce patterns help with travel sites?

These are empirical questions answered only by building sites.

---

## Cross-References

- **L2 pattern catalog** → [layer2-interaction-primitives.md](layer2-interaction-primitives.md): Current 27 primitive types
- **L3 adapters** → [layer3-code-adapters.md](layer3-code-adapters.md): Code escape hatch for non-parameterizable patterns
- **Compiler pipeline** → [compiler-pipeline.md](compiler-pipeline.md): Where pattern matching occurs
- **Security probing** → [security-taxonomy.md](security-taxonomy.md): Escalation ladder + heuristics
- **Pattern library** → [pattern-library.md](pattern-library.md): 103 plugins classified by layer

### Site Curriculum (Learning Gradient)

Don't start with the hardest sites. Order builds by increasing difficulty so the knowledge base develops incrementally:

| Difficulty | Characteristics | Examples |
|---|---|---|
| 1 | Public JSON APIs, no auth, no anti-bot | weather.gov, open data portals |
| 2 | Simple REST + cookies, minimal CSRF | internal tools, basic SaaS |
| 3 | REST + CSRF + Cloudflare WAF | mid-tier e-commerce |
| 4 | GraphQL + anti-bot + signed requests | social media, travel |
| 5 | Signed payloads + behavioral detection + complex session | Amazon, banking |

Start at difficulty 1 to validate the pipeline. Escalate as knowledge accumulates.
