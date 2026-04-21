# Curate Operations

Operation-level quality: naming, noise removal, parameter descriptions, permissions,
and write operation curation. Loaded during the Curate step of `add-site/guide.md`.

**Edit target:** `$OPENWEB_HOME/sites/<site>/openapi.yaml`. Read it before making changes.

**Companion files:** auth/transport/extraction: `curate-runtime.md`.
Response schemas and examples: `curate-schemas.md`.

---

## 1. Remove Noise Operations

Delete any operation matching these criteria:

- **Analytics/tracking** — names containing: `collector`, `log`, `batch`,
  `telemetry`, `apm`, `tracking`, `beacon`, `zlab`, `commercial`, `impression`,
  `feedback`, `popup`
- **CDN/static assets** — `/static/`, `/_next/`, `/assets/`
- **Polling/heartbeat** — ping or keep-alive only
- **4xx-only clusters** — no successful responses captured
- **POST with empty/204 response** — likely telemetry
- **Bare operationId** — just `get` or `create` with no noun
- **Internal framework** — `rsc-action`, `flagship-web`, `_next`
- **SaaS dashboard internals** — internal namespace traffic; manual filtering needed

> `src/compiler/analyzer/labeler.ts` pre-filters many noise samples (via domain and path blocklists)
> (analytics/tracking/static) during analysis; the rules above cover what slips through.

### Recover Write Ops from Noisy Names

Compiler generates names like `createAnswersVoters` (upvote),
`createMembersFollowers` (follow), `createStatusesSetlike` (like). Before deleting
any POST, cross-reference against discovery write intents. Check URL path:

- `/answers/{id}/voters` or `/like` → upvote/like
- `/members/{id}/followers` or `/friendships/create` → follow
- `/{resource}/{id}/favorites` → bookmark/save

### Keep Bar

Keep a non-target operation only if it meets ALL of:

1. Returns structured JSON (not HTML, not empty)
2. On the primary domain (not off-domain CDN/analytics)
3. Has clear user value (e.g., `getMe`, `getHotSearch`, `getRecommendFeed`)
4. Can be given a meaningful name — if you cannot name it, it is noise

**Write op test:** "would a user knowingly trigger this action?" If no, exclude.
Real write ops: like, follow, bookmark, post, comment, vote, repost.
NOT: `createCollectorApm`, `createZaLogsBatch`, `createCommercialEcommerce`.

Every kept operation must have a meaningful `operationId` and a useful `summary`.
If you cannot determine what an operation does, exclude it.

---

## 2. Rename Operations and Summaries

### operationId Convention

camelCase, semantic verb + noun:

| Auto-generated | Curated |
|---|---|
| `getApiV1SearchResults` | `searchProducts` |
| `listGraphql` | `searchUsers` |
| `getUsersUser` | `getUserProfile` |
| `createAnswersVoters` | `upvoteAnswer` |

- Name by user action, not URL path or endpoint technology
- GraphQL: name by query/mutation intent, not endpoint
- Write ops: verb matching user action (`likePost`, `followUser`, `addToCart`)

### Summary Convention

Describe the user action with 3-5 key response fields so an agent can decide
whether the operation returns what it needs.

| Bad | Good |
|---|---|
| "Get video detail info" | "Get video detail — title, play count, likes, favorites, uploader info" |
| "Search content" | "Search Q&A by keyword — title, excerpt, vote count, author" |

---

## 3. Remove Anti-Bot and Fingerprint Parameters

Browser-generated tokens handled by adapter/page transport do not belong in
the operation's parameter list. Remove them.

> **Scrubbing vs parameter removal:** `src/compiler/curation/scrub.ts` automatically
> strips PII from example *values*. Removing anti-bot *parameters* (e.g.
> `dm_img_*`, `w_rid`) from the schema itself is a MANUAL curation step.

| Parameter(s) | Source |
|---|---|
| `dm_cover_img_str`, `dm_img_inter`, `dm_img_list`, `dm_img_str` | Bilibili |
| `w_rid`, `wts` | Bilibili wbi signing |
| `__a`, `__d`, `__s`, `__req`, `__rev` | Meta/Instagram/Facebook |
| Any param with `<REDACTED_TOKEN>` or fragmented JSON example | Various |

**Rule:** If a param's purpose is unclear and its example value is random/opaque,
it is anti-bot infrastructure. Remove it.

---

## 4. Improve Parameter Descriptions

