---
name: update-docs
description: Sync documentation with code changes before commits. Triggered by /update-doc or /update-docs after architecture/workflow changes.
---

# Update Docs

Keep documentation in sync with code changes.

## When to Activate

- Before commits with architecture/workflow changes
- After modifying public APIs
- After changing build/setup process

## Doc Priority

| Folder | Priority | Update When |
|--------|----------|-------------|
| `doc/mvp/` | Critical | MVP design and implementation changes |
| `doc/final/` | Critical | Architecture and design changes |
| `.ai-dev/ & CLAUDE.md` | Critical | AI Dev agent workflow changes |
| `doc/` (other) | High | Active project status |

## Canonical Doc Map

- Use `doc/` directory structure as the source of truth for documentation navigation.
- Do not duplicate the full doc tree inside this skill file.

## Workflow

### 1. Analyze Changes

Each doc has its last update commit hash (it could be different per doc), use it for the diff
```bash
git diff --name-only <doc_last_update_commit>..HEAD
# or, if a commit baseline is provided:
git diff --name-only <base_commit>..HEAD
```

### 2. Map to Docs

| Code Change | Doc to Update |
|-------------|---------------|
| `src/cli/` | CLI usage docs, `doc/mvp/` |
| `src/compiler/` (recorder, analyzer, generator) | `doc/final/` compiler sections |
| `src/runtime/` (navigator, executor) | `doc/final/` runtime sections |
| `src/types/`, `src/schema/` | OpenAPI spec docs, type definitions |
| Build/config files (`package.json`, `tsconfig.json`) | Setup/development docs |
| `.ai-dev/` | Agent workflow docs |

### 3. Update Principles

- Keep the same detail level as nearby content
- Do not over-document tiny internal renames
- Use `→ See:` pointers to source files instead of large code blocks
- Prefer linking over duplicating explanations
- Update timestamps (`Last updated`) on touched docs

### 4. Verify

- Search for removed/renamed symbols in docs (`rg` against `doc/`)
- Verify referenced files/classes still exist
- Ensure links still work

## Output Format

```
DOC UPDATE: [DONE/NEEDED]

Changes analyzed:
- [file] → affects [doc]

Updates made:
- [doc]: [section updated]

Verification: [OK/ISSUES]
```

## Principles

- `doc/mvp/` and `doc/final/` are primary design docs and must stay current
- `.ai-dev/` workflow docs should reflect actual tooling
- Minimize code blocks; prefer file pointers (`→ See: path/to/file.ts`)
- Keep explanation depth proportional to change impact
