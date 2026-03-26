# Discovery Process

How to add a new site or expand an existing site's operation coverage.

## When to Use

- User asks about a site with no site package
- Expanding coverage for an existing site (more operations, new protocols)
- Site package is stale or has auth/transport issues

## Before You Start

- Read `references/knowledge/archetypes/index.md` — what type of site is this?
  Archetypes are heuristic starting points, not limiting checklists.
  Define targets based on user needs and actual site capabilities.
- Read `references/knowledge/auth-patterns.md` — what auth do you expect?
- If the site already has a package, read its DOC.md and openapi.yaml
  to understand current coverage before capturing more

## Critical Rule: Browser First, No Direct HTTP

**NEVER use curl, fetch, wget, or any direct HTTP request to probe a site during discovery.** Not even to "check if it works" or "see what the response looks like."

Why: Bot detection systems (PerimeterX, DataDome, Akamai) track IP reputation across all requests. A single curl request registers as non-browser traffic and raises the IP's risk score. Multiple probes escalate to an IP-level block that poisons subsequent browser sessions too — even a real user in a real browser on the same IP will be trapped in unsolvable CAPTCHAs.

**Always start with the managed browser.** If the browser hits a CAPTCHA, that's the time to decide whether to solve it or declare the site blocked. Do not attempt to gather information via direct HTTP first.

## Write Operation Safety

When discovering write operations (POST/PUT/PATCH/DELETE), capture the traffic but be cautious about verification:

When documenting write operations in DOC.md, mark each with a safety level: ✅ SAFE (reversible), ⚠️ CAUTION (manageable impact), 🚫 NEVER (irreversible/costly).

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
  ┌─────────────────────────────────────────────────────┐
  │  Step 1: Frame target intents                       │
  └──────────────┬──────────────────────────────────────┘
                 ▼
  ┌─────────────────────────────────────────────────────┐
  │  Step 2: Capture  ◄──────────────────────┐          │
  └──────────────┬───────────────────────────│──────────┘
                 ▼                           │
  ┌─────────────────────────────────────────────────────┐
  │  Step 3: Inspect — verify intent coverage │          │
  └──────────────┬───────────────────────────│──────────┘
                 ▼                           │
  ┌─────────────────────────────────────────────────────┐
  │  Step 4: Fill gaps ──── missing intents? ┘          │
  └──────────────┬──────────────────────────────────────┘
                 ▼
  ┌─────────────────────────────────────────────────────┐
  │  Step 5: Compile + check compile-report             │
  └──────────────┬──────────────────────────────────────┘
                 ▼
  ┌─────────────────────────────────────────────────────┐
  │  Step 6: Gap review — map ops to intents  ◄──┐      │
  │           check filtered.json                 │      │
  └──────────────┬────────────────────────────────│─────┘
                 │  gaps remain?                  │
                 │  filtered → fix filter, recompile
                 │  not captured → back to Step 2 ┘
                 ▼
  ┌─────────────────────────────────────────────────────┐
  │  Step 7: Verify                                     │
  └──────────────┬──────────────────────────────────────┘
                 ▼
  ┌─────────────────────────────────────────────────────┐
  │  Step 8: Write artifacts (DOC.md, PROGRESS.md)      │
  └─────────────────────────────────────────────────────┘
