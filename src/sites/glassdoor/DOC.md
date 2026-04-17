# Glassdoor

## Overview
Glassdoor is a company review and job research platform (archetype: job boards). All data accessed via browser-based adapter with Cloudflare challenge bypass; no official API.

## Workflows

### Research a company
1. `searchCompanies(query)` → company list with employer IDs and ratings
2. `getReviews(employerId)` → employee reviews with pros, cons, ratings
3. `getSalaries(employerId)` → salary data by job title with pay ranges
4. `getInterviews(employerId)` → interview experiences with difficulty and outcomes

### Compare company compensation
1. `searchCompanies(query)` → get employerId for company A
2. `getSalaries(employerId)` → salary ranges for company A
3. Repeat for company B

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchCompanies | find companies by name | query | employerId, name, overallRating | entry point |
| getReviews | employee reviews | employerId ← searchCompanies | rating, title, pros, cons, jobTitle | SSR + DOM |
| getSalaries | salary data by role | employerId ← searchCompanies | jobTitle, payRange, salaryCount | DOM extraction |
| getInterviews | interview experiences | employerId ← searchCompanies | role, difficulty, experience, description | DOM extraction |

## Quick Start

```bash
openweb glassdoor exec searchCompanies '{"query":"Google"}'
openweb glassdoor exec getReviews '{"employerId":9079}'
openweb glassdoor exec getSalaries '{"employerId":9079}'
openweb glassdoor exec getInterviews '{"employerId":9079}'
```

---

## Site Internals

### API Architecture
- **Company explorer** (searchCompanies): Next.js SSR with `__NEXT_DATA__` Apollo cache containing `Employer:*` entities with ratings (Tier 3)
- **Reviews** (getReviews): Page navigate → extract review IDs from `data-brandviews` attribute on `article[data-test="review-detail"]` → `page.evaluate(fetch)` to `/graph` GraphQL endpoint per review ID → structured data (Tier 5 hybrid)
- **Salaries** (getSalaries): Server-rendered React — DOM extraction via salary links and text parsing (Tier 2)
- **Interviews** (getInterviews): Response interception of `EmployerInterviewInfoIG` GraphQL calls during page navigation → structured description and jobTitle (Tier 4+5 hybrid)
- **GraphQL `/graph` endpoint**: POST with `gd-csrf-token: 1` header, `credentials: include`. Introspection disabled. Only pre-defined operation shapes succeed — custom queries return "Server error".

### GraphQL Operations Discovered
- `EmployerReview` via `employerReviewRG`: fetches review by `reviewId` — returns `reviewId`, `reviewDateTime`, `ratingOverall`, `summary`, `pros`, `cons`, `jobTitle.text`, `employer.id/shortName`
- `EmployerInterviewInfoIG`: fetches interview by `{id}` — returns `processDescription`, `jobTitle.text`, `employer.id/shortName`
- `RecordPageView` (mutation, analytics only — not used)

### Auth
- No auth required for public company data
- `requires_auth: false`
- GraphQL uses `gd-csrf-token: 1` header (static value, not a real CSRF token)

### Transport
- **searchCompanies: page** (Tier 3 — SSR/NEXT_DATA extraction)
- **getReviews: page** (Tier 5 — page navigate + GraphQL `page.evaluate(fetch)`)
- **getSalaries: page** (Tier 2 — DOM extraction)
- **getInterviews: page** (Tier 4+5 — response interception of GraphQL during navigation)
- Cloudflare Turnstile challenge blocks direct HTTP — all operations require browser context
- Challenge typically resolves in 2-4 seconds via managed browser

### Adapter Patterns
- `adapters/glassdoor.ts` exports a `CustomRunner` (`run(ctx)`) using shared types (`CustomRunner`, `PreparedContext`, `AdapterHelpers`) — the local `CodeAdapter` shim was removed
- **Cloudflare wait loop in `run()` preamble**: `isCloudflareBlocked` + `waitForCloudflare` execute as a pre-dispatch CF gate before every op; on timeout it raises `errors.botBlocked(...)` (replacing the prior ad-hoc `failureClass:'bot_blocked'` assignment)
- Missing params surface via `errors.missingParam(...)` instead of bare `throw new Error('X is required')`
- No `init()` or `isAuthenticated()` — both were trivial/no-op and dropped during the CustomRunner migration

### Bot Detection
- **Cloudflare Turnstile** — "Just a moment..." challenge page
- No persistent session cookies required — challenge passes per-request
- Headed browser recommended for reliability

### Known Issues
- Cloudflare Turnstile may require manual CAPTCHA solve under aggressive blocking — restart browser with `--no-headless` if stuck (the CF wait loop in the adapter `run()` preamble polls until the challenge clears or raises `errors.botBlocked` on timeout)
- GraphQL introspection disabled — only pre-defined query shapes work; custom field additions fail with "Server error"
- Interview DOM metadata (date, location, difficulty, experience, offerStatus) extraction is unreliable due to page structure changes — GraphQL provides clean description and jobTitle
- Salary `payRange` format varies (hourly vs annual) and may return null if the page layout changes
- No GraphQL endpoint discovered for salary data — salaries remain on DOM extraction
