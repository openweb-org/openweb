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

## 2026-04-19 — Write-op verify investigation

**Context:** First end-to-end `verify --write` sweep against the 5 BLOCKED ops (closeIssue, reopenIssue, watchRepo, unwatchRepo, unstarRepo). All failed. Initial sweep was masked by a runtime cascade bug where `handleLoginRequired()` killed the managed Chrome and verify held a stale `Browser` handle, so every op crashed before reaching the network. Once that was fixed in `acc23ad`, the true upstream blocker surfaced.
**Changes:** Docs-only commit `be3a0a5` documented the blocker. This update expands DOC.md heavily with the auth-architecture mismatch, the `bf66525` → `723c3dc` flip-flop history, and the planned rewrite path. SKILL.md Operations table marks the 5 affected ops with **BLOCKED — pending rewrite to github.com web endpoints** notes; Known Limitations section added.
**Verification:** 0/5 — all blocked.
**Key discovery:** Auth-architecture mismatch, not a runtime/spec bug. `api.github.com` requires Bearer/PAT for writes; cookie_session does not authenticate against api.github.com regardless of CSRF config (and `meta_tag` CSRF resolution always fails because api.github.com returns JSON, not HTML). The project-wide constraint (all sites use `cookie_session`, no Bearer/PAT primitives) means the fix is to rewrite the write ops against the github.com web UI — rails-style POSTs with `X-CSRF-Token` from `<meta name="csrf-token">` on the github.com page — exactly the pattern used by instagram/x/reddit. Web-rewrite agent `w-github-web-rewrite` is staged but paused on a user action: sign in to github.com in the managed Chrome at `localhost:9222`. Runtime cascade bug `acc23ad` has been fixed, removing one layered blocker; the remaining work is purely the rewrite. See `doc/todo/write-verify/handoff.md` §3.1.
