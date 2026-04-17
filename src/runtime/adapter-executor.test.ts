import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page } from 'patchright'
import type { CustomRunner, PreparedContext } from '../types/adapter.js'
import { clearAdapterCache, executeAdapter } from './adapter-executor.js'

function mockPage(): Page {
  return {
    evaluate: vi.fn(),
    reload: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    addInitScript: vi.fn(async () => {}),
    url: () => 'https://example.com',
  } as unknown as Page
}

describe('executeAdapter — CustomRunner', () => {
  beforeEach(() => {
    clearAdapterCache()
  })

  it('dispatches to run(ctx) when module exports `run`', async () => {
    const page = mockPage()
    const run = vi.fn(async (ctx: PreparedContext) => ({ op: ctx.operation, params: ctx.params, auth: ctx.auth }))
    const runner: CustomRunner = { name: 'r', description: 'd', run }

    const resolveAuthResult = vi.fn(async () => ({ headers: { authorization: 'Bearer x' } }))
    const result = await executeAdapter(page, runner, 'listThings', { a: 1 }, {
      requiresAuth: true,
      resolveAuthResult,
      serverUrl: 'https://api.example.com',
    })

    expect(run).toHaveBeenCalledTimes(1)
    const ctx = run.mock.calls[0]?.[0] as PreparedContext
    expect(ctx.page).toBe(page)
    expect(ctx.operation).toBe('listThings')
    expect(ctx.params).toEqual({ a: 1 })
    expect(ctx.serverUrl).toBe('https://api.example.com')
    expect(ctx.auth).toEqual({ headers: { authorization: 'Bearer x' } })
    expect(ctx.helpers.pageFetch).toBeInstanceOf(Function)
    expect(resolveAuthResult).toHaveBeenCalledWith(page)
    expect(result).toEqual({ op: 'listThings', params: { a: 1 }, auth: { headers: { authorization: 'Bearer x' } } })
  })

  it('omits auth when requiresAuth is false', async () => {
    const page = mockPage()
    const run = vi.fn(async (ctx: PreparedContext) => ctx.auth)
    const runner: CustomRunner = { name: 'r', description: 'd', run }
    const resolveAuthResult = vi.fn(async () => ({ headers: {} }))

    const result = await executeAdapter(page, runner, 'op', {}, { requiresAuth: false, resolveAuthResult })

    expect(resolveAuthResult).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('runs with page=null for transport:node', async () => {
    const run = vi.fn(async (ctx: PreparedContext) => ctx.page)
    const runner: CustomRunner = { name: 'r', description: 'd', run }

    const result = await executeAdapter(null, runner, 'op', {})

    expect(result).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
