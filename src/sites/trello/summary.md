# Trello — deleteCard + archiveCard

## What was added
- **deleteCard** — permanently deletes a card via `DELETE /cards/{cardId}`. Irreversible.
- **archiveCard** — archives (soft-closes) a card via `PUT /cards/{cardId}` with `{closed: true}`. Reversible in Trello UI.

## Implementation details
- Both ops route through the existing `trello-api` adapter and `apiFetch` helper.
- `apiFetch` method signature extended from `GET | POST` to `GET | POST | PUT | DELETE`.
- `deleteCard` returns `{deleted: true, cardId}` (Trello DELETE returns empty `{}`, so we synthesize confirmation).
- `archiveCard` returns the updated card object with `closed: true`.
- Both ops: `permission: write`, `safety: caution`, `requestBody: application/json` with `cardId` required.
- Stable IDs: `tr0006` (deleteCard), `tr0007` (archiveCard).

## Files changed
- `openapi.yaml` — 2 new paths (total: 7 ops)
- `adapters/trello-api.ts` — 2 new handler functions + method type update
- `examples/deleteCard.example.json` — replay_safety: unsafe_mutation
- `examples/archiveCard.example.json` — replay_safety: unsafe_mutation
- `manifest.json` — operation_count 5→7
- `DOC.md` — new workflow, ops table, quick-start examples

## Verification
- `pnpm build` — PASS
- `pnpm dev verify trello --browser` — FAIL (no Trello login session in managed Chrome, environment auth issue, not a code problem)
