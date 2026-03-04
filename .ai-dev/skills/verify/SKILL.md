---
name: verify
description: Run verification loop (build, lint, test, security) before commits. Use before any commit or PR.
---

# Verify

Pre-commit quality gates for TypeScript/Node.js projects.

## When to Use

- Before commits
- After significant changes
- Before PR creation

## Arguments

- `quick` - Build + lint + unit tests
- `full` - All checks (default)

## Verification Phases

### 1. Build

```bash
pnpm tsc --noEmit 2>&1 | tail -30
```

If fails, STOP and report errors. Use `/build-fix` to resolve.

### 2. Lint

```bash
pnpm eslint . 2>&1 | head -30
```

### 3. Tests

```bash
pnpm vitest run 2>&1 | tail -50
```

### 4. Security Scan

```bash
# Check for hardcoded keys
grep -rn "api_key\|apiKey\|API_KEY" --include="*.ts" src/ 2>/dev/null | head -10
grep -rn "sk-\|key-" --include="*.ts" src/ 2>/dev/null | head -10
```

### 5. Code Quality

```bash
# Large files (>400 lines)
find src -name "*.ts" -exec wc -l {} + | awk '$1 > 400 {print}'
```

### 6. Git Status

```bash
git diff --stat
```

## Output Format

```
VERIFICATION: [PASS/FAIL]

Build:    [OK/FAIL]
Lint:     [OK/X warnings]
Tests:    [X/Y passed]
Security: [OK/X issues]

Ready for commit: [YES/NO]

Issues:
1. ...
```

## Quality Thresholds

- Build: Must pass
- Lint: No errors (warnings acceptable)
- Tests: All must pass
- Security: No hardcoded secrets
