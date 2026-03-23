# Discovery Process

How to add a new site to openweb when no fixture exists.

## When to Use

- User asks about a site with no fixture
- Agent proactively expanding coverage

## Before You Start

- Read `knowledge/archetypes.md` — what type of site is this?
- Read `knowledge/auth-patterns.md` — what auth do you expect?
- **Define target operations**: Think like a real user. What are the 3-5 core things you'd do on this site? These become your discovery goals and acceptance criteria. Examples:
  - E-commerce → searchProducts, getProductDetails, getProductReviews
  - Travel → searchFlights, getFlightDetails, getFlightStatus
  - Real estate → searchHomes, getPropertyDetails, getPriceHistory
  - Social → searchPosts, getPostDetails, getUserProfile
- If the task has `acceptCriteria` with specific operations listed, those are your targets.

## Process

### Step 1: Plan

Think like a user of this site. What pages have the data? What actions matter?
Map out which URLs to visit and what API traffic you expect.

### Step 2: Capture

```bash
pnpm --silent dev browser start                                    # ensure managed browser running
pnpm --silent dev capture start --cdp-endpoint http://localhost:9222  # start recording
# Browse systematically: navigate pages, search, open details, check profile
# Avoid: logout, delete account, billing, irreversible actions
pnpm --silent dev capture stop                                     # stop recording
```

### Step 3: Compile

```bash
pnpm --silent dev compile <site-url> [--capture-dir <dir>] [--probe]
```

Then follow `compile.md` for the curate/review phase.

### Step 4: Verify

```bash
pnpm --silent dev verify <site>
```

Confirm PASS on key operations. AUTH_FAIL means login needed first.

### Step 5: Update Knowledge

→ Read `update-knowledge.md` — evaluate what you learned, write to `knowledge/` if novel.

## Limitations

- Browser/capture orchestration is singleton in M25 — one capture session at a time
- Sessionized capture is deferred to a later milestone
