# Uber Rides — Progress

## 2026-04-13: Initial build — searchLocations, getRideEstimate, getRideHistory

**Context:** Split from combined uber/ubereats site. Rides operations needed separate site due to different domains (m.uber.com, riders.uber.com) and API style (GraphQL vs REST).

**Changes:**
- Created `uber` site with 3 operations
- `searchLocations`: PudoLocationSearch GraphQL on m.uber.com/go/graphql
- `getRideEstimate`: Products GraphQL on m.uber.com/go/graphql — returns fare quotes for all vehicle types
- `getRideHistory`: Activities GraphQL on riders.uber.com/graphql — nested query structure (`activities.past.activities`)

**Key discoveries:**
- m.uber.com and riders.uber.com have different GraphQL schemas (same field names, different argument patterns)
- Products query requires `InputCoordinate!` (non-null) for pickup, `[InputCoordinate!]!` (array) for destinations
- Error-message reversal partially works — server returns "something went wrong" for non-existent fields but "Invalid GraphQL query" for object fields without sub-selections
- `displayName` returns in user's locale setting (e.g. "优选轿车" for UberX in Chinese)
- URL-based navigation (`/go/product-selection?drop[0]=...`) triggers Products query automatically

**Verification:** Pending.

## 2026-04-18: Adapter hardening + login blocker documented

**Context:** Persistent verify FAIL after `verify --all` cycle: `getRideEstimate: GraphQL error: not found` and `getRideHistory: pageFetch failed: TypeError: Failed to fetch`.

**Root cause (environmental, not code):** Two Chrome processes ended up sharing port 9222 (one IPv4, one IPv6 listener — `tmp/openweb-profile-vpQRIz` and `tmp/openweb-profile-K4iNCE`). The runtime connects via `127.0.0.1` → IPv4 profile (no Uber login). The user's logged-in session lives in the IPv6 profile. CDP probes from `localhost` hit IPv6 and saw `sid`/`csid`/`jwt-session` cookies — the runtime's context did not. Both failures resolve to "no auth on m.uber.com / riders.uber.com":
- `Products` GraphQL on m.uber.com returns 200 with `{errors:[{message:"not found"}]}` for unauthenticated callers (pickup/destination context lookup).
- `riders.uber.com/trips` redirects to `auth.uber.com/v2/?...` for unauthenticated callers; subsequent `pageFetch` to `riders.uber.com/graphql` from an `auth.uber.com` page fails with cross-origin "Failed to fetch".

**Changes (adapter hardening, no behavior change for logged-in case):**
- `ensurePage`: always re-navigates (drops the prior "skip if hostname matches" fast-path that trapped stale-page state across sequential verify ops); waits 3s for client-side redirects to settle; explicitly rejects `auth.uber.com`/`login.uber.com` final URLs with a clear `session expired — log in` fatal error.
- `gqlCall`: same-origin guard before `pageFetch` — surfaces a precise error when page host ≠ endpoint host instead of opaque `TypeError: Failed to fetch`.
- Better error classes: nav failure → `retriable`, auth-redirect → `fatal` with login instruction.

**Verification:** searchLocations PASS (no auth required for `pudoLocationSearch`); getRideEstimate / getRideHistory still FAIL until user logs into Uber in the managed Chrome (`pnpm dev browser show`). Errors are now self-explanatory rather than cryptic.

**Blocker:** Cannot complete green verify without user re-logging into Uber in the openweb-managed Chrome profile. Recommend killing the orphan Chrome (the older profile not registered in `~/.openweb/browser.profile`) to eliminate the IPv4/IPv6 port-collision class of bug.

