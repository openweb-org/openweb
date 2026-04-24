# Substack

## Overview
Newsletter and long-form content platform. Content platform archetype.

## Workflows

### Find and read a post
1. `searchPosts(query)` → results with `slug`, `publication.subdomain`
2. `getPost(subdomain, slug)` → full article with body_html

### Browse a publication's posts
1. `getArchive(subdomain)` → list of posts with `id`, `slug`
2. `getPost(subdomain, slug)` → full article
3. `getPostComments(subdomain, postId)` → discussion

### Search within a publication
1. `getArchive(subdomain, search="keyword")` → filtered posts

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPosts | find posts by keyword | query | title, slug, publication.subdomain, post_date | entry point; cross-publication |
| getArchive | list/search posts in a publication | subdomain ← searchPosts | id, title, slug, post_date, audience | paginated (offset, limit) |
| getPost | read full article | subdomain, slug ← getArchive | title, body_html, word_count, reaction_count | slug from archive or search |
| getPostComments | read discussion | subdomain, postId ← getArchive | body, name, date, reaction_count, children | nested replies via children |

## Quick Start

```bash
# Search for posts about AI
openweb substack exec searchPosts '{"query":"artificial intelligence"}'

# List recent posts from a publication
openweb substack exec getArchive '{"subdomain":"astralcodexten","sort":"new","limit":5}'

# Read a specific post
openweb substack exec getPost '{"subdomain":"astralcodexten","slug":"open-thread-427"}'

# Get comments on a post
openweb substack exec getPostComments '{"subdomain":"astralcodexten","postId":158504113}'
```

---

## Site Internals

## API Architecture
REST API at `/api/v1/*` on each publication's domain. Main site (`substack.com`)
hosts search. Each publication lives on `{subdomain}.substack.com` (or a custom
domain that redirects).

## Auth
No auth required for public read operations. Paywalled posts return truncated
`body_html`. Login required only for subscriber-only content.

## Transport
`node` — TypeScript adapter with `nodeFetch`. The adapter handles URL
construction for each operation: `searchPosts` hits `substack.com/api/v1/top/search`,
while per-publication ops (getArchive, getPost, getPostComments) hit
`{subdomain}.substack.com/api/v1/*`. All responses are trimmed to spec-declared
fields, eliminating ~75% of raw API bloat.

Custom domain redirects (e.g., `astralcodexten.substack.com` →
`www.astralcodexten.com`) are followed automatically by `nodeFetch`.

## Known Issues
- `/api/v1/publication` returns 403 on some publications (not available for all pubs).
- Custom domain publications (e.g., platformer.news) redirect from `*.substack.com`.
  The adapter follows redirects automatically.
- Paywalled posts (`audience: "only_paid"`) have truncated content in `body_html`.
- `getTrending` was removed: the public `/api/v1/trending` endpoint now returns
  HTTP 404 from every host. No documented replacement.
