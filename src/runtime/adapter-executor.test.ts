import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page } from 'playwright-core'
import type { CodeAdapter } from '../types/adapter.js'
import { clearAdapterCache, executeAdapter } from './adapter-executor.js'

function mockPage(): Page {
  return {
    evaluate: vi.fn(),
    reload: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
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

  it('reloads once and retries init before failing', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      init: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false),
    })

    await expect(
      executeAdapter(page, adapter, 'getChats', {}),
    ).rejects.toMatchObject({
      payload: { failureClass: 'retriable' },
    })

    expect(page.reload).toHaveBeenCalledTimes(1)
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1)
    expect(adapter.init).toHaveBeenCalledTimes(2)
  })

  it('reloads and recovers when init succeeds on retry', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      init: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    })

    const result = await executeAdapter(page, adapter, 'getChats', {})

    expect(page.reload).toHaveBeenCalledTimes(1)
    expect(page.waitForTimeout).toHaveBeenCalledTimes(1)
    expect(adapter.init).toHaveBeenCalledTimes(2)
    expect(adapter.execute).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ result: 'ok' })
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

  it('skips isAuthenticated when requiresAuth is false', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      isAuthenticated: vi.fn(async () => false),
    })

    const result = await executeAdapter(page, adapter, 'getJobs', { query: 'test' }, { requiresAuth: false })

    expect(adapter.init).toHaveBeenCalledWith(page)
    expect(adapter.isAuthenticated).not.toHaveBeenCalled()
    expect(adapter.execute).toHaveBeenCalledWith(page, 'getJobs', { query: 'test' })
    expect(result).toEqual({ result: 'ok' })
  })

  it('still checks auth when requiresAuth is true', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      isAuthenticated: vi.fn(async () => false),
    })

    await expect(
      executeAdapter(page, adapter, 'getChats', {}, { requiresAuth: true }),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
    expect(adapter.isAuthenticated).toHaveBeenCalledWith(page)
    expect(adapter.execute).not.toHaveBeenCalled()
  })

  it('checks auth by default when no options provided', async () => {
    const page = mockPage()
    const adapter = mockAdapter({
      isAuthenticated: vi.fn(async () => false),
    })

    await expect(
      executeAdapter(page, adapter, 'getChats', {}),
    ).rejects.toMatchObject({
      payload: { code: 'AUTH_FAILED' },
    })
    expect(adapter.isAuthenticated).toHaveBeenCalledWith(page)
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
