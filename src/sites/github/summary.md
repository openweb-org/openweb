# GitHub — 7 new write/reverse ops

## What was done
Added 7 write and reverse operations to the GitHub site package: `unstarRepo`, `closeIssue`, `reopenIssue`, `createComment`, `deleteComment`, `watchRepo`, `unwatchRepo`. Total ops: 11 → 18.

## Approach
- All ops use GitHub REST API at `api.github.com` — no adapters needed
- `unstarRepo`: DELETE on `/user/starred/{owner}/{repo}` (reverse of `starRepo`)
- `closeIssue`: PATCH on `/repos/{owner}/{repo}/issues/{issue_number}` with `state: "closed"`
- `reopenIssue`: PATCH on same endpoint with `state: "open"` — uses virtual path key (`~reopen` suffix) with `x-openweb.actual_path` override since OpenAPI requires unique path+method combos
- `createComment`: POST on `/repos/{owner}/{repo}/issues/{issue_number}/comments`
- `deleteComment`: DELETE on `/repos/{owner}/{repo}/issues/comments/{comment_id}`
- `watchRepo` / `unwatchRepo`: PUT / DELETE on `/repos/{owner}/{repo}/subscription`
- All write ops set `permission: write`, `safety: caution`

## Files changed
- `openapi.yaml` — 7 new paths/operations (stable_ids gh0012–gh0018)
- `examples/` — 7 new example JSON files with `replay_safety: unsafe_mutation`
- `manifest.json` — operation_count 11 → 18
- `DOC.md` — new workflows (manage issues, star/watch), ops table, quick start, known issues

## Pitfalls
- `closeIssue` and `reopenIssue` both PATCH the same GitHub endpoint — disambiguated via virtual path key and `actual_path`
- `deleteComment` requires the numeric `comment_id` from `createComment` response (`.id`), not the issue number
- All write ops require a logged-in browser session

## Verification
- `pnpm build`: 96 sites, 915 files
- `pnpm dev verify github --write --browser`: 2/10 read ops pass; 8 write ops correctly gated behind permission layer
