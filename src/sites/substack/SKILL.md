# Substack

## Overview
Newsletter and long-form content platform. Content platform archetype.

## Workflows

### Find and read a post
1. `searchPosts(query)` → `slug`, `publication.subdomain`
2. `getPost(subdomain=publication.subdomain, slug)` → full article with `body_html`

### Browse a publication's posts
1. `getArchive(subdomain)` → posts with `id`, `slug`
2. `getPost(subdomain, slug)` → full article with `id`, `title`, `body_html`
3. `getPostComments(subdomain, postId=id)` → discussion with `body`, `name`, `children`

### Search within a publication
1. `getArchive(subdomain, search="keyword")` → filtered posts with `slug`
2. `getPost(subdomain, slug)` → full article

### Discover trending content
1. `getTrending(limit)` → popular posts with `slug`, `canonical_url` (subdomain from URL host)
2. `getPost(subdomain, slug)` → full article with `body_html`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPosts | find posts by keyword | query | title, slug, publication.subdomain, post_date | entry point; cross-publication |
| getArchive | list/search posts in a publication | subdomain ← searchPosts (or known) | id, title, slug, post_date, audience | paginated (offset, limit) |
| getPost | read full article | subdomain, slug ← searchPosts / getArchive | title, body_html, word_count, reaction_count | slug from search or archive |
| getPostComments | read discussion | subdomain, postId ← getArchive / getPost | body, name, date, reaction_count, children | nested replies via children |
| getTrending | discover popular posts | limit | title, slug, post_date, canonical_url | entry point; subdomain from canonical_url |

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
