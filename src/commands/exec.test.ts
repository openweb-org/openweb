import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { executeOperationMock } = vi.hoisted(() => ({
  executeOperationMock: vi.fn(),
}))

vi.mock('../runtime/executor.js', () => ({
  executeOperation: executeOperationMock,
}))

vi.mock('./browser.js', () => ({
  getManagedCdpEndpoint: vi.fn(async () => undefined),
}))

import { execCommand } from './exec.js'

describe('execCommand', () => {
  beforeEach(() => {
    executeOperationMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the full JSON response when under max-response', async () => {
    executeOperationMock.mockResolvedValue({
      body: { ok: true },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await execCommand('open-meteo-fixture', 'get_forecast', '{}')

    expect(stdout).toHaveBeenCalledWith('{"ok":true}\n')
  })

  it('auto-spills large responses to file and returns pointer', async () => {
    executeOperationMock.mockResolvedValue({
      status: 200,
      body: { data: 'a'.repeat(10000) },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await execCommand('instagram-fixture', 'getTimeline', '{}', { maxResponse: 100 })

    const written = stdout.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(written.trim()) as { status: number; output: string; size: number; truncated: boolean }
    expect(parsed.truncated).toBe(true)
    expect(parsed.output).toContain('openweb-')
    expect(parsed.size).toBeGreaterThan(100)
  })
})
