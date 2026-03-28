# zhihu

Chinese Q&A platform (similar to Quora).

## Auth & Transport

- **Transport:** node
- **Auth:** cookie_session
- **CSRF:** cookie_to_header (`_xsrf` → `x-xsrftoken`)

## Quick Start

```bash
# Get trending searches
openweb zhihu exec getHotSearch

# Search content
openweb zhihu exec search '{"q": "人工智能"}'

# Get recommended feed
openweb zhihu exec getRecommendFeed

# Get current user profile
openweb zhihu exec getMe

# Get answers to a question
openweb zhihu exec getQuestionAnswers '{"id": "12345678"}'
```

## Operations (17)

| Operation | Description | Permission |
|-----------|-------------|------------|
| getMe | Get current user profile | read |
| getRecommendFeed | Get recommended feed | read |
| search | Search content | read |
| getHotSearch | Get trending searches | read |
| getAnswer | Get a specific answer | read |
| getQuestionAnswers | Get answers to a question | read |
| getQuestionFollowers | Get question followers | read |
| getSimilarQuestions | Get similar questions | read |
| getMemberProfile | Get member profile by username | read |
| getMemberMutualFollowers | Get mutual followers | read |
| getAnswerFavorites | Get answer favorites | read |
| getAnswerRelationship | Get user relationship to answer | read |
| getTopicQuestionRelation | Get topic-question relation | read |
| getTopicRelatedQuestions | Get topic-related questions | read |
| getEntityWord | Get entity word info | read |
| getHomeSidebar | Get home sidebar content | read |
| voteAnswer | Vote on an answer | write |
