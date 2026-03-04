---
name: build-fix
description: Fix TypeScript/Node.js build errors incrementally. No refactoring - just get the build green. Use when verify fails.
---

# Build Fix

Fix build errors quickly with minimal diffs.

## When to Use

- After `/verify` fails with build errors
- During development when build breaks
- Resolving merge conflicts that break build

## Workflow

### 1. Collect Errors

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

### 2. Categorize by Type

- TypeScript compilation errors
- Module resolution errors
- Type mismatches
- Missing dependencies
- ESLint/config errors

### 3. Fix One Error at a Time

- Understand the error
- Apply minimal fix
- Re-run build
- Verify no new errors

If the break is in tests:

```bash
pnpm vitest run 2>&1 | tail -50
```

### 4. Stop If

- Fix introduces new errors
- Same error after 3 attempts
- User requests pause

## Common TypeScript/Node.js Errors

### Module Resolution

```typescript
// ERROR: Cannot find module './foo'
// FIX: Check file path, file extension, tsconfig paths
```

### Type Errors

```typescript
// ERROR: Type 'X' is not assignable to type 'Y'
// FIX: Add explicit type annotation, use type assertion, fix the type
```

### Missing Exports

```typescript
// ERROR: Module has no exported member 'Foo'
// FIX: Add export, check named vs default export
```

### Strict Null Checks

```typescript
// ERROR: Object is possibly 'undefined'
// FIX: Add null check, optional chaining, or non-null assertion
```

### Dependency Errors

```bash
# ERROR: Cannot find module 'some-package'
# FIX: pnpm add some-package
```

### ESLint Errors

```bash
# ERROR: Parsing error / rule violation
# FIX: Fix code to comply, or adjust .eslintrc if rule is wrong
```

## Minimal Diff Rules

**DO:**
- Add missing imports
- Fix type annotations
- Add null checks
- Fix module paths
- Add missing exports

**DON'T:**
- Refactor unrelated code
- Rename things
- Change architecture
- Optimize performance

## Output Format

```
BUILD FIX SESSION

Initial errors: X

Fix 1: [file:line]
  Error: ...
  Applied: ...
  Result: [OK/NEW_ERROR]

...

Final status: [PASS/FAIL]
Errors fixed: Y
Remaining: Z
```
