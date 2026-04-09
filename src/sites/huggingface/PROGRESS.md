# huggingface — Progress

## 2026-04-09 — Polish pass
- Fixed bare `type: object` on `cardData` (getModel, getDataset) and `safetensors` (getModel) — added `additionalProperties: true`
- Added `required: [rfilename]` to `siblings` items in getModel and getDataset
- Fixed DOC.md heading levels: subsections under Site Internals now use `###`
- Created PROGRESS.md
- Verified all 5 operations pass runtime verify
- DOC.md reviewed: all operations present, workflows reference real operationIds, Known Issues documented
- Examples reviewed: all 5 operations have realistic example fixtures
