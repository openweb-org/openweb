# Discovery Process

How to add a new site or expand an existing site's operation coverage.

**Responsibility:** Coverage — are all target intents captured? Correctness is `compile.md`'s job.

## When to Use

- User asks about a site with no site package
- Expanding coverage for an existing site (more operations, new protocols)
- Site package is stale or has auth/transport issues

## Before You Start

- Read `references/knowledge/archetypes/index.md` — what type of site is this?
  Archetypes are heuristic starting points, not limiting checklists.
  Define targets based on user needs and actual site capabilities.
- Read `references/knowledge/bot-detection-patterns.md` — what anti-bot measures to expect?
- Read `references/knowledge/auth-patterns.md` — what auth do you expect?
- If the site already has a package, read its DOC.md and openapi.yaml
  to understand current coverage before capturing more

## Critical Rule: Browser First, No Direct HTTP

**NEVER use curl, fetch, wget, or any direct HTTP request to probe a site during discovery.** Not even to "check if it works" or "see what the response looks like."

Why: Bot detection systems (PerimeterX, DataDome, Akamai) track IP reputation across all requests. A single curl request registers as non-browser traffic and raises the IP's risk score. Multiple probes escalate to an IP-level block that poisons subsequent browser sessions too — even a real user in a real browser on the same IP will be trapped in unsolvable CAPTCHAs.

**Always start with the managed browser.** If the browser hits a CAPTCHA, that's the time to decide whether to solve it or declare the site blocked. Do not attempt to gather information via direct HTTP first.

## Write Operation Safety

When discovering write operations (POST/PUT/PATCH/DELETE), capture the traffic but be cautious about verification:

When documenting write operations in DOC.md, mark each with a safety level: SAFE (reversible), CAUTION (manageable impact), NEVER (irreversible/costly).

**Safe to capture and trigger:**
- Add to cart (without purchasing)
- Like/upvote/bookmark
- Follow/unfollow
- Fill forms (without submitting payment)
- Post content (then immediately delete)

**Caution (only in safe contexts):**
- Send messages: only to yourself (Slack) or quiet test channels (Discord)
- Post tweets: delete immediately after capture

**Never trigger during discovery:**
- Purchase/payment/checkout completion
- Delete account or important data
- Send messages to anyone unless specified by user as safe
- Any irreversible action with real-world consequences

Verify skips write operations by default. To verify writes, use `--include-writes` (manual only).

## Process

### Overview

```
  Step 1: Frame target intents
       |
       v
  Step 2: Capture  <----------+
       |                       |
       v                       |
  Step 3: Analyze              |
       |                       |
       v                       |
  Step 4: Review analysis      |
       |                       |
       v                       |
  Step 5: Fill gaps -- missing intents?
       |
       v  (coverage complete)
  Step 6: Handoff to compile agent
```

### Step 1: Frame the Target

- Identify the site archetype (read the relevant section in archetypes)
- Define 3-5 target intents described as **user actions**, not API names
  (Based on user needs and actual site capabilities, not copied from archetype templates)
- Create or update DOC.md with an initial overview and target-intent checklist
  (Following the `references/site-doc.md` template)
- If specific operations are requested, those are your targets

**Examples of good target intents:**
- E-commerce: search products by keyword; get product detail; get reviews
- Travel: search flights by route and date; get pricing details
- Social: search posts by keyword; get post detail with comments; get user profile

### Step 2: Capture

```bash
openweb browser start
openweb capture start --cdp-endpoint http://localhost:9222
# Browse systematically to trigger target operations:
#   - Do a search -> triggers search API
#   - Click into a result -> triggers detail API
#   - Scroll/paginate -> triggers pagination
#   - Check other features (reviews, status, profile)
# Avoid: logout, delete account, billing, irreversible actions
openweb capture stop
```

### Step 3: Analyze

Run the compile command to produce an analysis report from the captured traffic:

```bash
openweb compile <site-url> --capture-dir <dir>
```

This runs the Analyze phase (code-only) and produces `analysis.json` in `~/.openweb/compile/<site>/`.

The analysis report labels every captured request (no data is discarded), clusters API requests into candidate operations, detects auth patterns, and identifies extraction signals. It replaces the old split report files.

### Step 4: Review Analysis Report

Read `~/.openweb/compile/<site>/analysis.json`. Focus on coverage — are your target intents represented?

#### 4a. Summary

