import { describe, expect, it, vi, beforeEach } from 'vitest'

import { executeAdapter, clearAdapterCache } from './adapter-executor.js'
import type { CodeAdapter } from '../types/adapter.js'
import type { Page } from 'playwright'

function mockPage(): Page {
  return {
    evaluate: vi.fn(),
    url: () => 'https://example.com',
  } as unknown as Page
}

function mockAdapter(overrides: Partial<CodeAdapter> = {}): CodeAdapter {
  return {
    name: 'test-adapter',
    description: 'Test adapter',
    provides: [{ type: 'protocol', description: 'test' }],
    init: vi.fn(async () => true),
    isAuthenticated: vi.fn(async () => true),
    execute: vi.fn(async () => ({ result: 'ok' })),
    ...overrides,
  }
}

describe('executeAdapter', () => {
  beforeEach(() => {
    clearAdapterCache()
  })

  it('runs init → isAuthenticated → execute pipeline', async () => {
    const page = mockPage()
    const adapter = mockAdapter()

    const result = await executeAdapter(page, adapter, 'getChats', { limit: 10 })

    expect(adapter.init).toHaveBeenCalledWith(page)
    expect(adapter.isAuthenticated).toHaveBeenCalledWith(page)
    expect(adapter.execute).toHaveBeenCalledWith(page, 'getChats', { limit: 10 })
    expect(result).toEqual({ result: 'ok' })
  })

  it('throws when init fails', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      init: vi.fn(async () => false),
    })

    await expect(
      executeAdapter(page, adapter, 'getChats', {}),
    ).rejects.toMatchObject({
      payload: { code: 'EXECUTION_FAILED' },
    })
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  it('throws when not authenticated', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      isAuthenticated: vi.fn(async () => false),
    })

    await expect(
      executeAdapter(page, adapter, 'getChats', {}),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  it('propagates adapter execute errors', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      execute: vi.fn(async () => { throw new Error('WebSocket closed') }),
    })

    await expect(
      executeAdapter(page, adapter, 'getMessages', {}),
    ).rejects.toThrow('WebSocket closed')
  })

  it('passes params through to adapter.execute', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      execute: vi.fn(async (_p, _op, params) => params),
    })

    const result = await executeAdapter(page, adapter, 'getMessages', {
      chatId: '123@s.whatsapp.net',
      limit: 50,
    })

    expect(result).toEqual({ chatId: '123@s.whatsapp.net', limit: 50 })
  })
})
