# Discovery Process

How to add a new site to openweb when no fixture exists.

## When to Use

- User asks about a site with no fixture
- Agent proactively expanding coverage

## Before You Start

- Read `knowledge/archetypes.md` — what type of site is this?
- Read `knowledge/auth-patterns.md` — what auth do you expect?
- **Define target operations**: Think like a real user of this site. What are the 3-5 core things you'd do? Describe them as user intents, not operationId names — the actual API naming comes from what you discover during capture. Examples:
  - E-commerce → search products by keyword; get product detail page; get product reviews
  - Travel → search flights by route and date; get flight offer details/pricing
  - Real estate → search homes by location/filters; get property details; get price/tax history
  - Social → search posts/notes by keyword; get post detail with comments; get user profile
- If the task has `acceptCriteria` with specific operations listed, those are your targets.

## Critical Rule: Browser First, No Direct HTTP

**NEVER use curl, fetch, wget, or any direct HTTP request to probe a site during discovery.** Not even to "check if it works" or "see what the response looks like."

Why: Bot detection systems (PerimeterX, DataDome, Akamai) track IP reputation across all requests. A single curl request registers as non-browser traffic and raises the IP's risk score. Multiple probes escalate to an IP-level block that poisons subsequent browser sessions too — even a real user in a real browser on the same IP will be trapped in unsolvable CAPTCHAs.

**Always start with the managed browser.** If the browser hits a CAPTCHA, that's the time to decide whether to solve it or declare the site blocked. Do not attempt to gather information via direct HTTP first.

## Process

### Step 1: Plan

Think like a user of this site:
- What pages have the data you want?
- What actions would a real user take? (search, browse, click into detail, check status)
- Map out which URLs to visit and what API traffic you expect to see.
- Your target operations from "Before You Start" guide what pages to visit.

### Step 2: Capture

```bash
pnpm --silent dev browser start                                    # ensure managed browser running
pnpm --silent dev capture start --cdp-endpoint http://localhost:9222  # start recording
# Browse systematically to trigger your target operations:
#   - Do a search → triggers search API
#   - Click into a result → triggers detail API
#   - Scroll/paginate → triggers pagination
#   - Check other features (reviews, status, profile)
# Avoid: logout, delete account, billing, irreversible actions
pnpm --silent dev capture stop                                     # stop recording
```

### Step 3: Compile

```bash
pnpm --silent dev compile <site-url> [--capture-dir <dir>] [--probe]
```

Then follow `compile.md` for the curate/review phase. During curation, check: do the compiled operations cover your target intents? If key operations are missing, repeat Step 2 with more targeted browsing.

### Step 4: Verify

Two levels of verification:

**4a. API-level**: Does the operation return 200 with data?
```bash
pnpm --silent dev verify <site>
```
AUTH_FAIL means login needed first. PASS means the API responds — but that's not enough.

**4b. Content-level**: Does the API data match what the user sees, and does it fulfill the target intents?

Browse the site in the browser and compare:
- Do a search on the website → compare the visible results with the API search response. Are the same items present? Are titles, prices, images consistent?
- Open a detail page → compare visible info with the API detail response. Are key fields (name, description, price, reviews count) present and matching?
- If the API returns less data than the page shows, there may be missing endpoints or the page uses SSR/DOM data not captured via API.
- **Check against target intents**: Does each target operation from acceptCriteria actually return useful, actionable data? "search products by keyword" means a user could act on the results — not just get IDs or empty shells.

This is the real verification — a 200 response with garbage data is not a working fixture.

### Step 5: Update Knowledge

→ Read `update-knowledge.md` — evaluate what you learned, write to `knowledge/` if novel.

## Limitations

- Browser/capture orchestration is singleton — one capture session at a time
- Multiple workers need separate CDP ports (`--port 9223`, etc.)
