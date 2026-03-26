## 2026-03-26: Expand coverage from 2 to 10 operations

**What changed:**
- Added 8 new operations: searchAdvanced, getQuestionDetail, getQuestionComments, getRelatedQuestions, getAnswerDetail, getUserProfile, getPopularTags, getTagWiki
- All operations use node transport against Stack Exchange API v2.3
- Added filter=withbody support for detail endpoints (question, answer)
- Created test files for all 10 operations
- Updated DOC.md with full operation table

**Why:**
- Expand coverage to support full Q&A workflows: search → detail → answers → comments → related → user profiles → tags

**Verification:** All 10 operations PASS via `openweb verify stackoverflow`

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 2 verified operations against Stack Exchange API v2.3

**Verification:** spec review only — no new capture or compilation
