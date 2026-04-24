## 2026-04-24: Add adapter for response trimming and image param

**What changed:**
- Added `docker-hub` adapter (CustomRunner) for all 3 operations
- getImage: trims full_description to 500-char preview, drops internal fields (22KB → ~700B)
- getTags: flattens per-tag images array to architectures summary, adds human-readable size (51KB → ~2KB for 5 tags)
- searchImages: strips repo_owner field, passes through cleanly
- Added `image` virtual param to getImage/getTags — accepts "python" (→ library/python) or "bitnami/python" (→ bitnami/python)
- namespace+name params remain supported for backward compatibility
- Updated response schemas in openapi.yaml to match adapter output
- Updated example fixtures to use `image` param

**Why:**
- getImage and getTags responses were bloated (7–51KB), causing truncation to temp files instead of inline return
- Requiring separate namespace+name params was unintuitive — agents and users naturally think "python" not "library" + "python"

**Verification:** `pnpm --silent dev verify docker-hub`

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
