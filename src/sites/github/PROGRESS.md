## 2026-03-31: Fix auth config and update docs

**What changed:**
- Removed server-level `auth: cookie_session` and `csrf: meta_tag` — GitHub's REST API is public for reads, does not use browser cookies
- Updated `manifest.json`: `requires_auth: false`, corrected description
- Rewrote DOC.md to match site-doc template: added Workflows, data flow annotations, Quick Start, corrected Auth section

**Why:**
- Server-level auth forced all operations through the browser path, causing `needs_page` failures during verify when no browser tab was open
- GitHub's API at `api.github.com` serves public data without cookies — the auth config was incorrect

**Verification:** `openweb verify github` → PASS (getRepo, listIssues). Runtime exec confirmed real data for both operations.

## 2026-03-26: Initial documentation

**What changed:**
- Created DOC.md and PROGRESS.md from existing openapi.yaml spec

**Why:**
- Document 4 operations (2 verified, 2 unverified) including GraphQL endpoint

**Verification:** spec review only — no new capture or compilation
