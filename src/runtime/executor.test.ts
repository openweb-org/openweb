import { describe, expect, it, vi } from 'vitest'

import { OpenWebError } from '../lib/errors.js'
import type { PermissionsConfig } from '../lib/permissions.js'
import { executeOperation } from './executor.js'

describe('executeOperation', () => {
  it('uses per-operation server override and returns JSON body', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => {
      return new Response(
        JSON.stringify({
          total: 1,
          items: [{ name: 'Elden Ring', id: 1245620, type: 'app' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }) as unknown as typeof fetch

    const ssrfMock = vi.fn(async () => {})

    const result = await executeOperation(
      'steam',
      'searchGames',
      { term: 'elden ring' },
      { fetchImpl: fetchMock, ssrfValidator: ssrfMock },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const calledUrl = String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(calledUrl).toContain('https://store.steampowered.com/api/storesearch')
    expect(calledUrl).toContain('term=elden')
  })

  it('throws INVALID_PARAMS when required params are missing', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch

    await expect(
      executeOperation('steam', 'getAppDetails', {}, { fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      payload: {
        code: 'INVALID_PARAMS',
      },
    })
  })

  it('warns but does not fail when response schema mismatches', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ invalid: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const ssrfMock = vi.fn(async () => {})

    const result = await executeOperation(
      'steam',
      'searchGames',
      { term: 'test' },
      { fetchImpl: fetchMock, ssrfValidator: ssrfMock },
    )

    expect(result.status).toBe(200)
    expect(result.responseSchemaValid).toBe(false)
  })

  it('raises OpenWebError for non-2xx responses', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'bad' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    await expect(
      executeOperation('steam', 'searchGames', { term: 'test' }, { fetchImpl: fetchMock }),
    ).rejects.toBeInstanceOf(OpenWebError)
  })
})

describe('permission gate', () => {
  const defaultPermissions: PermissionsConfig = {
    defaults: { read: 'allow', write: 'prompt', delete: 'prompt', transact: 'deny' },
  }

  it('blocks write operations with permission_required on default config', async () => {
    await expect(
      executeOperation('target', 'addToCart', {}, {
        permissionsConfig: defaultPermissions,
      }),
    ).rejects.toMatchObject({
      payload: {
        failureClass: 'permission_required',
        message: expect.stringContaining('write'),
      },
    })
  })

  it('allows write operations when site override permits', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ cart_id: 'abc', total_cart_item_quantity: 1 }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const result = await executeOperation('target', 'addToCart', { cart_item: { tcin: '91252434' } }, {
      fetchImpl: fetchMock,
      permissionsConfig: {
        defaults: defaultPermissions.defaults,
        sites: { 'target': { write: 'allow' } },
      },
    })

    expect(result.status).toBe(201)
  })

  it('allows read operations on default config', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ total: 1, items: [{ name: 'Test Game', id: 1, type: 'app' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const result = await executeOperation('steam', 'searchGames', { term: 'test' }, {
      fetchImpl: fetchMock,
      permissionsConfig: defaultPermissions,
    })

    expect(result.status).toBe(200)
  })
})
