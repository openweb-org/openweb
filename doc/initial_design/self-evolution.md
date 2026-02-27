# Hard Problems & Self-Evolution

*Part of the [web-skill design](web-skill-design.md). See also: [Architecture Pipeline](architecture-pipeline.md), [Security Taxonomy](security-taxonomy.md).*

---

## 7. Hard Problems & Mitigations

These are not engineering gaps but fundamental properties of websites that make
full automation hard. The design must account for each.

### 7.1 Stateful Authentication & Anti-Fraud

**Problem:** Cookies, CSRF tokens, device fingerprints, step-up verification (SMS/email/2FA), payment confirmation. Many requests can't be naively replayed.

**Mitigation:**
- Execute all requests **within the browser session** (same cookies, same fingerprint).
- Extract CSRF/nonce tokens **just-in-time** from the page before each request.
- For step-up auth (CAPTCHA, 2FA), return a `requires_human_step` status with instructions, pausing the workflow until the user completes the challenge.
- Never store or transmit credentials; the user's browser session is the authentication boundary.

### 7.2 Signed / Encrypted Payloads

**Problem:** Some sites HMAC-sign or encrypt request payloads with runtime-generated keys bound to the session or device. Observing one request doesn't mean you can construct another.

**Mitigation:**
- The in-browser bridge can call the site's own signing functions (they're JavaScript, running in the same page context). Instead of reverse-engineering the signing algorithm, we call it.
- Extract the signing function reference from the client-side bundle and invoke it through `page.evaluate()`.
- When signing logic is obfuscated beyond practical extraction, fall back to UI automation for that specific operation.

### 7.3 Multi-Request State Machines

**Problem:** A single user action (e.g., "place an order") may map to a chain of requests: `create_session -> apply_coupon -> lock_inventory -> create_payment_intent -> confirm`.

**Mitigation:**
- The dependency graph (Phase 2, Step D) explicitly models these chains.
- Workflows are represented as DAGs, not individual tool calls.
- The execution engine handles sequencing, passing intermediate state between steps.
- Verification happens at each step, not just the final one.

### 7.4 GraphQL / WebSocket / SSE

**Problem:** GraphQL uses a single endpoint with varying operations. WebSocket/SSE provide real-time data that doesn't follow request/response patterns.

**Mitigation:**
- GraphQL clustering uses `operationName` (or query hash for persisted queries) instead of URL path.
- GraphQL variables become tool parameters; the query/mutation itself becomes the template.
- WebSocket messages are captured and classified (subscribe/unsubscribe/data-push).
- For real-time data needs, tools can return "subscribe" handles that the agent polls or awaits.

### 7.5 Legal & Compliance

**Problem:** Many websites prohibit reverse engineering, automated access, or API scraping in their Terms of Service.

**Mitigation:**
- web-skill operates **on the user's own device, in the user's own browser session**. It is functionally equivalent to the user clicking buttons -- just faster and structured.
- The system does not circumvent access controls, break authentication, or access data the user couldn't access manually.
- For compliance-sensitive deployments, the skill package can be configured to require explicit user confirmation for write operations.
- Long-term, prioritize sites with official APIs or WebMCP support; web-skill is the bridge for sites that haven't adopted standards yet.
- Enterprise deployments should focus on internal tools and authorized integrations.

---

## 8. Meta-Skill Self-Evolution

The meta-skill is not a static compiler. It is a compiler that **rewrites itself** as it processes more websites. Each per-website-skill build is a training example that can expose gaps in the meta-skill's knowledge.

### 8.1 Two Layers of Knowledge

| Layer | What it is | How it changes | Analogy |
|---|---|---|---|
| **Procedural** (SKILL.md) | The algorithm itself: "how to build a web skill" | Rarely. Only when a fundamentally new challenge type is discovered that the current pipeline can't handle. | Compiler's core passes |
| **Declarative** (knowledge/) | Pattern libraries, heuristics, extractor templates, probe statistics | Frequently. Grows with almost every new site. | Compiler's optimization rules database |

Most evolution happens in the declarative layer. The procedural layer only changes when you discover something like "we need an entirely new phase for protobuf schema recovery" -- a structural gap, not just a new pattern.

### 8.2 Knowledge Base Structure

```
web-use-skill/
├── SKILL.md                              # Procedural: the pipeline algorithm
├── knowledge/
│   ├── patterns/                         # Site architecture patterns
│   │   ├── nextjs.md                     # "When you see /_next/data/{buildId}/..."
│   │   ├── remix-loaders.md              # "Remix uses __data requests..."
│   │   ├── graphql-persisted-queries.md  # "When operationName is missing but hash..."
│   │   ├── spa-client-routing.md         # "Hash routing vs history API..."
│   │   ├── grpc-web.md                   # "Content-Type: application/grpc-web..."
│   │   └── ...
│   ├── anti-bot/                         # Anti-bot system signatures
│   │   ├── cloudflare.md                 # "Sets __cf_bm cookie, challenge page..."
│   │   ├── akamai.md                     # "Sets _abck cookie, sensor data..."
│   │   ├── perimeterx.md                 # "Sets _px3 cookie..."
│   │   └── ...
│   ├── extractors/                       # Reusable token extraction templates
│   │   ├── csrf-meta-tag.js              # document.querySelector('meta[name=csrf]')
│   │   ├── csrf-script-var.js            # regex from inline <script>
│   │   ├── csrf-cookie.js               # from Set-Cookie header
│   │   ├── csrf-bootstrap-json.js        # from __NEXT_DATA__ or window.__CONFIG__
│   │   └── ...
│   ├── probe-heuristics.json             # Empirical stats from all past sites
│   └── failure-playbook.md              # "When you see X failure, try Y fix"
├── history/                              # Build logs for each site
│   ├── 001-google-flights.md
│   ├── 002-amazon.md
│   ├── 003-reddit.md
│   └── ...
└── meta-stats.json                       # Aggregate statistics
```

