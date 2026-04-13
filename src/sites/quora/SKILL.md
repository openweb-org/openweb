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
