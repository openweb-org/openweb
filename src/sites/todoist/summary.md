# Todoist — deleteTask + uncompleteTask summary

## Changes

### New operations (2)
- **deleteTask** — permanently deletes a task by ID via `DELETE /rest/v2/tasks/{id}`
- **uncompleteTask** — reopens a completed task via `POST /rest/v2/tasks/{id}/reopen`

Both set `permission: write`, `safety: caution`. Both return 204 No Content on success.

### Files changed
- `openapi.yaml` — 2 new paths, added `safety: caution` to existing `completeTask`
- `adapters/todoist-api.ts` — 2 new switch cases (uncompleteTask → `/reopen`, deleteTask → `DELETE`)
- `examples/deleteTask.example.json` — replay_safety: unsafe_mutation
- `examples/uncompleteTask.example.json` — replay_safety: unsafe_mutation
- `DOC.md` — new workflows (Reopen, Delete), updated ops table, quick-start examples

### Todoist REST API v2 endpoints used
- `POST /rest/v2/tasks/{id}/reopen` — uncompleteTask (reverses `/close`)
- `DELETE /rest/v2/tasks/{id}` — deleteTask (permanent)

### Verification
- `pnpm build` — PASS
- `pnpm dev verify todoist --browser` — FAIL (no Todoist login session in managed Chrome)
  - All ops fail with timeout waiting for bearer token extraction
  - Root cause: environment auth, not code — adapter needs active `td_session` cookie
