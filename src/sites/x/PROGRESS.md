## 2026-03-28: Initial compile (clean rediscovery)

**What changed:**
- Compiled 7 HTTP operations for 5 target intents + 2 bonus
- Auth: cookie_session + bearer token, CSRF (ct0 → x-csrf-token, scope: all methods)
- Transport: page (TLS fingerprint required)
- All GraphQL with persisted query hashes

**Target intents:**
1. Search tweets → searchTweets (intermittent 404)
2. User profile → getUserProfile (verified)
3. User tweets → getUserTweets (verified)
4. Tweet detail → getTweetDetail (verified)
5. Explore/trending → getExplorePage (verified)
6. (bonus) Home timeline → getHomeTimeline (verified)
7. (bonus) Tweet by ID → getTweetById (verified)

**Why:**
- Clean rediscovery from scratch — no prior site package

**Verification:** 6/7 operations return real data via exec. SearchTimeline returns 404 (transient/rate-limited).
