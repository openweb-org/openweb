# Product Hunt

## Overview
Product discovery platform — daily curated tech products, tools, and startups with community voting.

## Workflows

### Browse today's featured products
1. `getToday` → today's featured products with name, tagline, votes, rank

### Search and explore products
1. `searchProducts(query)` → results with `slug`
2. `getPost(slug)` → full product details, description, makers

### Browse posts by time section
1. `getPosts(section)` → featured posts (TODAY, YESTERDAY, LAST_WEEK, LAST_MONTH)
2. `getPost(slug)` → full details for any post

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| getToday | today's featured products | — | name, tagline, votesCount, dailyRank, topics | entry point |
| getPosts | featured posts by section | section? (TODAY default) | name, tagline, votesCount, dailyRank | entry point, supports YESTERDAY/LAST_WEEK/LAST_MONTH |
| getPost | product details | slug ← getPosts/searchProducts | name, description, votesCount, makers, categories | |
| searchProducts | find products by keyword | query | name, tagline, reviewsRating, slug | |

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
