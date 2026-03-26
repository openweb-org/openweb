# Stack Overflow

## Overview
Stack Overflow — Q&A platform for developers. Uses Stack Exchange API v2.3.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchQuestions | search questions by title | GET /search?intitle=&site=stackoverflow | paginated, sortable by activity/votes/relevance |
| searchAdvanced | advanced search with tag filters and body text | GET /search/advanced?q=&tagged=&site=stackoverflow | supports tag inclusion/exclusion, min answers, accepted filter |
| getQuestionDetail | get full question with body | GET /questions/{ids}?filter=withbody&site=stackoverflow | returns HTML body, view count, accepted answer ID |
| getQuestionAnswers | answers for question(s) | GET /questions/{ids}/answers?site=stackoverflow | semicolon-separated IDs, includes answer body |
| getQuestionComments | comments on question(s) | GET /questions/{ids}/comments?site=stackoverflow | sortable by creation/votes |
| getRelatedQuestions | questions related to a given question | GET /questions/{ids}/related?site=stackoverflow | paginated, sorted by activity/votes/relevance |
| getAnswerDetail | get specific answers by ID with body | GET /answers/{ids}?filter=withbody&site=stackoverflow | returns HTML body, score, accepted status |
| getUserProfile | get user profile with reputation and stats | GET /users/{ids}?site=stackoverflow | badge counts, answer/question counts |
| getPopularTags | browse popular/trending tags | GET /tags?sort=popular&site=stackoverflow | filterable by name substring |
| getTagWiki | get tag wiki excerpt and description | GET /tags/{tags}/wikis?site=stackoverflow | tag usage guidance |

## API Architecture
- Stack Exchange REST API v2.3 at `api.stackexchange.com/2.3`
- `site=stackoverflow` required on every request
- `filter=withbody` needed on detail endpoints to get HTML body content
- Responses include `quota_remaining` and `has_more` for pagination
- Responses are gzip-compressed by default
- Semicolon-separated IDs for batch requests (e.g., `14220321;750486`)

## Auth
- None required for read operations (anonymous quota applies)

## Transport
- `node` — direct HTTP (API is public, no bot detection)

## Known Issues
- Anonymous API quota: 300 requests/day per IP
- The `filter=withbody` parameter uses a named filter; custom filters require API key registration
