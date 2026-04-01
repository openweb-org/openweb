## 2026-03-31: Curate — enrich schemas, fix examples, update DOC.md

**What changed:**
- Enriched all 14 bare `type: object` response schemas with actual field definitions (2-3 levels deep)
- Fixed example files: replaced invalid `"id": 1` with real Douban IDs (1292052, 2567698)
- Created missing example files for 4 adapter ops (getMoviePhotos, getTop250, searchMusic, getMusicDetail)
- Added `cookie_session` auth config to server block
- Rewrote DOC.md per site-doc.md template: Workflows with data flow, Operations table with `← source` annotations, Quick Start

**Why:**
- Bare schemas gave agents no information about response fields
- Invalid example IDs caused verify failures (404) for all detail endpoints
- DOC.md lacked cross-operation data flow and workflow guidance

**Verification:** Runtime verify pass (10 API ops), spec curation standards, doc template compliance
