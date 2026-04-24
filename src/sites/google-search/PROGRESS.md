# Google Search — Progress

## 2026-04-24: Userflow QA — fix stale selectors for news, shopping, videos

**What changed:**
- searchNews: snippet selector `.GI74Re` stale → replaced with `.UqSP2b` (fallback to old)
- searchShopping: complete rewrite — `.pla-unit` container gone, Google Shopping now
  uses `g-inner-card` elements with new inner selectors (`.gkQHve` title, `.lmQWe` price,
  `.DoCHT` original price, `.RDApEe` reviews); added `waitForFunction` for price load
- searchVideos: snippet selector `.VwiC3b`/`[data-sncf]` stale → replaced with `.ITZIwc`
- searchLocal: swapped primary/fallback order for rating (`.yi40Hd` first) and reviews
  (`.RDApEe` first); stale `.MW4etd`/`.UY7F9` kept as fallbacks

**Why:**
- Blind userflow QA across 3 personas (Researcher, Shopper, Local searcher) revealed
  4 operations returning empty/zero data due to Google DOM changes since last verification.

**Personas tested:**
1. Researcher — "climate change economic impact 2026": searchWeb (10), searchNews (10 w/ snippets),
   searchSuggestions (15), getKnowledgePanel (null — expected), getPeopleAlsoAsk (4), getRelatedSearches (8)
2. Shopper — "best wireless earbuds 2026": searchWeb (10), searchShopping (65), searchVideos (10 w/ snippets),
   searchImages (100)
3. Local searcher — "dentist near me San Jose": searchLocal (3), searchWeb (8), getPeopleAlsoAsk (4)

**Known issues:**
- searchLocal first result sometimes includes Google's "Duplicate information" notice in name text
- searchLocal address may include distance + phone depending on Google's rendering variant

**Key files:** `adapters/google-search.ts`
**Verification:** All 10 ops return data; searchNews/searchVideos snippets populated; searchShopping 65 products

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
