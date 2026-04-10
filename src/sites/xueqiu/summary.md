# Xueqiu — addToWatchlist + removeFromWatchlist summary

## Changes

### New operations (2)
- **addToWatchlist** — add a stock to user's watchlist via `POST /v5/stock/portfolio/stock/add.json`
- **removeFromWatchlist** — remove a stock from user's watchlist via `POST /v5/stock/portfolio/stock/delete.json`

Both set `permission: write`, `safety: caution`, `transport: page`. Both require login (cookie_session auth). Write/reverse pair.

### Files changed
- `openapi.yaml` — 2 new paths (total: 12 ops, 10 read + 2 write)
- `examples/addToWatchlist.example.json` — replay_safety: unsafe_mutation
- `examples/removeFromWatchlist.example.json` — replay_safety: unsafe_mutation
- `DOC.md` — new "Manage watchlist" workflow, updated ops table, quick-start examples

### Xueqiu API endpoints used
- `POST /v5/stock/portfolio/stock/add.json` on `stock.xueqiu.com` — addToWatchlist
- `POST /v5/stock/portfolio/stock/delete.json` on `stock.xueqiu.com` — removeFromWatchlist

### Verification
- `pnpm build` — PASS
- `pnpm dev verify xueqiu --browser` — PASS (10/10 read ops verified; 2 write ops skipped as unsafe_mutation)
