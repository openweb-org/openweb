## 2026-04-09: Initial site package

**What changed:**
- 3 operations: searchImages, getImage, getTags
- Transport: node (public REST API, no auth, no bot detection)
- DOC.md with workflows, operations table, quick start
- Example fixtures for all operations

**Why:**
- Core Docker Hub use cases: search images, inspect details, browse tags/versions
- Public API with clean JSON responses — straightforward node transport

**Verification:** `pnpm --silent dev verify docker-hub`