### 8.3 The Evolution Loop

For each new site build:

```
1. LOAD current meta-skill
   - Read SKILL.md (procedural)
   - Read knowledge/ (declarative)
   - Read meta-stats.json (priors)

2. RUN pipeline on target site
   - Use knowledge/patterns/ to recognize site architecture early
   - Use knowledge/anti-bot/ to prioritize probing strategy
   - Use knowledge/extractors/ as templates for CSRF/token extraction

3. DURING build, encounter something new?
   |
   |-- New site architecture pattern?
   |     -> Write knowledge/patterns/new-pattern.md
   |
   |-- New anti-bot system?
   |     -> Write knowledge/anti-bot/new-system.md
   |
   |-- New CSRF/token extraction method?
   |     -> Write knowledge/extractors/new-extractor.js
   |
   |-- New failure mode + fix?
   |     -> Append to knowledge/failure-playbook.md
   |
   |-- Probe result contradicts heuristic?
   |     -> Update probe-heuristics.json with new data point

4. AFTER build: write history/NNN-site-name.md
   - What worked
   - What failed and how it was fixed
   - What new knowledge was added
   - Build statistics (time, tool count, coverage)

5. UPDATE meta-stats.json
   - Increment sites_built
   - Update pattern frequency distribution
   - Update probe success rates
   - Update failure mode counts
```

### 8.4 meta-stats.json Example

After building skills for 47 sites:

```json
{
  "sites_built": 47,
  "overall_success_rate": 0.83,
  "patterns_seen": {
    "rest_json": { "count": 31, "avg_tools_generated": 12 },
    "graphql": { "count": 8, "avg_tools_generated": 18 },
    "nextjs_data": { "count": 12, "avg_tools_generated": 9 },
    "grpc_web": { "count": 2, "avg_tools_generated": 6 },
    "protobuf_http": { "count": 1, "avg_tools_generated": 3 }
  },
  "probe_statistics": {
    "direct_http_sufficient": 0.41,
    "session_replay_sufficient": 0.28,
    "browser_required": 0.31,
    "by_anti_bot": {
      "cloudflare": { "sites": 15, "direct_http_success_rate": 0.067 },
      "akamai": { "sites": 7, "direct_http_success_rate": 0.0 },
      "none_detected": { "sites": 20, "direct_http_success_rate": 0.85 }
    }
  },
  "common_failure_modes": [
    { "mode": "csrf_extraction_failed", "count": 7, "fix": "added csrf-script-var.js extractor" },
    { "mode": "graphql_persisted_query_not_recognized", "count": 3, "fix": "cluster by extensions.persistedQuery.sha256Hash" },
    { "mode": "protobuf_body_not_json", "count": 1, "fix": "added protobuf decode phase" },
    { "mode": "websocket_data_missed", "count": 4, "fix": "added WS frame capture to recording" }
  ],
  "knowledge_files_count": {
    "patterns": 14,
    "anti_bot": 5,
    "extractors": 11
  }
}
```

### 8.5 What Triggers Procedural Changes

The procedural layer (SKILL.md pipeline) should change when meta-stats reveal a **systemic gap** -- not just a one-off:

| Signal | Implication | Procedural Change |
|---|---|---|
| 3+ sites fail on protobuf bodies | "Assume JSON" is a broken assumption in the pipeline | Add a content-type detection step before schema induction |
| WebSocket-heavy sites consistently produce incomplete skills | Phase 1 recording doesn't capture enough WS data | Expand recording phase with dedicated WS exploration |
| Probe heuristics become highly predictive (>90% accuracy for certain signals) | Can skip probing for some endpoints | Add "fast-path skip" to Phase 1.5 based on confidence threshold |
| A new anti-bot system appears across 5+ sites | Knowledge base entry isn't enough; may need a new probe step | Add anti-bot detection pre-pass to Phase 1 |

### 8.6 The Compounding Effect

This architecture has a flywheel property:

```
Site 1:  meta-skill knows nothing    -> struggles, builds skill slowly, learns 10 patterns
Site 5:  meta-skill knows 30 patterns -> builds faster, fewer failures, learns 3 new things
Site 20: meta-skill knows 80 patterns -> most sites are "seen this before", builds reliably
Site 50: meta-skill is a mature compiler -> novel sites are rare, self-healing handles drift
```

The meta-skill's knowledge base becomes the **distilled experience** of building skills for diverse websites. This is the moat: the more sites you compile, the better the compiler gets, and the harder it is for someone starting from zero to replicate.
