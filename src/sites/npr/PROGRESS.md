## 2026-04-09: Polish — docs, schema, examples

**What changed:**
- DOC.md: fixed heading hierarchy under Site Internals (## → ###)
- openapi.yaml: added `required` arrays to all nested objects (displayDate, image, slug)
- openapi.yaml: added descriptions to all bare properties (caption, credit, getTopStories fields)
- openapi.yaml: added `example` values to filters, hitsPerPage, page params
- openapi.yaml: eliminated bare `type: object` — all nested objects have descriptions
- All 3 example files present and correct

**Why:**
- Align with site package quality checklist

**Verification:** `pnpm --silent dev verify npr`
