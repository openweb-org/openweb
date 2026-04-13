# Goodreads

## Overview
World's largest book community (Amazon-owned). Search books, get book details with ratings and reviews, and explore author profiles.

## Workflows

### Find a book and read reviews
1. `searchBooks(q)` → pick result → `bookId`
2. `getBook(bookId)` → title, rating, description, genres
3. `getReviews(bookId)` → community reviews with ratings

### Explore an author's work
1. `searchBooks(q)` → pick result → `authorId`
2. `getAuthor(authorId)` → bio, bibliography with `bookId` per book
3. `getBook(bookId)` → full detail on any book

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchBooks | find books by title/author/ISBN | q | bookId, title, author, authorId, averageRating | entry point; 20 results/page |
| getBook | full book detail | bookId ← searchBooks | title, author, ratingValue, description, genres, pageCount, isbn | LD+JSON + DOM |
| getReviews | community reviews | bookId ← searchBooks | name, rating, text, date | up to 30 reviews from page |
| getAuthor | author profile + bibliography | authorId ← searchBooks | name, bio, born, books[] | books include bookId |

## Quick Start

```bash
# Search for a book
openweb goodreads exec searchBooks '{"q": "dune"}'

# Get book details
openweb goodreads exec getBook '{"bookId": "44767458-dune"}'

# Get reviews for a book
openweb goodreads exec getReviews '{"bookId": "44767458-dune"}'

# Get author profile
openweb goodreads exec getAuthor '{"authorId": "58.Frank_Herbert"}'
```