```

### Step 1: Frame the Target

- Identify the site archetype (read the relevant section in archetypes)
- Define 3–5 target intents described as **user actions**, not API names
  (Based on user needs and actual site capabilities, not copied from archetype templates)
- Create or update DOC.md with an initial overview and target-intent checklist
  (Following the `references/site-doc.md` template)
- If specific operations are requested, those are your targets

**Examples of good target intents:**
- E-commerce → search products by keyword; get product detail; get reviews
- Travel → search flights by route and date; get pricing details
- Social → search posts by keyword; get post detail with comments; get user profile

### Step 2: Capture

```bash
openweb browser start
openweb capture start --cdp-endpoint http://localhost:9222
# Browse systematically to trigger target operations:
#   - Do a search → triggers search API
#   - Click into a result → triggers detail API
#   - Scroll/paginate → triggers pagination
#   - Check other features (reviews, status, profile)
# Avoid: logout, delete account, billing, irreversible actions
openweb capture stop
```

### Step 3: Inspect What Was Recorded

This is a first-class step — not just counting requests.

- Check capture summary: how many requests? Which domains? Any WS frames?
- **Map each target intent to recorded traffic:**
  Did the target API fire? Was the data source found?
- If SPA: check whether data comes from API calls or SSR-embedded data
- Check whether the correct page/tab was recorded
- Mark missing target intents in DOC.md

### Step 4: Fill Gaps (iterate with Steps 2–3)

If target operations are missing:
- Read page DOM (`page.evaluate`) to look for SSR data (`__NEXT_DATA__`, embedded JSON)
- Check whether data loads via fetch/XHR or is in the initial HTML
- Try different user actions (different search terms, scroll for lazy loading, click different detail pages)
- Check whether the site uses GraphQL (single endpoint, query in POST body)
- If login is required: `openweb login <site>`, restart browser, re-capture
- Re-capture with more targeted browsing

**Repeat Steps 2–4 until every target intent has at least one credible data source**
(API call, SSR data, or DOM data).

### Step 5: Compile and Check Report

```bash
openweb compile <site-url> [--capture-dir <dir>] [--probe]
```

After compile completes, check the compile-report:
- Read `~/.openweb/compile/<site>/summary.txt` — is operationCount reasonable?
- If a target intent is missing → read `filtered.json` to determine cause:
  - **In rejected list** → filter false positive, no need to re-capture
  - **Not present** → genuinely not recorded, go back to Step 2

Then follow `references/compile.md` for curation. During curation:
- Map generated operations back to target intents in DOC.md
- Update DOC.md with auth, transport, extraction, and known issues

### Step 6: Gap Review

Mark each target intent in DOC.md:
- Covered by a compiled operation
- Covered only via DOM/SSR extraction (needs adapter)
- Still missing

If important gaps remain → return to Step 2 for targeted browsing.

### Step 7: Verify

Two levels of verification:

**7a. API-level**: Does the operation return 200 with data?
```bash
openweb verify <site>
```
AUTH_FAIL means login needed first. PASS means the API responds — but that's not enough.

**7b. Content-level**: Does the API data match what the user sees?

Browse the site in the browser and compare:
- Do a search on the website → compare visible results with API response
- Open a detail page → compare visible info with API detail response
- If the API returns less data than the page shows, there may be missing endpoints or SSR data not captured via API
- **Check against target intents**: Does each operation return useful, actionable data?

A 200 response with garbage data is not a working site package.

### Step 8: Write Artifacts

- Finalize DOC.md (per `references/site-doc.md`)
- Append first PROGRESS.md entry
- Update cross-site knowledge only when the experience generalizes
  (per `references/update-knowledge.md`)

## Incremental Discovery (Existing Sites)

When expanding an existing site package, start from gap review:

1. Read the site's DOC.md and openapi.yaml — what's already covered?
2. Identify missing intents (user request or archetype comparison)
3. Enter the loop at **Step 2** with targeted capture for the gaps
4. After compile, merge new operations into the existing spec
5. Update DOC.md and PROGRESS.md with the expansion

## Outputs

- Site package: `openapi.yaml` (+ `asyncapi.yaml` if WS traffic present)
- `DOC.md` in site package directory
- `PROGRESS.md` in site package directory
- Knowledge updates (if pattern generalizes)

## Multi-Worker Browser Sharing

Multiple workers can share one Chrome browser on the same CDP port. Rules:
- **Open a new tab** for your site. Do NOT close other tabs or navigate existing tabs to a different URL.
- **Caveat: capture is browser-context-wide**, not per-tab. All traffic from all tabs is recorded in a single capture session. `compile` filters by site URL, so different-site captures don't interfere, but same-site captures from multiple tabs will merge.
- For **true isolation** (same site, parallel workers), use **separate browser instances** on different CDP ports, or capture sequentially.
- If `capture start` is already running (started by another worker), skip it — your traffic is already being recorded. Just browse your site in a new tab.
- Only need separate CDP ports if you need isolated browser profiles or same-site parallel capture.

## Related References

- `references/compile.md` — correctness review after compile
- `references/site-doc.md` — DOC.md / PROGRESS.md template
- `references/update-knowledge.md` — when to write cross-site patterns
- `references/knowledge/archetypes/index.md` — site type expectations
- `references/knowledge/auth-patterns.md` — auth primitive detection