Check `summary.byCategory`:
- `api` — requests routed to clustering (these become operations)
- `static` — CSS/JS/images/fonts (noise, expected)
- `tracking` — analytics beacons (noise, expected)
- `off_domain` — requests to different domains

If `api` count is zero or very low, the capture missed the target traffic. Return to Step 2.

If `off_domain` count is high and your target API lives on a different domain (e.g., chatgpt.com calls api.openai.com), re-run with `--allow-host <domain>`.

#### 4b. Navigation Groups

`navigation` shows which page triggered which requests. Use this to map target intents to captured traffic:
- "I searched for X on the site" -> is there a navigation group for that page with api-labeled requests?
- "I clicked into a detail page" -> is there a corresponding group?

If a target intent has no matching navigation group, it was not captured.

#### 4c. Clusters

`clusters` shows how API requests were grouped into candidate operations. Check:
- Does each target intent have at least one matching cluster?
- `suggestedOperationId` and `suggestedSummary` — do they describe the right action?
- `sampleCount` — a cluster with 100+ samples on the same path likely indicates a GraphQL single-endpoint pattern. Check for `graphql` sub-cluster info.
- Are there multiple clusters that look like the same operation? (Path normalization may have split them.)

#### 4d. Auth Candidates

`authCandidates` shows ranked auth detection results with evidence:
- `confidence` — how certain is the detection?
- `evidence.matchedCookies` — which cookies were identified?
- `evidence.matchedEntries` / `totalEntries` — coverage ratio

Note this for the handoff — the compile agent will confirm the final auth choice.

#### 4e. Extraction Signals

`extractionSignals` shows SSR/DOM data detected (Next.js `__NEXT_DATA__`, embedded JSON, etc.). If target intent data comes from SSR rather than API calls, this confirms the data source.

### Step 5: Fill Gaps (iterate Steps 2-4)

If target operations are missing from the analysis:
- Read page DOM (`page.evaluate`) to look for SSR data (`__NEXT_DATA__`, embedded JSON)
- Check whether data loads via fetch/XHR or is in the initial HTML
- Try different user actions (different search terms, scroll for lazy loading, click different detail pages)
- Check whether the site uses GraphQL (single endpoint, query in POST body)
- If login is required: `openweb login <site>`, restart browser, re-capture
- Re-capture with more targeted browsing

**Repeat Steps 2-5 until every target intent has at least one credible data source** (API cluster, SSR extraction signal, or DOM data).

### Step 6: Handoff

When coverage is complete, hand off to the compile agent with:

1. **Capture directory** — the raw capture data
2. **analysis.json** — the analysis report in `~/.openweb/compile/<site>/`
3. **Target intents in DOC.md** — the checklist with coverage status

The compile agent takes over from here. It will review the analysis, curate operations, generate specs, and verify correctness. See `references/compile.md`.

## Incremental Discovery (Existing Sites)

When expanding an existing site package, start from gap review:

1. Read the site's DOC.md and openapi.yaml — what's already covered?
2. Identify missing intents (user request or archetype comparison)
3. Enter the loop at **Step 2** with targeted capture for the gaps
4. After compile produces analysis.json, verify the new intents are covered
5. Hand off to compile agent for curation and merge into existing spec
6. Update DOC.md and PROGRESS.md with the expansion

## Outputs

- Capture directory with raw traffic data
- `analysis.json` in `~/.openweb/compile/<site>/`
- Updated DOC.md with target-intent coverage checklist

## Multi-Worker Browser Sharing

Multiple workers can share one Chrome browser on the same CDP port. Rules:
- **Open a new tab** for your site. Do NOT close other tabs or navigate existing tabs to a different URL.
- **Caveat: capture is browser-context-wide**, not per-tab. All traffic from all tabs is recorded in a single capture session. `compile` filters by site URL, so different-site captures don't interfere, but same-site captures from multiple tabs will merge.
- For **true isolation** (same site, parallel workers), use **separate browser instances** on different CDP ports, or capture sequentially.
- If `capture start` is already running (started by another worker), skip it — your traffic is already being recorded. Just browse your site in a new tab.
- Only need separate CDP ports if you need isolated browser profiles or same-site parallel capture.

## Related References

- `references/compile.md` — correctness review after handoff
- `references/site-doc.md` — DOC.md / PROGRESS.md template
- `references/update-knowledge.md` — when to write cross-site patterns
- `references/knowledge/archetypes/index.md` — site type expectations
- `references/knowledge/auth-patterns.md` — auth primitive detection
- `references/knowledge/bot-detection-patterns.md` — anti-bot measures
