# Product Hunt

## Overview
Product discovery platform — daily curated tech products, tools, and startups with community voting.

## Workflows

### Browse today's featured products
1. `getToday` → `name`, `tagline`, `votesCount`, `dailyRank`, `slug`

### Search and explore products
1. `searchProducts(query)` → `slug`, `name`, `reviewsRating`
2. `getPost(slug)` → `description`, `makers`, `categories`, `votesCount`

### Browse posts by time section
1. `getPosts(section)` → `slug`, `name`, `tagline`, `votesCount`, `dailyRank`
2. `getPost(slug)` → `description`, `makers`, `categories`

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getToday | today's featured products | — | name, tagline, slug, votesCount, dailyRank, topics | entry point |
| getPosts | featured posts by section | section? (TODAY default) | name, tagline, slug, votesCount, dailyRank | entry point, supports YESTERDAY/LAST_WEEK/LAST_MONTH |
| getPost | product details | slug ← getToday/getPosts/searchProducts | name, description, votesCount, makers, categories | |
| searchProducts | find products by keyword | query | name, tagline, slug, reviewsRating | entry point |

## Quick Start

```bash
# Today's featured products
openweb producthunt exec getToday '{}'

# Yesterday's top products
openweb producthunt exec getPosts '{"section": "YESTERDAY"}'

# Search for products
openweb producthunt exec searchProducts '{"query": "ai"}'

# Get a specific product's details
openweb producthunt exec getPost '{"slug": "novavoice"}'
```
