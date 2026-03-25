# Douban Fixture

## Overview
Douban (douban.com) — China's premier review platform for movies, books, and music. 10 operations covering search and detail for all three content types plus ratings and reviews.

## Operations
| Operation | Intent | Notes |
|-----------|--------|-------|
| searchMovies | Search movies by keyword | movie.douban.com/j/search |
| getMovieDetail | Get movie details with cast, ratings | movie.douban.com subject page |
| getMovieReviews | Get movie reviews | Movie review page |
| getMoviePhotos | Get movie photos/stills | Photo gallery |
| getTop250 | Get Douban Top 250 ranked movies | Classic ranking |
| searchBooks | Search books by keyword | book.douban.com |
| getBookDetail | Get book details with ratings | Book subject page |
| getBookReviews | Get book reviews | Book review page |
| searchMusic | Search music by keyword | music.douban.com |
| getMusicDetail | Get music album details | Music subject page |

## Auth
- No auth needed for public data
- `requires_auth: false`
