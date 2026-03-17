import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { executeOperationMock } = vi.hoisted(() => ({
  executeOperationMock: vi.fn(),
}))

vi.mock('../runtime/executor.js', () => ({
  executeOperation: executeOperationMock,
}))

import { execCommand } from './exec.js'

describe('execCommand', () => {
  beforeEach(() => {
    executeOperationMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the full JSON response by default', async () => {
    executeOperationMock.mockResolvedValue({
      body: { ok: true },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await execCommand('open-meteo-fixture', 'get_forecast', '{}')

    expect(stdout).toHaveBeenCalledWith('{"ok":true}\n')
    expect(stderr).not.toHaveBeenCalled()
  })

  it('truncates oversized responses and emits a warning', async () => {
    executeOperationMock.mockResolvedValue({
      body: { data: '😀abcdefghijklmnopqrstuvwxyz' },
    })
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await execCommand('instagram-fixture', 'getTimeline', '{}', { maxResponse: 16 })

    const written = stdout.mock.calls[0]?.[0]
    expect(typeof written).toBe('string')
    const serialized = (written as string).trimEnd()
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(16)
    const preview = JSON.parse(serialized) as string
    expect(typeof preview).toBe('string')
    expect(JSON.stringify({ data: '😀abcdefghijklmnopqrstuvwxyz' }).startsWith(preview)).toBe(true)
    expect(stderr).toHaveBeenCalledWith('warning: truncated at 16 bytes\n')
  })
})
