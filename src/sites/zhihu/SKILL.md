# Zhihu (知乎)

## Overview
Chinese Q&A knowledge-sharing platform (Quora archetype). Users ask questions, write answers, publish articles, and follow topics.

## Workflows

### Discover answers by search
1. `searchContent(q)` → `data[].object.author.url_token`
2. `getMember(url_token)` → author profile
3. `getUserAnswers(url_token)` → user's answers

### Explore a user's network
1. `getMember(url_token)` → profile with `url_token`
2. `listMemberMutuals(url_token)` → mutual followers with `url_token`
3. `listMemberActivities(url_token)` → recent activity

### Find related content
1. `searchContent(q)` → `data[].object.question.id`
2. `listSimilarQuestions(id)` → related questions
3. `listQuestionFollowers(id)` → users following the question

### Upvote an answer
1. `searchContent(q)` → `data[].object.id` → `answer_id`
2. `upvoteAnswer(answer_id)`

### Follow a user
1. `searchContent(q)` → `data[].object.author.url_token`
2. `getMember(url_token)` → confirm user → `url_token`
3. `followUser(url_token)`

### Follow a question
1. `searchContent(q)` → `data[].object.question.id` → `question_id`
2. `followQuestion(question_id)`

### Undo engagement
1. `cancelUpvote(answer_id)` — reverse of `upvoteAnswer`
2. `unfollowUser(url_token)` — reverse of `followUser`
3. `unfollowQuestion(question_id)` — reverse of `followQuestion`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| **searchContent** | Search questions/answers/articles | `q` | data[].object.{id, question, author, excerpt} | Entry point |
| **getHotSearch** | Trending search terms | — | hot_search_queries[].{query, hot_show} | Entry point |
| **getFeedRecommend** | Personalized homepage feed | — | data[].target.{question, author, voteup_count} | Entry point |
| **getMe** | Current user info | — | id, name, follower_count, answer_count | Entry point |
| **getMember** | User profile details | `url_token` ← searchContent author | name, headline, follower_count, answer_count | pass `include` for full fields |
| **getUserAnswers** | List user's answers | `url_token` ← getMember | data[].{question, voteup_count, content, excerpt} |
| **listMemberActivities** | User's recent activity | `url_token` ← getMember | data[].{verb, target.{title, author}} |
| **listMemberMutuals** | Mutual followers | `url_token` ← getMember | data[].{name, url_token, answer_count} |
| **listQuestionFollowers** | Users following a question | `id` ← searchContent question | data[].{name, url_token, headline} |
| **listSimilarQuestions** | Related questions | `id` ← searchContent question | data[].{title, answer_count, follower_count} |
| **getEntityWord** | Answer annotations | `token` (answer ID) | search_words[].{name, link, entity_class} |
| **upvoteAnswer** | Upvote an answer | `answer_id` ← searchContent | voting status | write/caution |
| **followUser** | Follow a user | `url_token` ← getMember | is_following | write/caution |
| **followQuestion** | Follow a question | `question_id` ← searchContent | is_following | write/caution |
| **cancelUpvote** | Cancel an upvote | `answer_id` ← searchContent | voting, voteup_count | write/caution, adapter |
| **unfollowUser** | Unfollow a user | `url_token` ← getMember | follower_count | write/caution |
| **unfollowQuestion** | Unfollow a question | `question_id` ← searchContent | (empty, 204) | write/caution |

## Quick Start

```bash
# Search questions and answers
openweb zhihu exec searchContent '{"q": "人工智能"}'

# Get trending hot search terms
openweb zhihu exec getHotSearch '{}'

# Get user profile (url_token from search results)
openweb zhihu exec getMember '{"url_token": "excited-vczh"}'

# List user's answers
openweb zhihu exec getUserAnswers '{"url_token": "excited-vczh"}'

# Get recommended feed
openweb zhihu exec getFeedRecommend '{}'

# Get current user info
openweb zhihu exec getMe '{}'
```
