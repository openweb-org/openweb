# arXiv

## Overview
Open-access preprint server for scientific papers (arxiv.org). Public Atom API at export.arxiv.org for search and metadata retrieval, plus HTML abstract pages. Adapter parses XML/HTML into structured JSON.

## Workflows

### Find papers on a topic
1. `searchPapers(search_query: "all:diffusion models")` → JSON with total_results + papers array
2. `getPaper(id_list: "<id>")` → full metadata including title, authors, abstract, categories, PDF link

### Get a specific paper's details
1. `getPaper(id_list: "1706.03762")` → JSON with title, authors, abstract, categories, pdf_url
2. Use `pdf_url` for direct PDF download

### Quick abstract lookup
1. `getAbstract(arxiv_id: "1706.03762")` → JSON with title, authors, abstract, categories, submission dates

## Operations

| Operation | Intent | Key Input | Key Output | Notes |
|-----------|--------|-----------|------------|-------|
| searchPapers | find papers by keyword/author/category | search_query (user) | `{total_results, papers[]}` — id, title, authors, abstract, categories, pdf_url | **entry point** — multi-word queries auto-ANDed, field prefixes (all:, au:, ti:, cat:) |
| getPaper | get paper metadata by ID | id_list ← searchPapers `id` or user | JSON paper object — id, title, authors, abstract, categories, pdf_url | comma-separated IDs for multiple papers |
| getAbstract | get abstract page by ID | arxiv_id ← searchPapers `id` or user | JSON paper object — id, title, authors, abstract, categories, submitted | uses arxiv.org HTML, parsed to JSON |

## Quick Start

```bash
# Search for papers about diffusion models
openweb arxiv searchPapers '{"search_query": "all:diffusion models", "max_results": 5}'

# Get metadata for "Attention Is All You Need"
openweb arxiv getPaper '{"id_list": "1706.03762"}'

# Get abstract page for a paper
openweb arxiv getAbstract '{"arxiv_id": "1706.03762"}'
```

---

## API Architecture
- Atom XML API at `export.arxiv.org/api/query` — single endpoint, query param-driven
- Adapter parses XML/HTML into structured JSON (no XML parsing needed by callers)
- `search_query` param uses arXiv query syntax with field prefixes: `all:`, `ti:`, `au:`, `abs:`, `cat:`
- Multi-word queries are auto-ANDed (e.g. "all:diffusion models" → "all:diffusion AND all:models")
- Explicit boolean operators (AND, OR, ANDNOT) are passed through unchanged
- HTML abstract pages at `arxiv.org/abs/{id}` parsed to structured JSON

## Auth
No auth required. All operations are public read-only.

## Transport
- `node` — direct HTTP works, no browser needed
- No bot detection, no CORS restrictions
- Rate limit: ~3 requests/second recommended by arXiv

## Known Issues
- Paper IDs may include version suffix (e.g. "2301.07041v2") — omit version for latest
- Large result sets (max_results > 100) may be slow or rate-limited
- `all:` field prefix matches any field — for precision use `ti:` (title) or `abs:` (abstract)
