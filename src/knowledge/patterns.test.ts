import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadPatterns, savePatterns, addPattern, getPatternsByCategory, getPatternsBySignal, type PatternEntry } from './patterns.js'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

const { readFile, writeFile, mkdir } = await import('node:fs/promises')

const samplePatterns: PatternEntry[] = [
  { id: 'pat-1', category: 'auth', signal: 'cookie starts with __cf', action: 'exclude', source: 'M15', addedAt: '2025-01-01T00:00:00Z' },
  { id: 'pat-2', category: 'api', signal: 'status 429', action: 'retry', source: 'M10', addedAt: '2025-01-01T00:00:00Z' },
  { id: 'pat-3', category: 'auth', signal: 'SAPISID cookie present', action: 'use sapisidhash', source: 'M9', addedAt: '2025-01-01T00:00:00Z' },
]

describe('patterns knowledge base', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadPatterns returns empty array when file does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    vi.mocked(readFile).mockRejectedValue(enoent)
    const result = await loadPatterns()
    expect(result).toEqual([])
  })

  it('loadPatterns rethrows non-ENOENT errors', async () => {
    vi.mocked(readFile).mockRejectedValue(new SyntaxError('Unexpected token'))
    await expect(loadPatterns()).rejects.toThrow('Unexpected token')
  })

  it('loadPatterns parses JSON file', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(samplePatterns))
    const result = await loadPatterns()
    expect(result).toHaveLength(3)
    expect(result[0]!.category).toBe('auth')
  })

  it('savePatterns creates directory and writes JSON', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    await savePatterns(samplePatterns)

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.openweb/knowledge'), expect.objectContaining({ recursive: true }))
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('patterns.json'),
      expect.stringContaining('"pat-1"'),
      expect.objectContaining({ mode: 0o600 }),
    )
  })

  it('addPattern appends with generated id and timestamp', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([]))
    vi.mocked(mkdir).mockResolvedValue(undefined)
    vi.mocked(writeFile).mockResolvedValue(undefined)

    const result = await addPattern({ category: 'auth', signal: 'test', action: 'test', source: 'test' })

    expect(result.id).toMatch(/^pat-/)
    expect(result.addedAt).toBeTruthy()
    expect(result.category).toBe('auth')
  })

  it('getPatternsByCategory filters correctly', () => {
    const authPatterns = getPatternsByCategory(samplePatterns, 'auth')
    expect(authPatterns).toHaveLength(2)
    expect(authPatterns.every((p) => p.category === 'auth')).toBe(true)
  })

  it('getPatternsBySignal searches case-insensitively', () => {
    const results = getPatternsBySignal(samplePatterns, 'COOKIE')
    expect(results).toHaveLength(2)
  })
})