Auto-generated descriptions cover only common names (`q`, `page`, `limit`).
All site-specific parameters need manual descriptions.

| Issue | Fix |
|---|---|
| Generic `id` | Add context: "Subreddit name (without r/ prefix)" |
| `queryId` | Note the GraphQL operation it references |
| Opaque IDs | "Post ID (base-36, e.g. '1jqk8w')" |
| Missing constraints | "Number of results (max 100)" |
| Enum-like params | "Sort order: 'hot', 'new', 'top'" |

Every parameter must be self-explanatory without reading the site's source code.

---

## 5. Set Permissions and Curate Write Ops

### Permission Table

| Method | Permission |
|---|---|
| GET / HEAD | `read` |
| GraphQL queries (even via POST) | `read` |
| POST / PUT / PATCH (mutations) | `write` |
| DELETE | `delete` |
| GraphQL mutations | `write` |
| Financial transactions | `transact` |

Auto-curation defaults are usually correct. Verify edge cases:
- GraphQL queries via POST should be `read`, not `write`
- Idempotent POST endpoints that only fetch data should be `read`

> **Two-stage permission derivation:** `apply-curation.ts` `defaultPermission()`
> returns `write` for any POST/PUT/PATCH (no `transact` detection). The `transact`
> permission is auto-assigned later at GENERATION time by
> `src/lib/permission-derive.ts` via `TRANSACT_PATTERNS`
> (checkout/purchase/payment/order/subscribe in the path).

### Write Op Curation

Write ops need extra attention:

1. **Naming:** verb matching user action (`likePost`, not `createStatusesSetlike`)
2. **Permission:** `write`, `delete` (destructive), or `transact` (financial)
3. **Safety level:** document SAFE / CAUTION / NEVER in DOC.md (see `add-site/document.md`)
4. **Manual verify:** test in a safe context, then undo:
   ```bash
   openweb <site> exec likePost '{"postId": "..."}'
   openweb <site> exec unlikePost '{"postId": "..."}'
   ```
   Or use `openweb verify <site> --write` with a disposable test context.

> Replay safety details: `curate-schemas.md` (Replay Safety section).

---

## 6. Merge with Existing Package

> Load this section only if the site already exists in `src/sites/<site>/`.
> For new sites, skip to the checklist.

Merge decisions are curation work — install is a dumb overwrite of the final
curated package.

### Merge Process

**Step 1 — Read existing package.** Note in the existing `openapi.yaml`:

- Write operations (`permission: write`) — manually authored
- Adapter references (`x-openweb.adapter`) — custom code
- Complex auth (`exchange_chain`, `page_global`, `sapisidhash`, `webpack_module_walk`)
- Custom `$ref` schemas in `components/`

**Step 2 — Copy new spec to temp location.** Do not overwrite the existing spec.

**Step 3 — Merge operations:**

- Add genuinely new operations (new paths not in existing spec)
- For ops in both: keep existing if it has better schemas/params or was manually
  curated; take new if existing was a stub
- **NEVER delete existing write operations**
- **NEVER delete existing adapter references**

> Permissions on existing operations are preserved as-is during merge. Only
> NEW operations receive auto-derived defaults from `apply-curation.ts`.

**Step 4 — Merge auth:** Keep existing complex auth. If existing has no auth and
new detected `cookie_session` + CSRF, take the new config.

**Step 5 — Preserve adapters:** Never copy adapter files from new package.
Existing adapter directory is always authoritative.

**Step 6 — Output:** The merged spec is the final curated artifact. Subsequent
steps (doc, verify, install) operate on this result.

---

## Curation Checklist

Before moving to schema review (`curate-schemas.md`) or runtime config
(`curate-runtime.md`), confirm:

- [ ] All noise operations removed (analytics, tracking, CDN, framework internals)
- [ ] Real write ops recovered from noisy compiler names
- [ ] Non-target ops pass keep bar (structured JSON, primary domain, user value, nameable)
- [ ] Every `operationId` is semantic verb+noun in camelCase
- [ ] Every `summary` describes the user action with 3-5 key response fields
- [ ] Anti-bot and fingerprint parameters removed
- [ ] All site-specific parameters have clear descriptions
- [ ] Permissions set correctly (read/write/delete/transact)
- [ ] GraphQL queries via POST marked as `read`, not `write`
- [ ] Write ops named by user action, tested manually or flagged for `--write` verify
- [ ] If recompiling: merge completed per merge process above
