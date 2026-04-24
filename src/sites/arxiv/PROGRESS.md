## 2026-04-24 — Userflow QA

### Personas tested
1. **ML researcher** — Search "diffusion models", browse recent, read abstract
2. **Student** — Search "BERT language model", get foundational paper details
3. **Industry researcher** — Browse cs.AI category, check recent papers, identify authors

### Issues found

| # | Gap type | Issue | Impact |
|---|----------|-------|--------|
| 1 | **Wrong data** | Multi-word queries split into OR terms by arXiv's Lucene parser. `all:diffusion models` → `all:diffusion OR all:models` (1.2M results, none specific) | Searches return irrelevant results for any multi-word query |
| 2 | **Missing data** | searchPapers/getPaper returned raw Atom XML strings. Agents must parse XML. | Unusable without XML parsing — agents can't extract fields |
| 3 | **Missing data** | getAbstract returned raw HTML (~50KB). Agents must scrape HTML. | Same as above but worse — full HTML page dumped as string |

### Root cause
- **Issue 1**: arXiv API uses Lucene syntax where spaces default to OR between terms. The `all:` field prefix only binds to the immediately following token. No adapter to pre-process queries.
- **Issues 2–3**: No adapter existed — the site was spec-only with direct HTTP passthrough. The response-parser in the runtime returns raw text for XML/HTML content types.

### Fixes applied
1. **Created adapter** (`src/sites/arxiv/adapters/arxiv.ts`):
   - All 3 operations use `fetch()` directly (transport: node, no browser)
   - XML parsing via regex for Atom feed entries
   - HTML parsing via regex for abstract page
   - Returns structured JSON: `{id, title, abstract, authors[], published, updated, primary_category, categories[], pdf_url, abstract_url, comment?, journal_ref?, doi?}`
2. **Auto-AND query preprocessing**: Multi-word queries without explicit boolean operators are joined with AND. Field prefix propagates to bare words: `all:diffusion models` → `all:diffusion AND all:models`
3. **Updated openapi.yaml**: Wired adapter for all 3 ops, bumped tool_version to 2, improved search_query description with multi-word examples
4. **Updated DOC.md**: Reflects JSON responses, auto-AND behavior, removed XML parsing caveat

### Verification
All 3 workflows re-run end-to-end after fixes:
- `searchPapers "all:diffusion models"` → 55K results (vs 1.2M), top results are diffusion model papers
- `searchPapers "all:BERT language model"` → 5.7K results (vs 1.2M), 4/5 BERT-related
- `searchPapers "cat:cs.AI"` → clean JSON with recent cs.AI papers
- `getPaper "1706.03762"` → clean JSON for Attention paper
- `getAbstract "1810.04805"` → clean JSON for BERT paper
- `getPaper "1706.03762,1810.04805"` → array of 2 paper objects
- `searchPapers "au:hinton"` → single-term passthrough works

**Verification:** `pnpm build && pnpm --silent dev verify arxiv`

## 2026-04-09 — Polish pass

- Created PROGRESS.md
- DOC.md: added `← source` annotations to Operations table, marked entry points, fixed section heading hierarchy
- openapi.yaml: added realistic examples to optional params (sortBy, sortOrder, max_results, start)
- Verified all 3 operations pass runtime verify

**Verification:** `pnpm build && pnpm --silent dev verify arxiv`
