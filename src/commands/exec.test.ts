import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatchOperationMock } = vi.hoisted(() => ({
  dispatchOperationMock: vi.fn(),
}))

vi.mock('../runtime/executor.js', () => ({
  dispatchOperation: dispatchOperationMock,
}))

vi.mock('./browser.js', () => ({
  getManagedCdpEndpoint: vi.fn(async () => undefined),
}))

import { execCommand } from './exec.js'

describe('execCommand', () => {
  beforeEach(() => {
    dispatchOperationMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the full JSON response when under max-response', async () => {
    dispatchOperationMock.mockResolvedValue({
      body: { ok: true },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await execCommand('open-meteo', 'get_forecast', '{}')

    expect(stdout).toHaveBeenCalledWith('{"ok":true}\n')
  })

  it('auto-spills large responses to file and returns pointer', async () => {
    dispatchOperationMock.mockResolvedValue({
      status: 200,
      body: { data: 'a'.repeat(10000) },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await execCommand('instagram', 'getTimeline', '{}', { maxResponse: 100 })

    const written = stdout.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(written.trim()) as { status: number; output: string; size: number; truncated: boolean }
    expect(parsed.truncated).toBe(true)
    expect(parsed.output).toContain('openweb-')
    expect(parsed.size).toBeGreaterThan(100)
  })
})
