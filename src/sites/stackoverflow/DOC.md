# Stack Overflow

## Overview
Stack Overflow — Q&A platform for developers. Uses Stack Exchange API v2.3.

## Operations
| Operation | Intent | Method | Notes |
|-----------|--------|--------|-------|
| searchQuestions | search questions by title | GET /search?intitle=&site=stackoverflow | paginated, sortable by activity/votes/relevance |
| getQuestionAnswers | answers for question(s) | GET /questions/{ids}/answers?site=stackoverflow | semicolon-separated IDs, includes answer body |

## API Architecture
- Stack Exchange REST API v2.3 at `api.stackexchange.com/2.3`
- `site=stackoverflow` required on every request
- Responses include `quota_remaining` and `has_more` for pagination
- Responses are gzip-compressed by default

## Auth
- None required for read operations (anonymous quota applies)

## Transport
- `node` — direct HTTP

## Known Issues
- Anonymous API quota: 300 requests/day per IP
