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
| getAnswers | read all answers | slug ← searchQuestions | author, content, upvotes | up to 20 answers per page |
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
- Page-scoped `quora-formkey` header acts as CSRF token
- Initial page data delivered via SSR; GraphQL used for pagination/dynamic content

### Auth
- No auth required for public reads
- Session cookies: `m-b`, `m-s`, `m-login`, `m-lat`, `m-uid`
- `quora-formkey` embedded in `window.ansFrontendGlobals` (page-scoped, cannot replay from Node)

### Transport
- **page** transport with adapter — formkey is page-scoped, direct GraphQL replay returns null data
- Search: DOM extraction on a fresh page (Quora SSR-renders search results; no separate GQL query). A new page is opened to avoid stale state from the warm-up page.
- Question/answers/profile: DOM extraction from navigated pages

### Extraction
- Search results: DOM extraction from SSR-rendered search page (question links, titles, answer counts)
- Question detail: DOM extraction (title, stats, topic links, top answer previews)
- Answers: DOM extraction via `.q-box.spacing_log_answer_content` selectors
- Profile: DOM extraction (stats parsed from body text, bio from `.q-text.qu-wordBreak--break-word`)

### Known Issues
- No bot detection observed (no Akamai/DataDome/PerimeterX cookies)
- Quora title field is JSON-encoded rich text (`{"sections":[{"spans":[{"text":"..."}]}]}`) — adapter parses this to plain text
- Answer count on question pages may reflect promoted/collapsed answers differently
- DOM selectors may change on frontend deploys
