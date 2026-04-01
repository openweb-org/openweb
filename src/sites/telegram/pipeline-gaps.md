## Pipeline Gaps — Telegram Discovery (2026-04-01)

### 1. No adapter-only discovery path documented

**Problem:** discover.md and compile.md assume HTTP/WS traffic capture as the entry point. For sites using proprietary binary protocols (Telegram MTProto, WhatsApp Signal Protocol), the capture→compile pipeline produces no useful API clusters. The entire pipeline is bypassed in favor of manual adapter construction.

**Root cause:** `references/discover.md` has no branch for "site uses non-HTTP protocol" in its decision tree.

**Suggested fix:** Add a decision step after "Before You Start" in discover.md:
```
Does the site use a standard HTTP/WS API?
├── Yes → Continue to Step 1 (Frame)
└── No (MTProto, protobuf-only, binary protocol)
    → Skip capture, build L3 adapter manually
    → Write openapi.yaml with virtual /internal/* paths
    → Create example files manually
    → Proceed to compile.md Step 4 (Verify)
```

### 2. Verify shows `[object Object]` for non-Error adapter throws

**Problem:** When an adapter throws a plain object (e.g., `{ error: '...', failureClass: '...' }`) instead of an Error instance, the verify detail column displays `[object Object]` instead of a meaningful message.

**Root cause:** `src/lifecycle/verify.ts` stringifies the error with template literal, which calls `.toString()` on plain objects → `[object Object]`.

**Suggested fix:** In verify.ts error formatting, use `err.message ?? JSON.stringify(err)` to handle both Error instances and plain objects.

### 3. No guidance on manual example file creation

**Problem:** The compile pipeline auto-generates example files from captured traffic. Adapter-only packages have no captured traffic, so no examples are generated. Without examples, `openweb verify` returns an empty operations array and reports FAIL with no detail.

**Root cause:** `references/compile.md` describes examples as compiler output, not as something that can be manually authored.

**Suggested fix:** Add a section to compile.md or spec-curation.md documenting the example file format:
```json
{
  "operation_id": "operationName",
  "cases": [{ "input": { "param": "value" }, "assertions": { "status": 200 } }]
}
```
And note that adapter-only packages must create these manually.

### 4. Navigator test hardcodes telegram operation names

**Problem:** The navigator test at `src/runtime/navigator.test.ts:52` hardcoded `getDialogs` (prior operation name). Renaming the operation to `getChats` broke the test.

**Root cause:** Test fixture references site-specific operation names that can change across package versions.

**Suggested fix:** Not a pipeline issue per se, but tests referencing site packages should either use stable operation names or be updated when packages change.
