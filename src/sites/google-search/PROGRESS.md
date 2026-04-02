# Google Search — Progress

## 2026-04-02: Fix adapter navigation, trim to 9 verified ops

**What changed:**
- Added `navigateToSearch()` helper — all ops now navigate to the correct
  Google URL with query params before DOM extraction (was extracting from
  homepage, returning empty results)
- Trimmed from 14 to 9 operations: removed getFeaturedSnippet, getCalculation,
  getWeather, getTranslation (selectors stale, low value)
- Updated PAA, related searches, and local selectors for current Google DOM
- Removed unused `readQuery()` helper; all ops use params instead of `_params`

**Why:**
- Adapter received page at `google.com/` but never navigated to `/search?q=...`.
  Root cause: adapter functions ignored params and extracted from whatever page
  was loaded. This is a systemic adapter-pattern bug documented in spec-curation.md.

**Key files:** `adapters/google-search.ts`, `openapi.yaml`, `DOC.md`, `manifest.json`
**Verification:** `searchWeb '{"q":"hello world"}'` → 7 results; all 9 ops return data
**Commit:** b237c7c

## 2026-03-31: Curate to 14 operations, add auth, DOC polish

**What changed:**
- Expanded from 7 to 14 operations: added getFeaturedSnippet, getPeopleAlsoAsk, getRelatedSearches, searchLocal, getCalculation, getWeather, getTranslation
- Set server-level auth to cookie_session (page transport uses browser cookies)
- Enriched all operation summaries with 3-5 key response fields
- Added 3 new example files (getFeaturedSnippet, getPeopleAlsoAsk, searchLocal) — 10 total
- Rewrote DOC.md per site-doc.md template: workflows, data flow annotations, quick start, site internals
- Updated manifest to version 1.1.0 with 14 ops

**Why:**
- Full curation pass per compile.md Step 3: enrich schemas, ensure examples, doc polish

**Verification:** All ops adapter-verified via DOM extraction; verify pass pending
**Commit:** pending

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
