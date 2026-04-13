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
