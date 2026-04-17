# Phase 5B Handoff — CustomRunner Adapter Interface

Scope of this pass: introduce a second adapter shape (`CustomRunner`)
alongside the existing `CodeAdapter`, dispatch automatically in the runtime,
and migrate one site as proof. Step A (runtime defaults — optional
`init`/`isAuthenticated`) landed in `9d89b73`; Step B is this commit.

## Outcome

| Component | Change | Commit |
|---|---|---|
| `src/types/adapter.ts` | exported `CustomRunner`, `PreparedContext`, `AuthResult`, `LoadedAdapter`, `isCustomRunner()` | 0d1bffd |
| `src/runtime/adapter-executor.ts` | `loadAdapter` returns `LoadedAdapter`; `executeAdapter` branches to `executeCustomRunner()`; new options `serverUrl` + `resolveAuthResult` | 0d1bffd |
| `src/runtime/http-executor.ts` | eagerly resolves the spec auth primitive into `AuthResult` for the CustomRunner path; `CodeAdapter` path unchanged | 0d1bffd |
| `src/sites/instagram/adapters/instagram-api.ts` | rewritten as CustomRunner (261 → 170 lines); `init`/`isAuthenticated` removed | 0d1bffd |
| `src/runtime/adapter-executor.test.ts` | +3 unit tests covering CustomRunner dispatch (auth resolved, auth skipped, page=null) | 0d1bffd |
| `src/sites/instagram/{DOC.md,PROGRESS.md}` | adapter-shape note + migration entry | bb27af2 |

## Interface contract

```ts
interface CustomRunner {
  readonly name: string
  readonly description: string
  run(ctx: PreparedContext): Promise<unknown>
}

interface PreparedContext {
  page: Page | null               // null for transport: node operations
  operation: string               // operationId
  params: Record<string, unknown>
  helpers: AdapterHelpers
  auth: AuthResult | undefined    // pre-resolved from spec primitives
  serverUrl: string               // already interpolated with server variables
}
```

Detection: `isCustomRunner` returns true when the module's default export
exposes `run` and does **not** also expose `execute`. When both are present,
`CodeAdapter` wins (the loader requires `execute` to type-narrow, and a
runner that ships both is malformed — we surface it as the legacy path
rather than silently shadowing `execute`).

Module-level `export const run = ...` is also accepted as a fallback when
no default export is present — handy for adapters written as plain function
modules.

## Dispatch flow

`executeCustomRunner` is intentionally thinner than the `CodeAdapter` path:

1. If `requiresAuth !== false` and `resolveAuthResult` is supplied, resolve
   the spec auth primitive eagerly. On failure → `auth = undefined` (the
   runner's first real fetch will surface 401 → `needsLogin`).
2. `ensurePagePolyfills(page)` + `warmSession(page, page.url())` (skipped
   when `page` is null).
3. Invoke `runner.run(ctx)`.
4. Post-call `detectPageBotBlock(page)` — same guard as the legacy path.

Init / isAuthenticated do not exist on the runner. PagePlan (Phase 1) is
the canonical init; "auth primitive resolves" is the canonical auth probe
(Phase 5A). Sites that previously did extra probing (e.g. instagram's
cookie-expiry check) lose nothing: a stale-but-present cookie surfaces as
a real 401 inside `run`, classified `needs_login` by the helpers.

## Migration template (CodeAdapter → CustomRunner)

For sites that fit the pattern — ones whose `init` returns
`page.url().includes(domain)` and whose `isAuthenticated` only checks for
cookie/header presence — the mechanical rewrite is:

1. `import type { CustomRunner, PreparedContext, AdapterHelpers } from '../../../types/adapter.js'`
2. Convert custom `Errors` typedef to `type Errors = AdapterHelpers['errors']`.
3. Move per-op handlers into a `Record<string, Handler>` keyed by `operationId`.
4. Replace the default export:
   ```ts
   const runner: CustomRunner = {
     name: '...',
     description: '...',
     async run(ctx) {
       const handler = OPERATIONS[ctx.operation]
       if (!handler) throw ctx.helpers.errors.unknownOp(ctx.operation)
       return handler(ctx.page!, ctx.params, ctx.helpers)
     },
   }
   ```
5. Delete `init` and `isAuthenticated`.
6. Run `pnpm dev verify <site>` and confirm the operations that previously
   relied on the removed hooks (auth checks, etc.) still surface
   `needs_login` on stale credentials via real-call error handling.

## Verification

- `pnpm lint` — clean.
- `pnpm test` — 44 failed / 958 passed, **−1** vs the pre-Step-B baseline of
  45 failed / 957 passed. The −1 is incidental: adding `addInitScript` to
  the mockPage stub fixed an existing breakage.
- `pnpm vitest run src/runtime/adapter-executor.test.ts` — 14/14 pass.
- `pnpm dev verify instagram` — **12/12 PASS** including all 5 CustomRunner
  ops (`getUserPosts`, `muteUser`, `unmuteUser`, `getReels`,
  `getNotifications`) and the 7 spec-path ops (which exercise the
  `LoadedAdapter` loader branch).
- Spot-checks on untouched custom adapters: `zhihu` 10/10 ✓; `bluesky`
  9/10 (single transient HTTP 502 on `searchPosts`, unrelated to this phase).

## What's deliberately not done

- **No bulk migration.** Inventory shows 0 sites currently in
  `custom-permanent`. Most adapters are wave candidates for the
  declarative pipeline (`needs-phase-1/2`); migrating them to
  CustomRunner now would just churn code that's about to be deleted.
- **`AuthResult` is not re-exported from `runtime/primitives/index.ts`.**
  The structural shape is duplicated (small, three fields). Keeping it in
  `types/adapter.ts` means the public adapter contract has zero `runtime/`
  imports. If primitives ever extend the type, both copies need to track
  — flagged here so future-you remembers.
- **Built `.js` artifacts.** `pnpm dev` runs `.ts` directly via tsx, so
  `pnpm dev verify` works immediately. `pnpm build && node dist/cli.js`
  paths require running `node scripts/build-adapters.js` first; CI/build
  already chains it.

## Runtime gaps for follow-on phases

Nothing surfaced by this phase that wasn't already known. The CustomRunner
interface intentionally adds no new primitives — it's purely an adapter
ergonomics improvement and a holding-pen for the operations that genuinely
need imperative code (signing, multi-call composition, response wrapping).

## Suggested next steps

1. **Identify the "permanent" set.** Re-run the inventory classifier
   after the wave conversions complete — whichever adapters remain are
   the candidates for CustomRunner migration.
2. **Mechanical migration of the kept set.** Most candidates will
   match the instagram template above. Bluesky (296 lines, custom
   localStorage-JWT auth) is a good second migration target — its
   `init`/`isAuthenticated` already do nothing structural and it would
   exercise the CustomRunner path with a non-cookie auth model.
3. **Consider exposing `executeCustomRunner` directly** if a future caller
   needs the prepared-context flow without going through `executeAdapter`'s
   type-guard. Today the dispatch is internal — keep it that way until
   there's a real caller.
