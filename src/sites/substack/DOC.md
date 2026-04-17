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

### Discover trending content
1. `getTrending(limit)` → popular posts across Substack

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPosts | find posts by keyword | query | title, slug, publication.subdomain, post_date | entry point; cross-publication |
| getArchive | list/search posts in a publication | subdomain ← searchPosts | id, title, slug, post_date, audience | paginated (offset, limit) |
| getPost | read full article | subdomain, slug ← getArchive | title, body_html, word_count, reaction_count | slug from archive or search |
| getPostComments | read discussion | subdomain, postId ← getArchive | body, name, date, reaction_count, children | nested replies via children |
| getTrending | discover popular posts | limit | title, slug, post_date | entry point; cross-publication |

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

# See what's trending
openweb substack exec getTrending '{"limit":10}'
```

---

## Site Internals

## API Architecture
REST API at `/api/v1/*` on each publication's domain. Main site (`substack.com`)
hosts search and trending. Each publication lives on `{subdomain}.substack.com`
(or a custom domain that redirects).

## Auth
No auth required for public read operations. Paywalled posts return truncated
`body_html`. Login required only for subscriber-only content.

## Transport
`page` — pure spec, no adapter. Per-publication ops (getArchive, getPost,
getPostComments) use operation-level `servers: - url: https://{subdomain}.substack.com`
with the `subdomain` param consumed as a server variable. The runtime acquires a
page on the resolved subdomain, then `page.evaluate(fetch())` runs same-origin.
searchPosts and getTrending stay on the default `substack.com` server.

## Known Issues
- `searchPosts` returns empty results in headless browser context — likely bot detection on the search endpoint. Use `getArchive` with `search` param as a workaround for per-publication search.
- `/api/v1/publication` returns 403 on some publications (not available for all pubs).
- Custom domain publications (e.g., platformer.news) redirect from `*.substack.com`.
  The adapter uses `{subdomain}.substack.com` which follows redirects automatically.
- Paywalled posts (`audience: "only_paid"`) have truncated content in `body_html`.
