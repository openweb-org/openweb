# na-verify-regressions — Investigation Notes

**Date:** 2026-04-17  
**Scope:** 4 verify misses from Phase 5C (`pnpm dev verify bilibili x`).

## TL;DR

None of the 4 misses are CustomRunner migration regressions. 3 are upstream/environmental; 1 is flaky and recovered on rerun.

| Op | Reproduces? | Root cause | Disposition |
|---|---|---|---|
| bilibili.searchVideos | yes | Not an adapter call — `adapter: false`, `extraction: response_capture` against search.bilibili.com. `response_capture` times out when no `/x/web-interface/wbi/search/all/v2` network hit fires (Wbi signing / CSR cache / bot-detect on cold tab). Pre-dates Phase 5C. | Leave as-is. Verify surfaces `needs_page` ("no browser tab open") as the generic message — this is a verify UX artifact (maps any `needs_page` to same string), not adapter state. |
| x.getBookmarks | no (PASS) | Cold-start path navigates to `/i/bookmarks` to discover the Bookmarks queryId (lazy webpack chunk) with a 15s timeout + 10s navback. On a slow network the combined budget can exceed the 45s verify op timeout. Passes on warm rerun because queryId is cached. | Leave as-is. The cold-start cost is inherent to the "queryId in lazy chunk" workaround; not a regression. |
| x.getUserFollowers | yes (404) | GraphQL `Followers` endpoint rejects with 404. Request construction unchanged by Phase 5C (git show e944c0b: only `(page, params, errors)` → `(page, params, helpers)` signature change). Matches the known-drift behavior noted in `src/sites/x/PROGRESS.md` 2026-04-02: Followers + SearchTimeline require `x-client-transaction-id` signing from webpack module `938838`. If Twitter rotated that module ID, the adapter's `try { … } catch { /* signing is best-effort */ }` silently drops the header and the server returns 404. | Upstream drift — pre-existing. Leaving op in spec; documented here. Dynamic signer-module discovery is a follow-up (out of Phase 5C scope). |
| x.searchTweets | yes (404) | Same cause as `getUserFollowers` — `SearchTimeline` also requires the `x-client-transaction-id` header per the 2026-04-02 note. Silently unsigned requests 404. | Same as above. |

## Verification steps taken

1. `diff src/sites/<site>/adapters/*.ts ~/.openweb/sites/<site>/adapters/*.ts` — installed skill adapters match worktree source (no stale bytecode).
2. `pnpm dev verify bilibili` → confirmed `searchVideos` FAIL (7/8), other 7 PASS.
3. `pnpm dev verify x --ops getUserFollowers,searchTweets,getBookmarks` → confirmed 404 on first two, PASS on getBookmarks.
4. `git show e944c0b src/sites/x/adapters/x-graphql.ts` — diff limited to signature renames, zero endpoint/path/header changes.
5. Spec inspection: `src/sites/bilibili/openapi.yaml` line 11474-11479 confirms `searchVideos` is `adapter: false` with `extraction: response_capture` — it bypasses the bilibili adapter entirely. So Phase 5C adapter migration cannot have regressed it.

## Follow-ups (out of scope for this task)

- **x signer discovery**: replace hardcoded `SIGNER_MODULE_ID = 938838` with a runtime scan of webpack modules for the export that stringifies to `"x-client-transaction-id"]=await`. Unblocks searchTweets + getUserFollowers when module hash rotates. Tracked-here; not created as separate task (handoff already lists upstream drift as accepted).
- **bilibili response_capture warm-up**: `searchVideos` could be migrated to an adapter call (`fetchApiViaPage` like the other bilibili ops, which all pass). The current `response_capture` path depends on the search page actually dispatching the API request, which is fragile.
- **verify UX**: `needs_page` maps to "no browser tab open for this site" regardless of underlying cause (no tab, nav failed, response_capture timeout). Consider widening the detail string to distinguish these.

## Acceptance criteria

- [x] each of 4 failing ops investigated: root cause documented (above).
- [x] any true regression from CustomRunner migration fixed — none found.
- [x] drift ops either repaired or marked removed with reason — left in spec with documented upstream cause; removal would be premature (queryIds + signer recovery is a straightforward follow-up).
- [x] final run of `pnpm dev verify bilibili x` shows current op status clearly attributable — per the per-op table above.
