import { describe, expect, it } from 'vitest'

import {
  diffShape,
  extractFields,
  extractRequiredFields,
  extractSchemaFields,
} from './shape-diff.js'

describe('extractFields', () => {
  it('simple object → path→type map', () => {
    expect(extractFields({ id: 1, name: 'alice' })).toEqual({
      id: 'number',
      name: 'string',
    })
  })

  it('nested object → dot-separated paths', () => {
    expect(extractFields({ user: { id: 1, name: 'bob' } })).toEqual({
      user: 'object',
      'user.id': 'number',
      'user.name': 'string',
    })
  })

  it('array of objects → []. prefix, superset of first 3 items', () => {
    const result = extractFields([
      { id: 1 },
      { id: 2, name: 'a' },
      { id: 3, extra: true },
    ])
    expect(result).toEqual({
      '[].id': 'number',
      '[].name': 'string',
      '[].extra': 'boolean',
    })
  })

  it('null values → skipped', () => {
    expect(extractFields({ id: 1, deleted: null })).toEqual({ id: 'number' })
  })

  it('top-level null → empty', () => {
    expect(extractFields(null)).toEqual({})
  })

  it('number and integer both normalize to number', () => {
    // JS typeof already returns 'number' for both; verify normalization path
    expect(extractFields({ count: 42 })).toEqual({ count: 'number' })
    expect(extractFields({ price: 9.99 })).toEqual({ price: 'number' })
  })

  it('depth > 3 → stops recursion', () => {
    // depth 0: root, 1: a, 2: b, 3: c (processed), 4: d (processed), 5: e (too deep)
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
    const result = extractFields(deep)
    expect(result).toHaveProperty('a.b.c.d', 'object')
    expect(result).not.toHaveProperty('a.b.c.d.e')
  })

  it('empty array → {}', () => {
    expect(extractFields([])).toEqual({})
  })

  it('top-level primitive → { "": type }', () => {
    expect(extractFields('hello')).toEqual({ '': 'string' })
    expect(extractFields(42)).toEqual({ '': 'number' })
    expect(extractFields(true)).toEqual({ '': 'boolean' })
  })
})

describe('extractSchemaFields', () => {
  it('object schema with properties → path→type map', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'integer' as const },
        name: { type: 'string' as const },
      },
    }
    expect(extractSchemaFields(schema)).toEqual({
      id: 'number',
      name: 'string',
    })
  })

  it('array schema with items → []. prefix', () => {
    const schema = {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: { id: { type: 'number' as const } },
      },
    }
    expect(extractSchemaFields(schema)).toEqual({ '[].id': 'number' })
  })

  it('nested schema → recursive extraction', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        user: {
          type: 'object' as const,
          properties: {
            id: { type: 'number' as const },
          },
        },
      },
    }
    expect(extractSchemaFields(schema)).toEqual({
      user: 'object',
      'user.id': 'number',
    })
  })

  it('missing type → inferred from structure', () => {
    const schema = {
      properties: {
        id: { type: 'number' as const },
      },
    }
    // type omitted but properties present → inferred as object
    expect(extractSchemaFields(schema)).toEqual({ id: 'number' })
  })
})

describe('extractRequiredFields', () => {
  it('schema with required array → correct paths', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'number' as const },
        name: { type: 'string' as const },
      },
      required: ['id'],
    }
    expect(extractRequiredFields(schema)).toEqual(new Set(['id']))
  })

  it('nested required → full paths', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        user: {
          type: 'object' as const,
          properties: {
            id: { type: 'number' as const },
            email: { type: 'string' as const },
          },
          required: ['id'],
        },
      },
      required: ['user'],
    }
    expect(extractRequiredFields(schema)).toEqual(new Set(['user', 'user.id']))
  })

  it('no required → empty set', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        id: { type: 'number' as const },
      },
    }
    expect(extractRequiredFields(schema)).toEqual(new Set())
  })
})

describe('diffShape', () => {
  it('all types match → empty array', () => {
    const schema = { id: 'number', name: 'string' }
    const response = { id: 'number', name: 'string' }
    expect(diffShape(schema, response, new Set())).toEqual([])
  })

  it('type mismatch → type_change drift', () => {
    const schema = { id: 'number' }
    const response = { id: 'string' }
    expect(diffShape(schema, response, new Set())).toEqual([
      { kind: 'type_change', path: 'id', expected: 'number', actual: 'string' },
    ])
  })

  it('required field missing → required_missing drift', () => {
    const schema = { id: 'number', name: 'string' }
    const response = { id: 'number' }
    expect(diffShape(schema, response, new Set(['name']))).toEqual([
      { kind: 'required_missing', path: 'name' },
    ])
  })

  it('response has extra field not in schema → ignored', () => {
    const schema = { id: 'number' }
    const response = { id: 'number', extra: 'string' }
    expect(diffShape(schema, response, new Set())).toEqual([])
  })

  it('optional field missing → no drift', () => {
    const schema = { id: 'number', name: 'string' }
    const response = { id: 'number' }
    // name is not in requiredFields → optional → no drift
    expect(diffShape(schema, response, new Set())).toEqual([])
  })

  it('multiple drifts → all reported', () => {
    const schema = { id: 'number', name: 'string', age: 'number' }
    const response = { id: 'string' }
    const required = new Set(['name'])
    const drifts = diffShape(schema, response, required)
    expect(drifts).toHaveLength(2)
    expect(drifts).toContainEqual({
      kind: 'type_change',
      path: 'id',
      expected: 'number',
      actual: 'string',
    })
    expect(drifts).toContainEqual({ kind: 'required_missing', path: 'name' })
  })
})
