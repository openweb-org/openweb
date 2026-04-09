## 2026-04-09: Initial add — 4 read operations

**What changed:**
- Added Quora site package: searchQuestions, getQuestion, getAnswers, getProfile
- Adapter-based extraction: GraphQL interception for search, DOM extraction for detail/answers/profile
- Page transport (formkey is page-scoped, GraphQL replay returns null)

**Why:**
- New site addition — Q&A platform with 4 core read operations

**Verification:** Build passes, runtime verify pending
**Commit:** pending
