import { describe, expect, it, vi, beforeEach } from 'vitest'

import { parseLinkHeader, executePaginated } from './paginator.js'
import type { ExecuteResult } from './executor.js'

// Mock executor — vi.hoisted so the factory runs before module evaluation
const executeOperationMock = vi.fn<(...args: unknown[]) => Promise<ExecuteResult>>()

vi.mock('./executor.js', () => ({
  executeOperation: (...args: unknown[]) => executeOperationMock(...args),
}))

// Mock openapi helpers
vi.mock('../lib/openapi.js', () => ({
  loadOpenApi: vi.fn(async () => ({
    openapi: '3.1.0',
    info: { title: 'test', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/items': {
        get: {
          operationId: 'list_items',
          'x-openweb': mockXOpenWeb,
        },
      },
    },
  })),
  findOperation: vi.fn(() => ({
    method: 'get',
    path: '/items',
    operation: {
      operationId: 'list_items',
      'x-openweb': mockXOpenWeb,
    },
  })),
}))

// Shared mutable config — tests set this before calling executePaginated
let mockXOpenWeb: Record<string, unknown> | undefined

function makeResult(body: unknown, headers: Record<string, string> = {}): ExecuteResult {
  return { status: 200, body, responseSchemaValid: true, responseHeaders: headers }
}

beforeEach(() => {
  executeOperationMock.mockReset()
  mockXOpenWeb = undefined
})

// ── parseLinkHeader ──────────────────────────────────────

describe('parseLinkHeader', () => {
  it('extracts next URL correctly', () => {
    const header = '<https://api.example.com/items?page=2>; rel="next"'
    expect(parseLinkHeader(header)).toBe('https://api.example.com/items?page=2')
  })

  it('returns undefined when no next rel', () => {
    const header = '<https://api.example.com/items?page=5>; rel="last"'
    expect(parseLinkHeader(header)).toBeUndefined()
  })

  it('handles multiple rels and picks the right one', () => {
    const header =
      '<https://api.example.com/items?page=1>; rel="prev", ' +
      '<https://api.example.com/items?page=3>; rel="next", ' +
      '<https://api.example.com/items?page=10>; rel="last"'
    expect(parseLinkHeader(header)).toBe('https://api.example.com/items?page=3')
  })

  it('extracts a custom rel', () => {
    const header = '<https://api.example.com/items?page=10>; rel="last"'
    expect(parseLinkHeader(header, 'last')).toBe('https://api.example.com/items?page=10')
  })
})

// ── executePaginated — no pagination config ──────────────

describe('executePaginated — no pagination config', () => {
  it('executes once and wraps body in items', async () => {
    mockXOpenWeb = {}
    executeOperationMock.mockResolvedValueOnce(makeResult({ data: [1, 2, 3] }))

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([1, 2, 3])
    expect(result.pages).toBe(1)
    expect(executeOperationMock).toHaveBeenCalledTimes(1)
  })
})

// ── executePaginated — cursor ────────────────────────────

