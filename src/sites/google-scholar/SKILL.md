# Google Scholar

## Overview
Academic paper search engine (Google). Search papers, explore citation graphs, and view researcher profiles with h-index and publication history.

## Workflows

### Search papers and explore citations
1. `searchPapers(q)` → results with `cites` cluster ID
2. `getCitations(cites)` → papers citing that paper → `cites` for further hops

### Research an author
1. `searchPapers(q)` → find paper → `user` ID from author links
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
