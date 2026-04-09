# StackOverflow

## Overview
Developer Q&A platform. Public REST API (Stack Exchange API v2.3) for searching questions, reading answers, browsing user profiles, and exploring tags.

## Workflows

### Find answers to a programming question
1. `searchQuestions(q, site)` -> browse results -> note `question_id`
2. `getQuestion(id, site)` -> read question body and metadata
3. `getAnswers(id, site)` -> read answers sorted by votes

### Research a user's expertise
1. From any question/answer `owner.user_id`
2. `getUser(id, site)` -> reputation, badges, profile

### Explore a technology's ecosystem
1. `searchTags(inname, site)` -> find tags and question counts
2. `searchQuestions(q, tagged, site)` -> filter questions by tag

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchQuestions | find questions by keyword | q, site | title, score, answer_count, tags, link | entry point, supports tag filtering |
| getQuestion | question details with body | id <- searchQuestions, site | title, body, score, tags, answer_count | use filter=withbody for body HTML |
| getAnswers | answers for a question | id <- searchQuestions, site | body, score, is_accepted | sorted by votes, use filter=withbody |
| getUser | user profile | id <- owner.user_id, site | reputation, badge_counts, display_name | from question/answer owner |
| searchTags | browse/search tags | inname, site | name, count | sorted by popularity |

## Quick Start

```bash
# Search for questions
openweb stackoverflow exec searchQuestions '{"q": "async await javascript", "site": "stackoverflow"}'

# Get question details
openweb stackoverflow exec getQuestion '{"id": 11227809, "site": "stackoverflow"}'

# Get answers for a question
openweb stackoverflow exec getAnswers '{"id": 11227809, "site": "stackoverflow"}'

# Get user profile
openweb stackoverflow exec getUser '{"id": 22656, "site": "stackoverflow"}'

# Search tags
openweb stackoverflow exec searchTags '{"inname": "javascript", "site": "stackoverflow"}'
```

---

## Site Internals

## API Architecture
- Stack Exchange API v2.3 at `api.stackexchange.com`
- All responses wrapped in `{items: [...], has_more: bool, quota_remaining: int}` — unwrapped via `x-openweb.unwrap: items`
- Responses are gzip-compressed by default
- The `filter` parameter controls returned fields — `withbody` includes HTML body text
- The `site` parameter is required on every call (use `stackoverflow`)

## Auth
No auth required for read operations. Rate limit: 300 requests/day without API key, 10,000/day with key (passed via `key` query parameter).

## Transport
`node` — direct HTTP. No bot detection, no browser needed. Public JSON API.

## Known Issues
- All dates are Unix timestamps (seconds), not ISO 8601
- Body content is HTML — may contain code blocks, links, and formatting
- `site=stackoverflow` is required on every request
- Responses are gzip-compressed; ensure Accept-Encoding header is set
- Without an API key, daily quota is 300 requests — sufficient for moderate use