describe('executePaginated — cursor', () => {
  beforeEach(() => {
    mockXOpenWeb = {
      pagination: {
        type: 'cursor',
        response_field: 'next_cursor',
        request_param: 'cursor',
      },
    }
  })

  it('follows cursor across 3 pages then stops on null cursor', async () => {
    executeOperationMock
      .mockResolvedValueOnce(makeResult({ data: [1, 2], next_cursor: 'abc' }))
      .mockResolvedValueOnce(makeResult({ data: [3, 4], next_cursor: 'def' }))
      .mockResolvedValueOnce(makeResult({ data: [5] }))

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([1, 2, 3, 4, 5])
    expect(result.pages).toBe(3)
    expect(executeOperationMock).toHaveBeenCalledTimes(3)

    // Verify cursor was passed in second call
    expect(executeOperationMock.mock.calls[1][2]).toEqual({ cursor: 'abc' })
    expect(executeOperationMock.mock.calls[2][2]).toEqual({ cursor: 'def' })
  })

  it('returns empty items when first page has no data', async () => {
    executeOperationMock.mockResolvedValueOnce(makeResult({ data: [] }))

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([])
    expect(result.pages).toBe(1)
  })

  it('respects maxPages limit', async () => {
    executeOperationMock
      .mockResolvedValueOnce(makeResult({ data: [1], next_cursor: 'a' }))
      .mockResolvedValueOnce(makeResult({ data: [2], next_cursor: 'b' }))
      .mockResolvedValueOnce(makeResult({ data: [3], next_cursor: 'c' }))

    const result = await executePaginated('test-site', 'list_items', {}, { maxPages: 2 })
    expect(result.items).toEqual([1, 2])
    expect(result.pages).toBe(2)
    expect(executeOperationMock).toHaveBeenCalledTimes(2)
  })

  it('stops when has_more_field is false', async () => {
    mockXOpenWeb = {
      pagination: {
        type: 'cursor',
        response_field: 'next_cursor',
        request_param: 'cursor',
        has_more_field: 'has_more',
      },
    }

    executeOperationMock
      .mockResolvedValueOnce(makeResult({ data: [1], next_cursor: 'abc', has_more: true }))
      .mockResolvedValueOnce(makeResult({ data: [2], next_cursor: 'def', has_more: false }))

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([1, 2])
    expect(result.pages).toBe(2)
    expect(executeOperationMock).toHaveBeenCalledTimes(2)
  })

  it('supports nested cursor paths for GraphQL-style pageInfo', async () => {
    mockXOpenWeb = {
      pagination: {
        type: 'cursor',
        response_field: 'pageInfo.endCursor',
        request_param: 'cursor',
        has_more_field: 'pageInfo.hasNextPage',
      },
    }

    executeOperationMock
      .mockResolvedValueOnce(
        makeResult({
          data: [1, 2],
          pageInfo: { endCursor: 'abc', hasNextPage: true },
        }),
      )
      .mockResolvedValueOnce(
        makeResult({
          data: [3],
          pageInfo: { endCursor: 'def', hasNextPage: false },
        }),
      )

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([1, 2, 3])
    expect(result.pages).toBe(2)
    expect(executeOperationMock.mock.calls[1][2]).toEqual({ cursor: 'abc' })
  })

  it('injects cursor into nested request_param (GraphQL variables.cursor)', async () => {
    mockXOpenWeb = {
      pagination: {
        type: 'cursor',
        response_field: 'data.actor.entitySearch.results.nextCursor',
        request_param: 'variables.cursor',
      },
    }

    executeOperationMock
      .mockResolvedValueOnce(
        makeResult({
          data: {
            actor: {
              entitySearch: {
                results: {
                  entities: [{ name: 'Dashboard 1' }],
                  nextCursor: 'page2cursor',
                },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        makeResult({
          data: {
            actor: {
              entitySearch: {
                results: {
                  entities: [{ name: 'Dashboard 2' }],
                  nextCursor: null,
                },
              },
            },
          },
        }),
      )

    const initialParams = { query: 'graphql query', variables: { limit: 10 } }
    const result = await executePaginated('test-site', 'list_items', initialParams)
    expect(result.pages).toBe(2)

    // Verify the nested cursor was injected into variables
    const page2Params = executeOperationMock.mock.calls[1][2] as Record<string, unknown>
    expect(page2Params.variables).toEqual({ limit: 10, cursor: 'page2cursor' })
    // query param should be preserved
    expect(page2Params.query).toBe('graphql query')
  })
})

// ── executePaginated — link_header ───────────────────────

describe('executePaginated — link_header', () => {
  beforeEach(() => {
    mockXOpenWeb = {
      pagination: { type: 'link_header' },
    }
  })

  it('follows Link header next URLs', async () => {
    executeOperationMock
      .mockResolvedValueOnce(
        makeResult({ data: [1, 2] }, {
          link: '<https://api.example.com/items?page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(
        makeResult({ data: [3, 4] }, {
          link: '<https://api.example.com/items?page=3>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(makeResult({ data: [5] }))

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([1, 2, 3, 4, 5])
    expect(result.pages).toBe(3)
    expect(executeOperationMock).toHaveBeenCalledTimes(3)
  })

  it('stops when Link header has no next rel', async () => {
    executeOperationMock.mockResolvedValueOnce(
      makeResult({ data: [1] }, {
        link: '<https://api.example.com/items?page=1>; rel="last"',
      }),
    )

    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([1])
    expect(result.pages).toBe(1)
  })
})

// ── executePaginated — unsupported type ──────────────────

describe('executePaginated — unsupported type', () => {
  it('throws for offset_limit pagination (not yet supported)', async () => {
    mockXOpenWeb = {
      pagination: { type: 'offset_limit' },
    }

    await expect(
      executePaginated('test-site', 'list_items', {}),
    ).rejects.toMatchObject({
      payload: {
        code: 'EXECUTION_FAILED',
        message: 'Unsupported pagination type: offset_limit',
      },
    })
  })
})

// ── extractItems heuristic ───────────────────────────────

describe('executePaginated — extractItems heuristic', () => {
  beforeEach(() => {
    mockXOpenWeb = {}
  })

  it('extracts from body.items', async () => {
    executeOperationMock.mockResolvedValueOnce(makeResult({ items: ['a', 'b'] }))
    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual(['a', 'b'])
  })

  it('extracts from body.results', async () => {
    executeOperationMock.mockResolvedValueOnce(makeResult({ results: [10, 20] }))
    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([10, 20])
  })

  it('uses body directly if it is an array', async () => {
    executeOperationMock.mockResolvedValueOnce(makeResult([100, 200]))
    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([100, 200])
  })

  it('extracts from body.feed (Bluesky)', async () => {
    executeOperationMock.mockResolvedValueOnce(makeResult({ feed: [{ post: 'a' }, { post: 'b' }] }))
    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([{ post: 'a' }, { post: 'b' }])
  })

  it('wraps non-array body as single-element array', async () => {
    executeOperationMock.mockResolvedValueOnce(makeResult({ name: 'test' }))
    const result = await executePaginated('test-site', 'list_items', {})
    expect(result.items).toEqual([{ name: 'test' }])
  })
})
