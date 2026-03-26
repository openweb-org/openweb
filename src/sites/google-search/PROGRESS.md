# Google Search — Progress

## 2026-03-26: Expand coverage from 3 to 7 operations

**What changed:**
- Added 4 new adapter-based operations: searchNews, searchVideos, searchShopping, getKnowledgePanel
- searchNews: extracts from `/search?tbm=nws` — title, link, source, snippet, publishedAt (ISO 8601 from Unix timestamp)
- searchVideos: extracts from `/search?tbm=vid` — title, link, source, snippet
- searchShopping: extracts from `/search?udm=28` — title, price, originalPrice, merchant, reviewCount
- getKnowledgePanel: extracts from `/search` sidebar — title, subtitle, description (AI summary), facts array
- Test cases added for all 4 new operations
- DOC.md updated with all 7 operations, extraction selectors, and new known issues

**Why:**
- Expanding Google Search coverage to match breadth of search verticals (news, video, shopping, entity info)

**Verification:** All 7 ops verified via manual exec with CDP browser (adapter-verified)
**Commit:** pending

## 2026-03-23: Initial fixture — 3 operations verified

**What changed:**
- Created google-search with 3 operations: searchSuggestions, searchWeb, searchImages
- searchSuggestions uses node transport against `/complete/search?client=chrome`
- searchWeb and searchImages use page DOM extraction with `page_global_data` expressions
- All 3 operations verified (status-match for suggestions, dom-match for web/images)
- Test cases added for all operations

**Why:**
- Google Search is a foundational fixture — autocomplete + organic results cover the core search use case

**Verification:** API-level (all 3 ops return 200, schema valid), fingerprint recorded
**Commit:** pre-commit
