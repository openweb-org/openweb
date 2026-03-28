# x (Twitter)

Social media and microblogging platform.

## Auth & Transport

- **Transport:** node
- **Auth:** cookie_session
- **CSRF:** cookie_to_header (`ct0` → `x-csrf-token`)

## Quick Start

```bash
# Get home timeline
openweb x exec getHomeTimeline

# Search tweets
openweb x exec searchTweets '{"rawQuery": "AI news", "count": 20}'

# Get user by screen name
openweb x exec getUserByScreenName '{"screen_name": "elonmusk"}'

# Get a user's tweets
openweb x exec getUserTweets '{"userId": "44196397", "count": 20}'

# Like a tweet
openweb x exec likeTweet '{"tweet_id": "1234567890"}'
```

## Operations (12)

| Operation | Description | Permission |
|-----------|-------------|------------|
| getHomeTimeline | Get home timeline tweets | read |
| searchTweets | Search tweets by keyword | read |
| getUserByScreenName | Get user profile by screen name | read |
| getUserTweets | Get tweets by a specific user | read |
| getFollowingList | Get following list | read |
| getAccountLists | Get Twitter lists | read |
| getAccountSettings | Get account settings | read |
| getHashflags | Get hashflags (special hashtag icons) | read |
| getPinnedTimelines | Get pinned timelines | read |
| getProfileSpotlights | Get profile spotlight data | read |
| getExploreSidebar | Get explore sidebar content | read |
| likeTweet | Like a tweet | write |
