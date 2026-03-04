---
name: tdd
description: Test-driven development. Write tests FIRST, then implement. Use for core logic, state machines, data transformations.
---

# TDD

Test-driven development for TypeScript core logic.

## When to Use

**Best for:**
- State machines, orchestration logic
- Data transformations (HAR parsing, schema inference)
- Protocol implementations (OpenAPI generation)
- Pure utility functions
- CLI argument parsing

**Skip for:**
- Playwright browser automation (e2e better)
- Simple CRUD / glue code
- One-off scripts

## TDD Cycle

```
RED → GREEN → REFACTOR

1. Write failing test
2. Implement minimal code to pass
3. Refactor, keep tests green
```

## Workflow

### 1. Define Types

```typescript
interface SchemaInferrer {
  infer(samples: unknown[]): JsonSchema
}

type InferResult =
  | { ok: true; schema: JsonSchema }
  | { ok: false; error: string }
```

### 2. Write Tests (RED)

Some tests matter much more than others, some tests no longer make sense because they mock too much. Your goal is to improve system robustness, stability and scalability, not to just hit a test coverage number. If some parts are not suitable for TDD, then do not forcefully follow this process.

```typescript
import { describe, it, expect } from 'vitest'

describe('SchemaInferrer', () => {
  const inferrer = new SchemaInferrerImpl()

  it('returns schema for valid samples', () => {
    const result = inferrer.infer([{ temp: 20.5 }])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.schema.type).toBe('object')
    }
  })

  it('returns error for empty samples', () => {
    const result = inferrer.infer([])
    expect(result.ok).toBe(false)
  })

  it('handles mixed types gracefully', () => {
    const result = inferrer.infer([{ a: 1 }, { a: 'str' }])
    expect(result.ok).toBe(true)
  })
})
```

### 3. Run Tests (Should Fail)

```bash
pnpm vitest run --reporter=verbose src/path/to/file.test.ts
```

### 4. Implement (GREEN)

Write minimal code to pass.

```typescript
class SchemaInferrerImpl implements SchemaInferrer {
  infer(samples: unknown[]): InferResult {
    if (samples.length === 0) return { ok: false, error: 'No samples' }
    const schema = quicktypeInfer(samples)
    return { ok: true, schema }
  }
}
```

### 5. Refactor

Keep tests green while improving code.

### 6. Verify Coverage

```bash
pnpm vitest run --coverage
# Check coverage/ directory
```

## Testing Tools

```typescript
// Vitest built-in mocking
import { vi } from 'vitest'

const mockFetch = vi.fn()
mockFetch.mockResolvedValue(new Response('{}'))

// Spying
const spy = vi.spyOn(module, 'method')
expect(spy).toHaveBeenCalledWith(expectedArgs)

// Snapshot testing (for generated OpenAPI specs)
expect(generatedSpec).toMatchSnapshot()

// File system mocking (for CLI tests)
import { vol } from 'memfs'
vi.mock('node:fs/promises', () => vol.promises)
```

## Test Structure (AAA)

```typescript
it('descriptive test name', async () => {
  // Arrange
  const input = createInput()

  // Act
  const result = await systemUnderTest.process(input)

  // Assert
  expect(result).toEqual(expected)
})
```

## Coverage Target

- 80% minimum for core logic
- Test behavior, not implementation
