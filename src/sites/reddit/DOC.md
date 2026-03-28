# reddit

Social news aggregation and discussion platform.

## Auth & Transport

- **Transport:** node
- **Auth:** localStorage_jwt (chat:access-token)
- **CSRF:** None (removed — auto-detected `loid`/`x-reddit-loid` was a tracking cookie, not CSRF)

## Known Issues

- Reddit uses shreddit (server-rendered HTML partials) for most endpoints — only the GraphQL endpoint returns structured JSON.
- The package is thin (3 HTTP ops) because most captured traffic was internal framework partials.
- WebSocket operations connect to `gql-realtime.reddit.com` for real-time subscriptions.

## Quick Start

```bash
# Search Reddit
openweb reddit exec search '{"q": "javascript", "type": "link"}'

# Get subreddit posts (paginated)
openweb reddit exec getSubredditPosts '{"name": "programming", "after": "", "feedLength": 10}'

# Execute a GraphQL query
openweb reddit exec graphqlQuery
```

## Operations (3 HTTP + 7 WS)

| Operation | Description | Permission |
|-----------|-------------|------------|
| search | Search Reddit posts and comments | read |
| getSubredditPosts | Get subreddit posts (paginated) | read |
| graphqlQuery | Execute a Reddit GraphQL query | write |
