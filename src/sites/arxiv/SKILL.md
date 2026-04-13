# arXiv

## Overview
Open-access preprint server for scientific papers (arxiv.org). Public Atom API at export.arxiv.org for search and metadata retrieval, plus HTML abstract pages.

## Workflows

### Find papers on a topic
1. `searchPapers(search_query)` → browse results → pick paper arXiv ID from `<id>` element
2. `getPaper(id_list)` → full metadata including title, authors, abstract, categories, PDF link

### Get a specific paper's details
1. `getPaper(id_list: "1706.03762")` → Atom XML with title, authors, abstract, categories, links
2. Extract PDF link from `<link title="pdf">` element

### Quick abstract lookup
1. `getAbstract(arxiv_id: "1706.03762")` → HTML page with title, authors, abstract text

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPapers | find papers by keyword/author/category | search_query (user) | XML feed with entries (id, title, authors, abstract, categories) | **entry point** — paginated via start/max_results, field prefixes (all:, au:, ti:, cat:) |
| getPaper | get paper metadata by ID | id_list ← searchPapers `<id>` or user | XML entry with full metadata and PDF link | can fetch multiple papers at once |
| getAbstract | get abstract page by ID | arxiv_id ← searchPapers `<id>` or user | HTML page with title, authors, abstract | human-readable format, uses arxiv.org host |

## Quick Start

```bash
# Search for papers about transformers
openweb arxiv exec searchPapers '{"search_query": "all:transformer", "max_results": 5}'

# Get metadata for "Attention Is All You Need"
openweb arxiv exec getPaper '{"id_list": "1706.03762"}'

# Get abstract page for a paper
openweb arxiv exec getAbstract '{"arxiv_id": "1706.03762"}'
```
