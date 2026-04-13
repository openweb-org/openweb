# Zhihu (知乎)

## Overview
Chinese Q&A knowledge-sharing platform (Quora archetype). Users ask questions, write answers, publish articles, and follow topics.

## Workflows

**Discover answers by search:**
`searchContent` → `getMember` (author url_token from results) → `getUserAnswers`

**Explore a user's network:**
`getMember` → `listMemberMutuals` → `listMemberActivities`

**Find related content:**
`searchContent` → `listSimilarQuestions` (question ID from results) → `listQuestionFollowers`

**Engage with content (write):**
`searchContent` → `upvoteAnswer` (answer ID from results)
`getMember` → `followUser` (url_token from profile)
`searchContent` → `followQuestion` (question ID from results)

**Undo engagement (reverse write):**
`cancelUpvote` — cancel a previous upvote (adapter-dispatched POST with type=neutral)
`unfollowUser` — unfollow a previously followed user
`unfollowQuestion` — stop following a question (returns 204)

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
