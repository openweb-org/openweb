## 2026-03-28: Clean rediscovery — 7 adapter operations

**What changed:**
- Full rediscovery from scratch (no prior spec used)
- 7 L3 adapter operations: searchMovies, getMovieDetail, getMovieComments, getTopMovies, searchBooks, getBookDetail, getBookComments
- Auth: none (public data)
- Transport: page (adapter DOM extraction)
- Data sources: JSON-LD for movie/book detail, DOM selectors for all operations

**Why:**
- Pipeline v2 rediscovery comparison exercise
- Douban has no JSON APIs — 100% DOM extraction site

**Verification:** All 7 operations return real data via exec
