# Indeed Pipeline Gaps

Issues encountered during Indeed discovery/compile that affect all sites.

## Example File Format Not Documented

**Problem:** After creating example files with `operationId` + `parameters` format, verify silently skipped all operations — producing a bare "FAIL" with no per-operation details. Wasted a full verify cycle debugging.

**Root cause:** `src/lifecycle/verify.ts:161` — `if (!Array.isArray(testFile.cases)) continue` silently skips files without the new format (`operation_id` + `cases`). No warning logged.

**Suggested fix:** Two fixes needed:
1. **Doc gap**: `compile.md` Step 3/Step 5 should specify the example file format, or reference the format in verify.md. Currently no documentation of the `operation_id` + `cases` structure anywhere in the process docs.
2. **Code gap**: `verify.ts` should log a warning when skipping a file that has JSON content but no `cases` array — "Skipping {file}: missing 'cases' array (expected format: {operation_id, cases[{input, assertions}]})".

## Auto-Compile for SSR-Heavy Sites

**Problem:** Auto-compile on Indeed's capture (76MB HAR) produced 38 operations, 34 of which were tracking/logging/analytics noise. Only 4 were real (autocomplete APIs). Core page-based operations were invisible to the pipeline because they're SSR HTML, not JSON APIs.

**Root cause:** The pipeline's labeler classifies HTML page loads as `static`, not `api`. This is correct, but means SSR-heavy sites always need manual adapter curation post-compile.

**Suggested fix:** When `extractionSignals` are detected in analysis.json AND `summary.byCategory.api` is low relative to captured traffic, auto-curation could flag this: "Site appears SSR-heavy. Consider adapter-based extraction for page-level operations." This would save the cycle of wondering why auto-compile missed target intents.

## Build Sync Direction

**Problem:** Edited `~/.openweb/sites/indeed/openapi.yaml` to fix a schema issue, ran `pnpm build`, and the fix was overwritten. `pnpm build` syncs FROM `src/sites/` TO `~/.openweb/sites/`, not the reverse.

**Root cause:** Not a code bug — expected behavior. But `compile.md` Step 3 says "Edit `$OPENWEB_HOME/sites/<site>/openapi.yaml`" and Step 5 says "copy to src/sites/". If you edit `$OPENWEB_HOME` after copying to src, then build, your edits are lost.

**Suggested fix:** Add a note to `compile.md` Step 5: "After install, all further edits must go to `src/sites/<site>/` — `pnpm build` overwrites the compile cache."
