# Google Scholar

## Overview
Academic paper search engine (Google). Search papers, explore citation graphs, and view researcher profiles with h-index and publication history.

## Workflows

### Search papers and explore citations
1. `searchPapers(q)` → results with `cites` cluster ID
2. `getCitations(cites)` → papers citing that paper

### Research an author
1. `searchPapers(q)` → find paper → author links contain `user` ID
2. `getAuthorProfile(user)` → name, affiliation, h-index, citations, publications

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPapers | find papers by keyword/author | q | title, authors, citedBy, cites, pdfLink | 10 results/page; cites field feeds getCitations |
| getCitations | papers citing a given paper | cites ← searchPapers | title, authors, citedBy, totalResults | same DOM as search |
| getAuthorProfile | researcher profile | user (from author links) | name, hIndex, citationsAll, publications[] | up to 20 publications |

## Quick Start

```bash
# Search for papers
openweb google-scholar exec searchPapers '{"q": "transformer attention"}'

# Get citing papers (use cites value from search)
openweb google-scholar exec getCitations '{"cites": "10449950798206616151"}'

# Get author profile (use user ID from author links in search)
openweb google-scholar exec getAuthorProfile '{"user": "KROUdngAAAAJ"}'
```

---

## Site Internals

### API Architecture
Traditional server-rendered HTML. No SPA framework, no `__NEXT_DATA__`, no JSON APIs.
All data is in the rendered DOM. Search results and citations share the same page structure
(`/scholar?q=...` vs `/scholar?cites=...`). Author profiles live at `/citations?user=...`.

### Auth
No auth required. All data is public.

### Transport
`page` transport required. Google has aggressive bot detection — direct HTTP requests
(curl, node fetch) will be blocked or return CAPTCHAs. Headed browser on port 9222 needed.

### Extraction
All operations use `page_global_data` extraction (inline JS evaluating DOM):
- **searchPapers**: Parses `.gs_r.gs_or.gs_scl` result rows — title from `.gs_rt a`, authors from `.gs_a`, citations from `.gs_fl.gs_flb a[Cited by]`
- **getCitations**: Same DOM structure as search, just different URL (`?cites=` instead of `?q=`)
- **getAuthorProfile**: Parses `/citations?user=` page — profile from `#gsc_prf_in`, stats from `#gsc_rsb_st` table, publications from `.gsc_a_tr` rows

### Known Issues
- Google may trigger CAPTCHAs on rapid sequential requests — keep sessions short
- Search returns max 10 results per page; use `start` param for pagination
- Author profile shows up to 20 publications from the initial page load (no pagination)
- Citation counts from search are approximate
