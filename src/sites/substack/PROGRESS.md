## 2026-04-01: Initial discovery and compile

**What changed:**
- Discovered Substack REST API endpoints via browser capture
- Built adapter for multi-subdomain routing (publications on different domains)
- 5 operations: searchPosts, getArchive, getPost, getPostComments, getTrending

**Why:**
- Initial site package creation targeting getPost, getPublication, searchPosts, getComments

**Verification:** adapter-verified, capture-based discovery on astralcodexten.substack.com
