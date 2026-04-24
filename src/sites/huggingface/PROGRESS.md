# huggingface — Progress

## 2026-04-24 — Adapter + response trimming

### Problems found (blind QA, 3 personas)
- **searchModels returned 1000 items / 453KB** — HF API ignores absent `limit`, spec claimed default 20 but never enforced it
- **searchDatasets returned 49KB** — raw API response with full descriptions, unnecessary fields (`_id`, `sha`, `private`)
- **getModel returned 17KB to temp file** — raw response with 17-item `siblings`, full `safetensors` object, `widgetData`, `model-index`
- **getDataset** — inline but bloated with full `cardData.train-eval-index`, `siblings` as objects
- **`query` param rejected** — natural agent param is `query` but spec requires `search`
- **Results not sorted by downloads** — sort/limit defaults never sent to HF API
- **`parameters` field** — `safetensors.parameters` is a dict (`{F32: N}`), not an integer

### Fixes
- Created `adapters/huggingface.ts` — adapter for all 5 operations
  - Enforces defaults: `limit=20`, `sort=downloads` (models/datasets), `sort=likes` (spaces), `direction=-1`
  - Trims search results to: `id`, `author`, `pipeline_tag`, `library_name`, `downloads`, `likes`, `createdAt`
  - Trims getModel to: core fields + `cardData` (license/language/datasets), `parameters` (extracted as integer from safetensors), `spaces` (top 5), `files`
  - Trims getDataset to: core fields + `cardData` (license/language/size/task/dataset_info), `files`
  - Trims getSpaces to: `id`, `author`, `likes`, `sdk`, `tags`, `createdAt`
- Added `x-openweb.alias: query` on `search` param for all 3 search operations
- Updated response schemas to match adapter output (removed `_id`, `modelId`, `sha`, `private`, `disabled`, `trendingScore`)
- Bumped `tool_version` to 2 on all operations
- Updated example fixtures to test-case format
- Verified 5/5 operations pass

### Before → After (response size)
| Operation | Before | After |
|---|---|---|
| searchModels (default) | 453KB / 1000 items / temp file | ~1.5KB / 20 items / inline |
| searchDatasets (default) | 49KB / temp file | ~2KB / inline |
| getModel | 17KB / temp file | ~1.5KB / inline |
| getDataset | ~2.5KB / inline | ~2KB / inline |
| getSpaces | ~0.5KB / inline | ~0.5KB / inline |

## 2026-04-09 — Polish pass
- Fixed bare `type: object` on `cardData` (getModel, getDataset) and `safetensors` (getModel) — added `additionalProperties: true`
- Added `required: [rfilename]` to `siblings` items in getModel and getDataset
- Fixed DOC.md heading levels: subsections under Site Internals now use `###`
- Created PROGRESS.md
- Verified all 5 operations pass runtime verify
- DOC.md reviewed: all operations present, workflows reference real operationIds, Known Issues documented
- Examples reviewed: all 5 operations have realistic example fixtures
