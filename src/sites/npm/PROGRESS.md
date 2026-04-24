# npm — Progress

## 2026-04-24 — Userflow QA: adapter for getPackage & getVersions

### Personas tested
1. **Developer choosing a package** — search → getDownloads → getPackage
2. **Security auditor checking deps** — search → getVersions → getPackage
3. **Library author checking competition** — search → getDownloads (multiple)

### Issues found & fixed
| # | Issue | Classification | Fix |
|---|-------|---------------|-----|
| 1 | `getVersions` hit `/{package}/latest` — returned latest version manifest, not version list | Wrong data | Adapter extracts `time` field, returns sorted version→date array |
| 2 | `getPackage` returned full registry doc (MB-sized with every version manifest) | Missing data (useful fields buried) | Adapter extracts summary: name, desc, license, latest deps, maintainers, timestamps |
| 3 | `searchPackages` param is `text` (npm API name) — not intuitive | Param opacity (low) | No fix — matches upstream API; documented in DOC.md |

### Changes
- **New:** `adapters/npm.ts` — node-transport adapter for `getPackage` and `getVersions`
- **Spec:** `getPackage` → adapter-routed, response schema updated to summary shape
- **Spec:** `getVersions` → path changed to `/internal/getVersions`, adapter-routed, param moved from path to query, response schema is `{ name, versions: [{ version, date }] }`
- **Spec:** Both ops bumped to `tool_version: 2`

## 2026-04-09 — Polish pass
- Added `required` arrays to all response schemas (search, package, versions, downloads)
- Added `required` to nested objects (package, score, links, author, publisher, dist-tags, repository, dist)
- Verified all 4 operations pass runtime verify
- DOC.md reviewed: all operations present, workflows reference real operationIds, Known Issues documented
- Examples reviewed: all 4 operations have realistic example fixtures
