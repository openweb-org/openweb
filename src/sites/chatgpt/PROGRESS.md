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
