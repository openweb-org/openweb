# Quora

## Overview
Q&A platform — users ask questions, write answers, follow topics and users.

## Workflows

### Search and read answers
1. `searchQuestions(query)` → pick question → `slug`
2. `getQuestion(slug)` → question detail with top answer previews
3. `getAnswers(slug)` → full answer text for the question

### Look up a user
1. `getProfile(username)` → name, bio, followers, answer count, expertise topics

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchQuestions | find questions | query (keyword) | qid, slug, title, answerCount | entry point |
| getQuestion | question detail | slug ← searchQuestions | title, answerCount, topics, topAnswers | includes top 3 answer previews |
| getAnswers | read all answers | slug ← searchQuestions | author, content, upvotes, views, createdAt | GQL intercept with DOM fallback |
| getProfile | user profile | username | name, bio, followers, answers | username from profile URL slug |

## Quick Start

```bash
# Search for questions about a topic
openweb quora exec searchQuestions '{"query": "machine learning"}'

# Get question details
openweb quora exec getQuestion '{"slug": "What-is-JavaScript"}'

# Get answers for a question
openweb quora exec getAnswers '{"slug": "What-is-JavaScript"}'

# Get a user profile
openweb quora exec getProfile '{"username": "Adam-DAngelo"}'
```

---

## Site Internals

### API Architecture
- GraphQL API at `https://www.quora.com/graphql/gql_para_POST` with persisted query hashes
- Persisted queries use `extensions.hash` (deployment-scoped, rotate on deploys)
- Page-scoped `quora-formkey` header acts as CSRF token (extracted from script tags)
- Initial page data delivered via SSR; GraphQL used for pagination/dynamic content
- GQL responses use multipart format (`--qgqlmpb` boundary)

### Auth
- No auth required for public reads
- Session cookies: `m-b`, `m-s`, `m-login`, `m-lat`, `m-uid`
- `quora-formkey` embedded in script tags (page-scoped, cannot replay from Node)

### Transport
- **page** transport with adapter — formkey is page-scoped, direct GraphQL replay returns null data
- **getQuestion / getAnswers**: Tier 4 (GQL intercept) — intercepts `QuestionPagedListPaginationQuery` response during page navigation for structured data (author, upvotes, views, timestamps). Falls back to Tier 5 (page.evaluate(fetch)) for pagination using captured hash + formkey. DOM extraction (Tier 2) as final fallback when GQL pagination query doesn't fire (questions with few answers).
- **searchQuestions**: Tier 2 (DOM extraction) — search results are SSR-rendered; no separate GQL query exists for search. A fresh page is opened to avoid stale state from the warm-up page.
- **getProfile**: Tier 2 (DOM extraction) — no GQL profile query available; profile data only in DOM.

### GQL Query Discovery
- `QuestionPagedListPaginationQuery` — returns paginated answers with structured data: `answer.content` (JSON rich text), `answer.author.names[]`, `answer.numUpvotes`, `answer.numViews`, `answer.creationTime`, `answer.authorCredential`
- Relay-style node IDs: `base64("Question@0:{qid}")` — qid extracted from GQL response
- Hash extracted from intercepted requests; used for Tier 5 pagination calls
- Search page: only `facebookAutoLogin_Query` (not useful); search data is SSR
- Profile page: only `UserProfileSpacesSection_Paging_Query` (spaces, not profile data)

### Known Issues
- No bot detection observed (no Akamai/DataDome/PerimeterX cookies)
- Quora content fields are JSON-encoded rich text (`{"sections":[{"spans":[{"text":"..."}]}]}`) — adapter parses to plain text
- GQL pagination query only fires for questions with enough answers to paginate; fewer-answer questions fall back to DOM extraction
- DOM-extracted answer counts may be inaccurate (regex matches noise in page text)
- DOM selectors may change on frontend deploys
