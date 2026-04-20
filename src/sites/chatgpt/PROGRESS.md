## 2026-04-01: Initial discovery and compilation

**What changed:**
- Fresh capture of ChatGPT backend API traffic (46 API entries, 564 total samples)
- Compiled and curated to 6 operations: getProfile, listConversations, getConversation, searchConversations, getModels, sendMessage
- exchange_chain auth configured (GET /api/auth/session → Bearer token)
- Schemas cleaned: PII scrubbed, over-specific enums generalized

**Why:**
- Rediscovery from scratch after prior package deleted
- Added getModels (new vs prior package)

**Verification:** compile-time verify showed auth_drift (expected — token expired between capture and verify)

## 2026-04-19 — Fixture: sendMessage write-op (fixture-only)

**Context:** `sendMessage` had no example fixture — `verify --write --ops sendMessage` reported "0/0 ops". Per handoff2.md §5.4 the op is recoverable (no inverse needed; user-account side effect is acceptable).
**Changes:** Added `examples/sendMessage.example.json` with `prompt: "verify ping ${now}"` (the `${now}` template helper guarantees a fresh user-visible message per run). Adapter and openapi unchanged.
**Verification:** Fixture loads correctly (op now appears in the verify scan; previously skipped as 0/0). Live verify currently blocked by an auth-detection code issue — managed Chrome is logged into chatgpt.com but the runner reports "Waiting for login..." and times out at 45s. Tracked separately under the in-flight chatgpt adapter rewrite (commit bda0d62, w-chatgpt-fix); not a fixture defect.
**Pitfalls encountered:** Verify uses the registry-installed copy at `$OPENWEB_HOME/sites/chatgpt/`, so the new example file had to be mirrored there for in-loop testing.
